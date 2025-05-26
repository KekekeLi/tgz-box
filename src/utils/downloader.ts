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
      const promise = this.downloadSinglePackage(pkg)
        .then(() => {
          this.progress.completed++;
          this.updateProgress();
        })
        .catch(() => {
          this.progress.failed++;
          failedPackages.push(pkg);
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

  private async downloadSinglePackage(pkg: PackageItem): Promise<void> {
    this.progress.current = pkg.name;
    this.updateProgress();

    const packageDir = path.join(PACKAGES_DIR, pkg.path);
    ensureDirectoryExists(packageDir);

    try {
      // 下载tgz文件
      await download(pkg.resolved, packageDir);
      
      // 获取并保存package.json
      const packageInfoUrl = pkg.resolved.split('/-/')[0];
      const response = await axios.get(packageInfoUrl);
      
      await fs.writeJSON(
        path.join(packageDir, 'package.json'),
        response.data,
        { spaces: 2 }
      );
    } catch (error) {
      throw new Error(`下载失败: ${pkg.name}@${pkg.version}`);
    }
  }

  private updateProgress() {
    if (this.onProgress) {
      this.onProgress({ ...this.progress });
    }
  }
}