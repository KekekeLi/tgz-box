import fs from 'fs';
import path from 'path';
import {
  downloadPackageWithVersion,
} from '../utils/downloaderUtils.js';

function countAllDeps(deps: any, counted = new Set<string>()) {
  let count = 0;
  for (const name in deps) {
    const dep = deps[name];
    const key = `${name}@${dep.version}`;
    if (counted.has(key)) continue;
    counted.add(key);
    count++;
    if (dep.dependencies) {
      count += countAllDeps(dep.dependencies, counted);
    }
  }
  return count;
}

export async function downloadAllFromLock(registry?: string) {
  const lockPath = path.join(process.cwd(), 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    console.error('package-lock.json not found');
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  const downloaded = new Set<string>();

  // 1. 先统计所有唯一依赖的总数
  let total = 0;
  let countedSet = new Set<string>();
  if (lock.dependencies) {
    total = countAllDeps(lock.dependencies, countedSet);
  }
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

  async function walkDeps(deps: any) {
    for (const name in deps) {
      const dep = deps[name];
      const key = `${name}@${dep.version}`;
      if (downloaded.has(key)) continue; // 防止重复下载
      if (dep.version) {
        await downloadPackageWithVersion(name, dep.version, downloaded, logProgress, totalCount, registry);
      }
      if (dep.dependencies) {
        await walkDeps(dep.dependencies);
      }
    }
  }

  if (lock.dependencies) {
    await walkDeps(lock.dependencies);
    console.log(`\n全部依赖下载完成！共下载 ${totalCount.finished}/${totalCount.value} 个依赖。`);
  }
}