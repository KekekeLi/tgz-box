import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import { BASE_PACKAGE_CONTENT, TEMP_DIR, TEMP_PACKAGE_JSON, TEMP_PACKAGE_LOCK } from '../utils/constants';
import { cleanupTempDirectory, ensureDirectoryExists } from '../utils/fileUtils';

const execAsync = promisify(exec);

export async function generateLockFileFromPackage(packageJsonPath: string): Promise<string> {
  cleanupTempDirectory(TEMP_DIR);
  ensureDirectoryExists(TEMP_DIR);

  try {
    // 复制package.json到临时目录
    const packageContent = await fs.readJSON(packageJsonPath);
    await fs.writeJSON(TEMP_PACKAGE_JSON, packageContent, { spaces: 2 });

    // 生成package-lock.json
    await execAsync(`cd ${TEMP_DIR} && npm install --package-lock-only`);
    
    return TEMP_PACKAGE_LOCK;
  } catch (error) {
    cleanupTempDirectory(TEMP_DIR);
    throw new Error('生成package-lock.json失败');
  }
}

export async function generateLockFileFromPackageName(packageName: string): Promise<string> {
  cleanupTempDirectory(TEMP_DIR);
  ensureDirectoryExists(TEMP_DIR);

  try {
    // 创建临时package.json
    const tempPackage = {
      ...BASE_PACKAGE_CONTENT,
      dependencies: {
        [packageName.split('@')[0]]: packageName.includes('@') ? packageName.split('@')[1] : 'latest'
      }
    };
    
    await fs.writeJSON(TEMP_PACKAGE_JSON, tempPackage, { spaces: 2 });

    // 生成package-lock.json
    await execAsync(`cd ${TEMP_DIR} && npm install ${packageName} --package-lock-only`);
    
    return TEMP_PACKAGE_LOCK;
  } catch (error) {
    cleanupTempDirectory(TEMP_DIR);
    throw new Error(`解析包失败: ${packageName}`);
  }
}