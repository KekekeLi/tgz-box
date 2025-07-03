import fs from 'fs-extra';
import path from 'path';
import { PackageItem } from '../types';
import { TEMP_DIR } from './constants';

/**
 * 失败包管理器
 * 负责管理下载失败的包，实现缓存、重试和最终生成package.json的逻辑
 */
export class FailedPackageManager {
  private failedPackages: Map<string, PackageItem> = new Map();
  private retryCount: number = 0;
  private maxRetries: number = 2;
  private cacheFilePath: string;

  constructor(maxRetries: number = 2) {
    this.maxRetries = maxRetries;
    this.cacheFilePath = path.join(TEMP_DIR, 'failed-packages-cache.json');
    this.loadFromCache();
  }

  /**
   * 添加失败的包到缓存
   */
  addFailedPackage(pkg: PackageItem, error: string): void {
    const key = `${pkg.name}@${pkg.version}`;
    this.failedPackages.set(key, {
      ...pkg,
      error
    });
    this.saveToCache();
  }

  /**
   * 检查包是否在失败缓存中
   */
  isPackageFailed(pkg: PackageItem): boolean {
    const key = `${pkg.name}@${pkg.version}`;
    return this.failedPackages.has(key);
  }

  /**
   * 获取所有失败的包
   */
  getFailedPackages(): PackageItem[] {
    return Array.from(this.failedPackages.values());
  }

  /**
   * 清除失败包缓存
   */
  clearFailedPackages(): void {
    this.failedPackages.clear();
    this.saveToCache();
  }

  /**
   * 从失败缓存中移除成功下载的包
   */
  removeSuccessfulPackage(pkg: PackageItem): void {
    const key = `${pkg.name}@${pkg.version}`;
    this.failedPackages.delete(key);
    this.saveToCache();
  }

  /**
   * 获取当前重试次数
   */
  getCurrentRetryCount(): number {
    return this.retryCount;
  }

  /**
   * 增加重试次数
   */
  incrementRetryCount(): void {
    this.retryCount++;
  }

  /**
   * 检查是否还能重试
   */
  canRetry(): boolean {
    return this.retryCount < this.maxRetries;
  }

  /**
   * 重置重试计数
   */
  resetRetryCount(): void {
    this.retryCount = 0;
  }

  /**
   * 生成失败包的package.json文件
   */
  async generateFailedPackageJson(outputPath: string = './failed-packages.json'): Promise<void> {
    if (this.failedPackages.size === 0) {
      return;
    }

    const failedPackageData = {
      name: 'failed-packages',
      version: '1.0.0',
      description: 'Failed packages that could not be downloaded after retries',
      dependencies: {} as Record<string, string>,
      failedPackages: [] as Array<{
        name: string;
        version: string;
        resolved: string;
        error: string;
        retryCount: number;
      }>
    };

    // 构建dependencies和failedPackages信息
    for (const pkg of this.failedPackages.values()) {
      failedPackageData.dependencies[pkg.name] = pkg.version;
      failedPackageData.failedPackages.push({
        name: pkg.name,
        version: pkg.version,
        resolved: pkg.resolved,
        error: pkg.error || 'Unknown error',
        retryCount: this.retryCount
      });
    }

    await fs.writeJSON(outputPath, failedPackageData, { spaces: 2 });
    console.log(`\n失败包信息已保存到: ${outputPath}`);
    console.log(`包含 ${this.failedPackages.size} 个无法下载的包`);
  }

  /**
   * 保存失败包缓存到文件
   */
  private async saveToCache(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.cacheFilePath));
      const cacheData = {
        retryCount: this.retryCount,
        failedPackages: Array.from(this.failedPackages.entries())
      };
      await fs.writeJSON(this.cacheFilePath, cacheData, { spaces: 2 });
    } catch (error) {
      // 忽略缓存保存错误
    }
  }

  /**
   * 从文件加载失败包缓存
   */
  private async loadFromCache(): Promise<void> {
    try {
      if (await fs.pathExists(this.cacheFilePath)) {
        const cacheData = await fs.readJSON(this.cacheFilePath);
        this.retryCount = cacheData.retryCount || 0;
        this.failedPackages = new Map(cacheData.failedPackages || []);
      }
    } catch (error) {
      // 忽略缓存加载错误，使用默认值
      this.failedPackages = new Map();
      this.retryCount = 0;
    }
  }

  /**
   * 清理缓存文件
   */
  async cleanup(): Promise<void> {
    try {
      if (await fs.pathExists(this.cacheFilePath)) {
        await fs.remove(this.cacheFilePath);
      }
    } catch (error) {
      // 忽略清理错误
    }
  }

  /**
   * 获取失败包统计信息
   */
  getStatistics(): {
    totalFailed: number;
    retryCount: number;
    maxRetries: number;
    canRetry: boolean;
  } {
    return {
      totalFailed: this.failedPackages.size,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      canRetry: this.canRetry()
    };
  }
}

// 导出单例实例
export const failedPackageManager = new FailedPackageManager();