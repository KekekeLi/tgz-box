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
  failed?: boolean;
  percent?: number;
}) => void;

// 下载带进度
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

// 递归下载（package.json/单包场景）
export async function downloadPackageWithVersion(
  pkgName: string,
  version: string,
  downloaded: Set<string>,
  progress: ProgressCallback,
  counters: { finished: number; failed: number },
  registry?: string
) {
  const key = `${pkgName}@${version}`;
  if (downloaded.has(key)) return;
  downloaded.add(key);

  try {
    const url = getPackageMetaUrl(pkgName, version, registry);
    const res = await axiosGetWithRetry(url);
    const data = res.data;
    const tgzUrl = data.dist.tarball;
    const saveDir = path.join(process.cwd(), 'tgz', pkgName, version);

    let lastPercent = -1;
    await downloadWithProgress(
      tgzUrl,
      saveDir,
      undefined,
      percent => {
        if (percent !== 100 && percent !== lastPercent) {
          lastPercent = percent;
          progress({
            current: counters.finished + counters.failed + 1,
            total: undefined as any, // 由外部传入
            pkgName,
            version,
            percent
          });
        }
      }
    );
    fs.writeFileSync(path.join(saveDir, 'package.json'), JSON.stringify(data, null, 2));

    counters.finished++;
    progress({
      current: counters.finished + counters.failed,
      total: undefined as any, // 由外部传入
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
      await downloadPackageWithVersion(dep, matchedVersion, downloaded, progress, counters, registry);
    }
  } catch (err) {
    counters.failed++;
    progress({
      current: counters.finished + counters.failed,
      total: undefined as any,
      pkgName,
      version,
      failed: true
    });
    throw err;
  }
}

// 递归统计所有依赖（package.json/单包场景）
export async function countAllDepsFromPackage(
  pkgName: string,
  version: string,
  counted = new Set<string>(),
  registry?: string,
  onProgress?: (pkgName: string, version: string, count: number) => void
): Promise<void> {
  const key = `${pkgName}@${version}`;
  if (counted.has(key)) return;
  counted.add(key);

  if (onProgress) onProgress(pkgName, version, counted.size);

  const url = getPackageMetaUrl(pkgName, version, registry);
  const res = await axiosGetWithRetry(url);
  const data = res.data;
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
    await countAllDepsFromPackage(dep, matchedVersion, counted, registry, onProgress);
  }
}

// 递归统计所有依赖（package-lock.json场景）
export function countAllDepsFromLock(deps: any, counted = new Set<string>(), onProgress?: (name: string, version: string, count: number) => void) {
  for (const name in deps) {
    const dep = deps[name];
    const key = `${name}@${dep.version}`;
    if (counted.has(key)) continue;
    counted.add(key);
    if (onProgress) onProgress(name, dep.version, counted.size);
    if (dep.dependencies) {
      countAllDepsFromLock(dep.dependencies, counted, onProgress);
    }
  }
}

// 递归下载（package-lock.json场景）
export async function downloadAllFromLockDeps(
  deps: any,
  downloaded: Set<string>,
  progress: ProgressCallback,
  counters: { finished: number; failed: number },
  failedList: { name: string; version: string }[],
  total: number,
  registry?: string
) {
  for (const name in deps) {
    const dep = deps[name];
    const key = `${name}@${dep.version}`;
    if (downloaded.has(key)) continue;
    if (dep.version) {
      try {
        await downloadPackageWithVersion(
          name,
          dep.version,
          downloaded,
          (info) => progress({ ...info, total }),
          counters,
          registry
        );
      } catch (err) {
        progress({ pkgName: name, version: dep.version, failed: true, current: counters.finished + counters.failed + 1, total });
        counters.failed++;
        failedList.push({ name, version: dep.version });
      }
    }
    if (dep.dependencies) {
      await downloadAllFromLockDeps(dep.dependencies, downloaded, progress, counters, failedList, total, registry);
    }
  }
}

export function getPackageMetaUrl(pkgName: string, version?: string, registry?: string) {
  const reg = getRegistry(registry);
  return version
    ? `${reg}/${pkgName.replace('/', '%2F')}/${version}`
    : `${reg}/${pkgName.replace('/', '%2F')}`;
}

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

export function prettyLogProgress(info: { current: number; total: number; pkgName: string; version: string; percent?: number; failed?: boolean }) {
  if (info.failed) {
    process.stdout.write(
      `\x1b[31m[失败]\x1b[0m ${info.pkgName}@${info.version} ✖\n`
    );
  } else if (info.percent !== undefined && info.percent !== 100) {
    process.stdout.write(
      `\r\x1b[36m[进度]\x1b[0m [${info.current}/${info.total}] 正在下载 ${info.pkgName}@${info.version}... ${info.percent}%   `
    );
  } else if (info.percent === 100) {
    process.stdout.write(
      `\r\x1b[32m[完成]\x1b[0m [${info.current}/${info.total}] ${info.pkgName}@${info.version} ✔           \n`
    );
  }
}

export function printDownloadSummary(total: number, success: number, failed: number, failedList: { name: string; version: string }[]) {
  const colWidth = 10;
  const sep = '│';
  const line = `├${'─'.repeat(colWidth)}┼${'─'.repeat(colWidth)}┼${'─'.repeat(colWidth)}┤`;
  const top = `┌${'─'.repeat(colWidth)}┬${'─'.repeat(colWidth)}┬${'─'.repeat(colWidth)}┐`;
  const bottom = `└${'─'.repeat(colWidth)}┴${'─'.repeat(colWidth)}┴${'─'.repeat(colWidth)}┘`;

  console.log('\n\x1b[1m下载统计表\x1b[0m');
  console.log(top);
  console.log(`${sep}${'总数'.padEnd(colWidth)}${sep}${'成功'.padEnd(colWidth)}${sep}${'失败'.padEnd(colWidth)}${sep}`);
  console.log(line);
  console.log(`${sep}${String(total).padEnd(colWidth)}${sep}${String(success).padEnd(colWidth)}${sep}${String(failed).padEnd(colWidth)}${sep}`);
  console.log(bottom);

  if (failedList.length > 0) {
    console.log('\n\x1b[31m下载失败依赖列表：\x1b[0m');
    console.log('┌───────────────────────────────┬───────────────┐');
    console.log('│ 依赖名                        │ 版本          │');
    console.log('├───────────────────────────────┼───────────────┤');
    for (const item of failedList) {
      const namePad = item.name.padEnd(30, ' ');
      const verPad = (item.version || '').padEnd(13, ' ');
      console.log(`│ ${namePad} │ ${verPad} │`);
    }
    console.log('└───────────────────────────────┴───────────────┘');
  }
}