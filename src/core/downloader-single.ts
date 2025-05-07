import axios from 'axios';
import {
  downloadPackageWithVersion,
  countAllDepsFromPackage,
  axiosGetWithRetry,
  getPackageMetaUrl,
  prettyLogProgress,
  printDownloadSummary
} from '../utils/downloaderUtils.js';

export async function downloadSinglePackage(pkgName: string, registry?: string) {
  let name = pkgName;
  let version = '';
  if (pkgName.includes('@') && !pkgName.startsWith('@')) {
    [name, version] = pkgName.split('@');
  }
  if (!version) {
    const metaUrl = getPackageMetaUrl(name, undefined, registry);
    const metaRes = await axiosGetWithRetry(metaUrl);
    const metaData = metaRes.data;
    version = metaData['dist-tags']?.latest || Object.keys(metaData.versions).pop() || '';
  }

  // 隐藏光标
  process.stdout.write('\x1b[?25l');

  // 统计依赖
  let countedNum = 0;
  const counted = new Set<string>();
  await countAllDepsFromPackage(
    name,
    version,
    counted,
    registry,
    (pkgName, version, count) => {
      countedNum = count;
      process.stdout.write('\r\x1b[2K');
      process.stdout.write(`已统计依赖数：${countedNum}，当前：${pkgName}@${version}   `);
    }
  );
  const total = counted.size;
  process.stdout.write(`\n依赖总数统计完成，共需下载 ${total} 个依赖。\n`);

  // 下载依赖
  const counters = { finished: 0, failed: 0 };
  const failedList: { name: string; version: string }[] = [];
  const downloaded = new Set<string>();
  try {
    await downloadPackageWithVersion(
      name,
      version,
      downloaded,
      (info) => prettyLogProgress({ ...info, total }),
      counters,
      registry
    );
  } catch (err) {
    prettyLogProgress({ pkgName: name, version, failed: true, current: counters.finished + counters.failed + 1, total });
    counters.failed++;
    failedList.push({ name, version });
  }
  printDownloadSummary(total, counters.finished, counters.failed, failedList);

  // 恢复光标
  process.stdout.write('\x1b[?25h');
}
