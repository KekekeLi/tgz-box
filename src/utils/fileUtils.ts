import fs from 'fs-extra';
import path from 'path';
import { LockData } from '../types';
import { PACKAGE_JSON_PATH, PACKAGE_LOCK_PATH } from './constants';

export function checkFilesExistence(): {
  hasPackageJson: boolean;
  hasPackageLock: boolean;
} {
  return {
    hasPackageJson: fs.existsSync(PACKAGE_JSON_PATH),
    hasPackageLock: fs.existsSync(PACKAGE_LOCK_PATH)
  };
}

export async function readLockFile(filePath: string): Promise<LockData> {
  try {
    const content = await fs.readJSON(filePath);
    return content;
  } catch (error) {
    throw new Error(`读取文件失败: ${filePath}`);
  }
}

export async function readPackageJson(filePath: string): Promise<any> {
  try {
    const content = await fs.readJSON(filePath);
    return content;
  } catch (error) {
    throw new Error(`读取package.json失败: ${filePath}`);
  }
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirpSync(dirPath);
  }
}

export function cleanupTempDirectory(tempDir: string): void {
  if (fs.existsSync(tempDir)) {
    fs.removeSync(tempDir);
  }
}