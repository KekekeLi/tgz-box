import axios from 'axios';
import download from 'download';
import fs from 'fs-extra';
import path from 'path';
import { PackageItem, DownloadProgress } from '../types';
import { PACKAGES_DIR } from './constants';
import { ensureDirectoryExists } from './fileUtils';
import { networkOptimizer } from './networkOptimizer';
import { failedPackageManager } from './failedPackageManager';

// 信号量类，用于控制并发
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        resolve(() => this.release());
      } else {
        this.waitQueue.push(() => {
          this.permits--;
          resolve(() => this.release());
        });
      }
    });
  }

  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }
}

export class PackageDownloader {
  private concurrency: number;
  private downloadQueue: Array<() => Promise<void>> = [];
  private activeDownloads = 0;
  private progress: DownloadProgress;
  private onProgress?: (progress: DownloadProgress) => void;
  private maxRetries: number = 3;
  private downloadAgent: any;

  constructor(concurrency = 30) { // 提高默认并发数
    this.concurrency = concurrency;
    this.progress = {
      total: 0,
      completed: 0,
      failed: 0
    };
    
    // 创建优化的下载代理
    this.downloadAgent = {
      http: new (require('http').Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: concurrency * 2,
        maxFreeSockets: 10
      }),
      https: new (require('https').Agent)({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: concurrency * 2,
        maxFreeSockets: 10
      })
    };
  }

  setProgressCallback(callback: (progress: DownloadProgress) => void) {
    this.onProgress = callback;
  }

  async downloadPackages(packages: PackageItem[], skipFailed: boolean = true): Promise<PackageItem[]> {
    ensureDirectoryExists(PACKAGES_DIR);
    
    // 过滤出需要下载的包（跳过已失败的包）
    const packagesToDownload = skipFailed 
      ? packages.filter(pkg => !failedPackageManager.isPackageFailed(pkg))
      : packages;
    
    const skippedCount = packages.length - packagesToDownload.length;
    
    if (skippedCount > 0 && skipFailed) {
      console.log(`跳过 ${skippedCount} 个之前失败的包，将在最后重试`);
    }
    
    this.progress = {
      total: packagesToDownload.length,
      completed: 0,
      failed: 0
    };

    const failedPackages: PackageItem[] = [];
    const semaphore = new Semaphore(this.concurrency);

    // 使用Promise.allSettled处理所有下载任务
    const downloadPromises = packagesToDownload.map(async (pkg) => {
      return semaphore.acquire().then(async (release) => {
        try {
          await this.downloadWithRetry(pkg);
          this.progress.completed++;
          // 如果之前失败过，现在成功了，从失败缓存中移除
          failedPackageManager.removeSuccessfulPackage(pkg);
          this.updateProgress();
        } catch (error: any) {
          this.progress.failed++;
          const failedPkg = { ...pkg, error: error.message };
          failedPackages.push(failedPkg);
          // 添加到失败包管理器
          failedPackageManager.addFailedPackage(pkg, error.message);
          this.updateProgress();
        } finally {
          release();
        }
      });
    });

    await Promise.allSettled(downloadPromises);
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
        
        // 指数退避重试策略
        const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
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
      // 检查是否已存在特定版本的文件
      const packageJsonPath = path.join(packageDir, 'package.json');
      const expectedTgzName = `${pkg.name}-${pkg.version}.tgz`;
      const expectedTgzPath = path.join(packageDir, expectedTgzName);
      
      if (await fs.pathExists(packageJsonPath) && await fs.pathExists(expectedTgzPath)) {
        try {
          const existingContent = await fs.readJSON(packageJsonPath);
          if (existingContent && existingContent.name) {
            return; // 特定版本文件已存在且完整
          }
        } catch {
          // 文件损坏，继续重新下载
        }
      }
      
      // 使用优化的下载配置
      const downloadOptions = {
        agent: this.downloadAgent,
        timeout: 30000, // 增加超时时间到30秒
        retries: 3, // 增加重试次数
        headers: {
          'User-Agent': 'tgz-box-optimized/1.0.0',
          'Connection': 'keep-alive'
        }
      };
      
      // 下载tgz文件
      await download(pkg.resolved, packageDir, downloadOptions);
      
      // 获取并保存package.json（使用网络优化器）
      const packageInfoUrl = pkg.resolved.split('/-/')[0];
      const packageInfo = await networkOptimizer.getWithRetry(packageInfoUrl);
      
      await fs.writeJSON(
        packageJsonPath,
        packageInfo,
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