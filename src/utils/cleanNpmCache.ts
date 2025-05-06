import { execSync } from 'child_process';

export function cleanNpmCache() {
  try {
    execSync('npm cache clean --force', { stdio: 'inherit' });
  } catch (e) {
    console.warn('清理 npm 缓存失败，可忽略。');
  }
}