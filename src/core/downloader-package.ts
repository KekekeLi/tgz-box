import axios from 'axios';
import fs from 'fs';
import path from 'path';
import {
  downloadPackageWithVersion,
  countAllDepsFromPackage,
  prettyLogProgress,
  printDownloadSummary
} from '../utils/downloaderUtils.js';

export async function downloadAllFromPackage(registry?: string) {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('package.json not found');
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depNames = Object.keys(deps);

  // 隐藏光标
  process.stdout.write('\x1b[?25l');

  // 统计依赖
  let countedNum = 0;
  process.stdout.write('正在统计依赖总数，请稍候...\n');
  const counted = new Set<string>();
  for (const name of depNames) {
    const version = deps[name];
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
  }
  const total = counted.size;
  process.stdout.write(`\n依赖总数统计完成，共需下载 ${total} 个依赖。\n`);

  // 下载依赖
  const counters = { finished: 0, failed: 0 };
  const failedList: { name: string; version: string }[] = [];
  const downloaded = new Set<string>();
  for (const name of depNames) {
    const version = deps[name];
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
  }

  printDownloadSummary(total, counters.finished, counters.failed, failedList);

  // 恢复光标
  process.stdout.write('\x1b[?25h');
}
