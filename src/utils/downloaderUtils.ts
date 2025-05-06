import axios from 'axios';
import fs from 'fs';
import path from 'path';
import got from 'got';
import stream from 'stream';
import { promisify } from 'util';
import { getRegistry } from './registry.js';

export const pipeline = promisify(stream.pipeline);

export type ProgressCallback = (info: {
  current: number;
  total: number;
  pkgName: string;
  version: string;
  percent?: number;
}) => void;

export async function downloadWithProgress(
  url: string,
  destDir: string,
  fileName?: string,
  onProgress?: (percent: number) => void
) {
  fs.mkdirSync(destDir, { recursive: true });
  const filePath = path.join(destDir, fileName || path.basename(url.split('?')[0]));
  let lastPercent = 0;
  await pipeline(
    got.stream(url)
      .on('downloadProgress', progress => {
        const percent = Math.floor((progress.percent || 0) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress && onProgress(percent);
        }
      }),
    fs.createWriteStream(filePath)
  );
  return filePath;
}

// 递归下载（用于 package.json、单包）
export async function downloadPackageWithVersion(
  pkgName: string,
  version: string,
  downloaded: Set<string>,
  progress: ProgressCallback,
  totalCount: { value: number; finished: number },
  registry?: string
) {
  const key = `${pkgName}@${version}`;
  if (downloaded.has(key)) return;
  downloaded.add(key);

  const url = getPackageMetaUrl(pkgName, version, registry);
  const res = await axiosGetWithRetry(url);
  const data = res.data;
  const tgzUrl = data.dist.tarball;

  const saveDir = path.join(process.cwd(), 'tgz', pkgName, version);

  // 记录上一次进度，避免重复输出
  let lastPercent = -1;

  await downloadWithProgress(
    tgzUrl,
    saveDir,
    undefined,
    percent => {
      // 只在 percent !== 100 时输出进度，且覆盖同一行
      if (percent !== 100 && percent !== lastPercent) {
        lastPercent = percent;
        progress({
          current: totalCount.finished + 1,
          total: totalCount.value,
          pkgName,
          version,
          percent
        });
      }
    }
  );
  fs.writeFileSync(path.join(saveDir, 'package.json'), JSON.stringify(data, null, 2));

  // 下载完成后递增 finished，并只输出一次“完成下载”，覆盖同一行
  totalCount.finished++;
  progress({
    current: totalCount.finished,
    total: totalCount.value,
    pkgName,
    version,
    percent: 100
  });

  // 递归下载依赖
  const dependencies = data.dependencies || {};
  for (const dep in dependencies) {
    const depVersion = dependencies[dep];
    const depMetaUrl = getPackageMetaUrl(dep, undefined, registry);
    const depMetaRes = await axiosGetWithRetry(depMetaUrl);
    const depMetaData = depMetaRes.data;
    let matchedVersion = '';
    if (depMetaData.versions[depVersion]) {
      matchedVersion = depVersion;
    } else if (depMetaData['dist-tags'] && depMetaData['dist-tags'].latest) {
      matchedVersion = depMetaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(depMetaData.versions).pop() || depVersion;
    }
    await downloadPackageWithVersion(dep, matchedVersion, downloaded, progress, totalCount, registry);
  }
}

// 递归统计所有依赖（package.json、单包）
export async function countAllDepsFromPackage(
  pkgName: string,
  version: string,
  counted = new Set<string>(),
  registry?: string // 新增 registry 参数
): Promise<number> {
  const key = `${pkgName}@${version}`;
  if (counted.has(key)) return 0;
  counted.add(key);

  const url = getPackageMetaUrl(pkgName, version, registry);
  const res = await axiosGetWithRetry(url);
  const data = res.data;
  let count = 1;
  const dependencies = data.dependencies || {};
  for (const dep in dependencies) {
    const depVersion = dependencies[dep];
    const depMetaUrl = getPackageMetaUrl(dep, undefined, registry);
    const depMetaRes = await axiosGetWithRetry(depMetaUrl);
    const depMetaData = depMetaRes.data;
    let matchedVersion = '';
    if (depMetaData.versions[depVersion]) {
      matchedVersion = depVersion;
    } else if (depMetaData['dist-tags'] && depMetaData['dist-tags'].latest) {
      matchedVersion = depMetaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(depMetaData.versions).pop() || depVersion;
    }
    count += await countAllDepsFromPackage(dep, matchedVersion, counted, registry); // 递归传递 registry
  }
  return count;
}

// 递归统计所有依赖（package-lock.json）
export function countAllDepsFromLock(deps: any, counted = new Set<string>()) {
  let count = 0;
  for (const name in deps) {
    const dep = deps[name];
    const key = `${name}@${dep.version}`;
    if (counted.has(key)) continue;
    counted.add(key);
    count++;
    if (dep.dependencies) {
      count += countAllDepsFromLock(dep.dependencies, counted);
    }
  }
  return count;
}

export function getPackageMetaUrl(pkgName: string, version?: string, registry?: string) {
  const reg = getRegistry(registry);
  return version
    ? `${reg}/${pkgName.replace('/', '%2F')}/${version}`
    : `${reg}/${pkgName.replace('/', '%2F')}`;
}

// axiosGetWithRetry 增加 registry 支持
export async function axiosGetWithRetry(url: string, retry = 3, delay = 1000): Promise<any> {
  let lastErr;
  for (let i = 0; i < retry; i++) {
    try {
      return await axios.get(url, { timeout: 10000 });
    } catch (err) {
      lastErr = err;
      if (i < retry - 1) {
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastErr;
}