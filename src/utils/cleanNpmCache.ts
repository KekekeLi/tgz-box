import { execSync } from 'child_process';

export function cleanNpmCache() {
  try {
    execSync('npm cache clean --force', { stdio: 'inherit' });
    // 清理成功提示
    console.log('\x1b[32m✔ npm 缓存清理成功\x1b[0m');
  } catch (e) {
    console.warn('清理 npm 缓存失败，可忽略。');
  }
}