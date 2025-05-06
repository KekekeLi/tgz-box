import axios from 'axios';
import fs from 'fs';
import path from 'path';
import {
  downloadPackageWithVersion,
  countAllDepsFromPackage,
  ProgressCallback,
  axiosGetWithRetry,
  getPackageMetaUrl
} from '../utils/downloaderUtils.js';

export async function downloadAllFromPackage(registry?: string) {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('package.json not found');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const downloaded = new Set<string>();
  const depNames = Object.keys(deps);

  // 新增：统计依赖总数时提示
  let countedNum = 0;
  process.stdout.write('正在统计依赖总数，请稍候...\n');
  // 包装 countAllDepsFromPackage，支持进度回调
  async function countDepsWithProgress(pkgName: string, version: string, counted = new Set<string>()) {
    const key = `${pkgName}@${version}`;
    if (counted.has(key)) return 0;
    counted.add(key);
    countedNum++;
    process.stdout.write(`\r已统计依赖数：${countedNum}，当前：${pkgName}@${version}   `);
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
      count += await countDepsWithProgress(dep, matchedVersion, counted);
    }
    return count;
  }

  // 递归统计所有依赖（含间接依赖），并显示进度
  let total = 0;
  const counted = new Set<string>();
  for (const name of depNames) {
    const version = deps[name];
    const metaUrl = getPackageMetaUrl(name, undefined, registry);
    const metaRes = await axiosGetWithRetry(metaUrl);
    const metaData = metaRes.data;
    let matchedVersion = '';
    if (metaData.versions[version]) {
      matchedVersion = version;
    } else if (metaData['dist-tags'] && metaData['dist-tags'].latest) {
      matchedVersion = metaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(metaData.versions).pop() || version;
    }
    total += await countDepsWithProgress(name, matchedVersion, counted);
  }
  process.stdout.write(`\n依赖总数统计完成，共需下载 ${total} 个依赖。\n`);
  const totalCount = { value: total, finished: 0 };

  function logProgress(info: { current: number; total: number; pkgName: string; version: string; percent?: number }) {
    if (info.percent !== undefined && info.percent !== 100) {
      process.stdout.write(
        `\r[${info.current}/${info.total}] 正在下载 ${info.pkgName}@${info.version}... ${info.percent}%   `
      );
    } else if (info.percent === 100) {
      process.stdout.write(
        `\r[${info.current}/${info.total}] 完成下载 ${info.pkgName}@${info.version} ✔           \n`
      );
    }
  }

  for (const name of depNames) {
    const version = deps[name];
    const metaUrl = getPackageMetaUrl(name, undefined, registry);
    const metaRes = await axiosGetWithRetry(metaUrl);
    const metaData = metaRes.data;
    let matchedVersion = '';
    if (metaData.versions[version]) {
      matchedVersion = version;
    } else if (metaData['dist-tags'] && metaData['dist-tags'].latest) {
      matchedVersion = metaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(metaData.versions).pop() || version;
    }
    await downloadPackageWithVersion(name, matchedVersion, downloaded, logProgress, totalCount, registry);
  }
  console.log('\n全部依赖下载完成！');
}