import axios from 'axios';
import {
  downloadPackageWithVersion,
  countAllDepsFromPackage,
  ProgressCallback,
  axiosGetWithRetry,
  getPackageMetaUrl
} from '../utils/downloaderUtils.js';

export async function downloadSinglePackage(pkgName: string, registry?: string) {
  let name = pkgName;
  let version = '';
  if (pkgName.includes('@') && !pkgName.startsWith('@')) {
    [name, version] = pkgName.split('@');
  }
  if (!version) {
    // 获取最新版本
    const metaUrl = getPackageMetaUrl(name, undefined, registry);
    const metaRes = await axiosGetWithRetry(metaUrl);
    const metaData = metaRes.data;
    version = metaData['dist-tags']?.latest || Object.keys(metaData.versions).pop() || '';
  }

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

  // 递归统计总依赖数（用带进度提示的函数）
  const total = await countDepsWithProgress(name, version);
  process.stdout.write(`\n依赖总数统计完成，共需下载 ${total} 个依赖。\n`);
  const totalCount = { value: total, finished: 0 };
  const downloaded = new Set<string>();

  // 只在下载完成时输出一条记录
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

  await downloadPackageWithVersion(name, version, downloaded, logProgress, totalCount, registry);
  console.log('\n全部依赖下载完成！');
}