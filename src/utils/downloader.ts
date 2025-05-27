import axios from 'axios';
import download from 'download';
import fs from 'fs-extra';
import path from 'path';
import { PackageItem, DownloadProgress } from '../types';
import { PACKAGES_DIR } from './constants';
import { ensureDirectoryExists } from './fileUtils';

export class PackageDownloader {
  private concurrency: number;
  private downloadQueue: Array<() => Promise<void>> = [];
  private activeDownloads = 0;
  private progress: DownloadProgress;
  private onProgress?: (progress: DownloadProgress) => void;
  private maxRetries: number = 3;

  constructor(concurrency = 10) {
    this.concurrency = concurrency;
    this.progress = {
      total: 0,
      completed: 0,
      failed: 0
    };
  }

  setProgressCallback(callback: (progress: DownloadProgress) => void) {
    this.onProgress = callback;
  }

  async downloadPackages(packages: PackageItem[]): Promise<PackageItem[]> {
    ensureDirectoryExists(PACKAGES_DIR);
    
    this.progress = {
      total: packages.length,
      completed: 0,
      failed: 0
    };

    const failedPackages: PackageItem[] = [];
    const promises: Promise<void>[] = [];

    for (const pkg of packages) {
      const promise = this.downloadWithRetry(pkg)
        .then(() => {
          this.progress.completed++;
          this.updateProgress();
        })
        .catch((error) => {
          this.progress.failed++;
          // 保存失败信息
          const failedPkg = { ...pkg, error: error.message };
          failedPackages.push(failedPkg);
          this.updateProgress();
        });
      
      promises.push(promise);
      
      if (promises.length >= this.concurrency) {
        await Promise.allSettled(promises.splice(0, this.concurrency));
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    return failedPackages;
  }

  private async downloadWithRetry(pkg: PackageItem, retryCount = 0): Promise<void> {
    try {
      await this.downloadSinglePackage(pkg);
    } catch (error) {
      if (retryCount < this.maxRetries) {
        // 更新进度显示重试信息
        this.progress.current = `重试 ${retryCount + 1}/${this.maxRetries}: ${pkg.name}`;
        this.updateProgress();
        
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.downloadWithRetry(pkg, retryCount + 1);
      } else {
        throw error;
      }
    }
  }

  private async downloadSinglePackage(pkg: PackageItem): Promise<void> {
    this.progress.current = pkg.name;
    this.updateProgress();

    const packageDir = path.join(PACKAGES_DIR, pkg.path);
    ensureDirectoryExists(packageDir);

    try {
      // 下载tgz文件
      await download(pkg.resolved, packageDir);
      
      // 检查是否已存在package.json，如果存在且有效则跳过
      const packageJsonPath = path.join(packageDir, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        try {
          const existingContent = await fs.readJSON(packageJsonPath);
          if (existingContent && existingContent.name) {
            return; // package.json已存在且有效
          }
        } catch {
          // 文件损坏，继续重新下载
        }
      }
      
      // 获取并保存package.json
      const packageInfoUrl = pkg.resolved.split('/-/')[0];
      const response = await axios.get(packageInfoUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'tgz-box'
        }
      });
      
      await fs.writeJSON(
        packageJsonPath,
        response.data,
        { spaces: 2 }
      );
    } catch (error) {
      // 清理可能的部分下载文件
      try {
        await fs.remove(packageDir);
      } catch {
        // 忽略清理错误
      }
      throw new Error(`下载失败: ${pkg.name}@${pkg.version} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private updateProgress() {
    if (this.onProgress) {
      this.onProgress({ ...this.progress });
    }
  }
}