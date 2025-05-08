import fs from 'fs';
import path from 'path';
import {
  countAllDepsFromLock,
  downloadAllFromLockDeps,
  prettyLogProgress,
  printDownloadSummary
} from '../utils/downloaderUtils.js';

export async function downloadAllFromLock(registry?: string) {
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.error('package-lock.json not found');
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  if (!lock.dependencies) {
    console.error('No dependencies found in package-lock.json');
    return;
  }

  // 隐藏光标
  process.stdout.write('\x1b[?25l');

  // 统计依赖
  let countedNum = 0;
  const countedSet = new Set<string>();
  countAllDepsFromLock(lock.dependencies, countedSet, (name, version, count) => {
    countedNum = count;
    process.stdout.write('\r\x1b[2K');
    process.stdout.write(`已统计依赖数：${countedNum}，当前：${name}@${version}   `);
  });
  const total = countedSet.size;
  process.stdout.write(`\n依赖总数统计完成，共需下载 ${total} 个依赖。\n`);

  // 下载依赖
  const counters = { finished: 0, failed: 0 };
  const failedList: { name: string; version: string }[] = [];
  const downloaded = new Set<string>();
  await downloadAllFromLockDeps(
    lock.dependencies,
    (info) => prettyLogProgress({ ...info, total }),
    registry
  );

  printDownloadSummary(total, counters.finished, counters.failed, failedList);

  // 恢复光标
  process.stdout.write('\x1b[?25h');
}