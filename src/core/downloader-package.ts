import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  downloadAllFromLockDeps,
  readLock,
  parseLock
} from '../utils/downloaderUtils.js';

const execAsync = promisify(exec);

export async function downloadAllFromPackage(registry?: string) {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');
  const tempDir = path.join(cwd, '.temp');
  const tempPkgPath = path.join(tempDir, 'package.json');
  const tempLockPath = path.join(tempDir, 'package-lock.json');

  if (!fs.existsSync(pkgPath)) {
    console.error('package.json not found');
    return;
  }

  // 清理临时目录
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir);

  // 拷贝 package.json
  fs.copyFileSync(pkgPath, tempPkgPath);

  // 生成 package-lock.json
  process.stdout.write('\x1b[36m[进度]\x1b[0m 正在解析 package.json...\n');
  try {
    await execAsync('npm install --package-lock-only', { cwd: tempDir });
  } catch (err) {
    console.error('\x1b[31m[错误]\x1b[0m 解析package.json 失败:', err);
    fs.rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  // 读取 lock 文件
  if (!fs.existsSync(tempLockPath)) {
    console.error('\x1b[31m[错误]\x1b[0m 解析package.json 失败');
    fs.rmSync(tempDir, { recursive: true, force: true });
    return;
  }

  const ctx: LockData = await readLock(tempLockPath);

  // 统计依赖数量并美化提示
  const packages = parseLock(ctx);
  let counted = 0;
  const total = packages.length;
  const startTime = Date.now();
  let points = ['', '.', '.', '.', '..', '..', '..', '...', '...', '...'];
  let i = 0;
  process.stdout.write('\x1b[36m[进度]\x1b[0m 正在统计依赖数量...\n');
  const statInterval = setInterval(() => {
    process.stdout.write(
      `\r\x1b[36m[统计依赖]\x1b[0m${points[i]} 已发现依赖: ${counted}/${total}  耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`
    );
    if (i >= points.length - 1) {
      i = 0;
    } else {
      i++;
    }
  }, 200);

  // 实际统计依赖（这里直接用 packages.length，若需递归统计可调用 countAllDepsFromLock）
  counted = total;
  clearInterval(statInterval);
  process.stdout.write(
    `\r\x1b[32m[完成]\x1b[0m 共发现依赖: ${total} 个，耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`
  );

  // 下载依赖并美化提示
  let residue = total;
  let failed = 0;
  const downloadStart = Date.now();
  let failures: { name: string; version: string }[] = [];
  let downloadPoints = ['', '.', '.', '.', '..', '..', '..', '...', '...', '...'];
  let j = 0;
  const downloadInterval = setInterval(() => {
    process.stdout.write(
      `\r\x1b[36m[下载中]\x1b[0m${downloadPoints[j]} 总数: ${total}  剩余: ${residue}  失败: ${failed}  耗时: ${((Date.now() - downloadStart) / 1000).toFixed(1)}s`
    );
    if (j >= downloadPoints.length - 1) {
      j = 0;
    } else {
      j++;
    }
  }, 200);

  await downloadAllFromLockDeps(
    packages,
    (info) => {
      residue = total - info.current;
      if (info.failed) {
        failed++;
        failures.push({ name: info.pkgName, version: info.version });
      }
    },
    registry
  );

  clearInterval(downloadInterval);
  if (failed > 0) {
    process.stdout.write(
      `\n\x1b[31m[失败]\x1b[0m 下载失败 ${failed} 个依赖:\n`
    );
    failures.forEach(item => {
      process.stdout.write(`  - ${item.name}@${item.version}\n`);
    });
  } else {
    process.stdout.write(`\n\x1b[32m[完成]\x1b[0m 所有依赖下载完成！\n`);
  }
  process.stdout.write(
    `总计: ${total}，成功: ${total - failed}，失败: ${failed}，耗时: ${((Date.now() - downloadStart) / 1000).toFixed(1)}s\n`
  );

  // 删除临时目录
  fs.rmSync(tempDir, { recursive: true, force: true });
}
