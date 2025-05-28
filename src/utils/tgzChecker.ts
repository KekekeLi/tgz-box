import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { PackageDownloader } from './downloader';
import { PackageItem } from '../types';
import { TEMP_DIR } from './constants';
import { ensureDirectoryExists } from './fileUtils';

interface CheckResult {
  code: number; // -1: error, 0: warning, 1: success
  message: string;
}

interface PackageIntegrity {
  packageName: string;
  packagePath: string;
  hasPackageJson: boolean;
  hasTgzFile: boolean;
  missingFiles: string[];
}

interface VersionMismatchInfo {
  packageName: string;
  packagePath: string;
  currentVersion: string;
  expectedVersion: string;
  downloadUrl?: string;
}

interface CheckSummary {
  totalPackages: number;
  incompletePackages: PackageIntegrity[];
  versionMismatchPackages: VersionMismatchInfo[];
  downloadedVersions: string[];
  errors: string[];
}

/**
 * 检查指定目录中的npm包完整性和版本匹配
 * @param directory 要检查的目录路径（通常是packages目录）
 * @param downloadMissingVersions 是否下载缺失的版本
 * @returns 检查结果摘要
 */
export async function checkTgzFiles(directory: string, downloadMissingVersions = false): Promise<CheckSummary> {
  const spinner = ora('正在检查依赖完整性...');
  spinner.start();
  
  const summary: CheckSummary = {
    totalPackages: 0,
    incompletePackages: [],
    versionMismatchPackages: [],
    downloadedVersions: [],
    errors: []
  };
  
  try {
    // 第一步：检查文件完整性
    await checkPackageIntegrity(directory, summary, spinner);
    
    // 如果有不完整的包，生成临时文件
    if (summary.incompletePackages.length > 0) {
      await generateIncompletePackagesFile(summary.incompletePackages);
      spinner.warn(`发现 ${summary.incompletePackages.length} 个依赖存在文件缺失`);
      console.log(chalk.yellow(`\n⚠️  有 ${summary.incompletePackages.length} 个依赖存在文件缺失，请重新下载这些依赖`));
      console.log(chalk.blue(`缺失依赖信息已保存到: ${path.join(TEMP_DIR, 'incomplete-packages.json')}`));
    }
    
    // 第二步：检查版本匹配（跳过不完整的包）
    spinner.text = '正在检查版本匹配...';
    await checkVersionMatching(directory, summary, spinner);
    
    // 版本匹配检查完成提示
    if (summary.versionMismatchPackages.length > 0) {
      spinner.succeed(`版本匹配检查完成，发现 ${summary.versionMismatchPackages.length} 个依赖版本不匹配`);
    } else {
      spinner.succeed('版本匹配检查完成，所有版本都匹配');
    }
    
    // 第三步：下载缺失的版本（如果需要）
    if (downloadMissingVersions && summary.versionMismatchPackages.length > 0) {
      console.log(chalk.blue(`\n🔄 正在下载最新版本...`));
      await downloadMissingVersions_internal(summary);
    }
    
    return summary;
  } catch (error) {
    spinner.fail('检查过程中发生错误');
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }
}

/**
 * 检查包的文件完整性
 */
async function checkPackageIntegrity(directory: string, summary: CheckSummary, spinner: any): Promise<void> {
  const items = await fs.readdir(directory);
  
  for (const item of items) {
    const fullPath = path.join(directory, item);
    const stat = await fs.lstat(fullPath);
    
    if (stat.isDirectory()) {
      await checkPackageIntegrity(fullPath, summary, spinner);
    } else if (item === 'package.json') {
      summary.totalPackages++;
      spinner.text = `正在检查包完整性 ${summary.totalPackages}...`;
      
      const packageDir = path.dirname(fullPath);
      const packageName = await getPackageNameFromJson(fullPath);
      
      if (packageName) {
        const integrity = await checkSinglePackageIntegrity(packageName, packageDir);
        if (!integrity.hasPackageJson || !integrity.hasTgzFile) {
          summary.incompletePackages.push(integrity);
        }
      }
    }
  }
}

/**
 * 检查单个包的完整性
 */
async function checkSinglePackageIntegrity(packageName: string, packageDir: string): Promise<PackageIntegrity> {
  const packageJsonPath = path.join(packageDir, 'package.json');
  const contents = await fs.readdir(packageDir);
  
  const hasPackageJson = await fs.pathExists(packageJsonPath);
  const tgzFiles = contents.filter(file => path.extname(file) === '.tgz');
  const hasTgzFile = tgzFiles.length > 0;
  
  const missingFiles: string[] = [];
  if (!hasPackageJson) missingFiles.push('package.json');
  if (!hasTgzFile) missingFiles.push('.tgz文件');
  
  return {
    packageName,
    packagePath: packageDir,
    hasPackageJson,
    hasTgzFile,
    missingFiles
  };
}

/**
 * 检查版本匹配
 */
async function checkVersionMatching(directory: string, summary: CheckSummary, spinner: any): Promise<void> {
  const items = await fs.readdir(directory);
  let checkedCount = 0;
  
  for (const item of items) {
    const fullPath = path.join(directory, item);
    const stat = await fs.lstat(fullPath);
    
    if (stat.isDirectory()) {
      await checkVersionMatching(fullPath, summary, spinner);
    } else if (item === 'package.json') {
      const packageDir = path.dirname(fullPath);
      const packageName = await getPackageNameFromJson(fullPath);
      
      if (packageName) {
        // 跳过不完整的包
        const isIncomplete = summary.incompletePackages.some(pkg => pkg.packageName === packageName);
        if (isIncomplete) continue;
        
        checkedCount++;
        spinner.text = `正在检查版本匹配 ${checkedCount}/${summary.totalPackages - summary.incompletePackages.length}...`;
        
        const versionInfo = await checkPackageVersionMatch(fullPath, packageDir);
        if (versionInfo) {
          summary.versionMismatchPackages.push(versionInfo);
        }
      }
    }
  }
}

/**
 * 检查单个包的版本匹配
 */
async function checkPackageVersionMatch(packageJsonPath: string, packageDir: string): Promise<VersionMismatchInfo | null> {
  try {
    const packageContent = await fs.readJSON(packageJsonPath);
    const packageName = packageContent.name;
    
    if (!packageContent['dist-tags'] || !packageContent['dist-tags']['latest']) {
      return null;
    }
    
    const expectedVersion = packageContent['dist-tags']['latest'];
    const contents = await fs.readdir(packageDir);
    const tgzFiles = contents.filter(file => path.extname(file) === '.tgz');
    
    if (tgzFiles.length === 0) {
      return null;
    }
    
    const hasExpectedVersion = tgzFiles.some(file => file.includes(expectedVersion));
    
    if (!hasExpectedVersion) {
      return {
        packageName,
        packagePath: packageDir,
        currentVersion: getVersionFromFileName(tgzFiles[0]) || 'unknown',
        expectedVersion
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 下载缺失的版本
 */
async function downloadMissingVersions_internal(summary: CheckSummary): Promise<void> {
  if (summary.versionMismatchPackages.length === 0) return;
  
  // 并发获取下载链接
  const spinner = ora('正在获取下载链接...');
  spinner.start();
  
  const packagesToDownload: PackageItem[] = [];
  const totalCount = summary.versionMismatchPackages.length;
  let completedCount = 0;
  
  // 使用 Promise.allSettled 进行并发查询
  const downloadPromises = summary.versionMismatchPackages.map(async (pkg, index) => {
    try {
      const downloadUrl = await getPackageDownloadUrl(pkg.packageName, pkg.expectedVersion);
      
      // 更新进度
      completedCount++;
      spinner.text = `获取下载链接进度: ${completedCount}/${totalCount} - ${pkg.packageName}`;
      
      return {
        success: true,
        pkg,
        downloadUrl,
        index
      };
    } catch (error) {
      // 更新进度
      completedCount++;
      spinner.text = `获取下载链接进度: ${completedCount}/${totalCount} - ${pkg.packageName} (失败)`;
      
      return {
        success: false,
        pkg,
        error: error instanceof Error ? error.message : String(error),
        index
      };
    }
  });
  
  const results = await Promise.allSettled(downloadPromises);
  
  // 处理结果
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { success, pkg, downloadUrl, error } = result.value;
      
      if (success && downloadUrl) {
        packagesToDownload.push({
          name: pkg.packageName,
          version: pkg.expectedVersion,
          resolved: downloadUrl,
          path: path.relative(path.resolve('./packages'), pkg.packagePath)
        });
        pkg.downloadUrl = downloadUrl;
      } else {
        summary.errors.push(`获取 ${pkg.packageName}@${pkg.expectedVersion} 下载链接失败: ${error || '未知错误'}`);
      }
    } else {
      // Promise 本身被拒绝的情况
      summary.errors.push(`获取下载链接时发生错误: ${result.reason}`);
    }
  }
  
  spinner.succeed(`获取到 ${packagesToDownload.length} 个下载链接`);
  
  if (packagesToDownload.length === 0) {
    console.log(chalk.yellow('没有可下载的包'));
    return;
  }
  
  // 使用downloader下载
  const downloader = new PackageDownloader(10);
  let currentSpinner: any;
  
  downloader.setProgressCallback((progress) => {
    const percentage = ((progress.completed + progress.failed) / progress.total * 100).toFixed(1);
    const message = [
      `下载进度: ${progress.completed + progress.failed}/${progress.total} (${percentage}%)`,
      `成功: ${progress.completed}`,
      `失败: ${progress.failed}`,
      progress.current ? `当前: ${progress.current}` : ''
    ].filter(Boolean).join(' | ');
    
    if (currentSpinner) {
      currentSpinner.text = message;
    }
  });
  
  currentSpinner = ora('开始下载最新版本依赖...').start();
  
  try {
    const failedPackages = await downloader.downloadPackages(packagesToDownload);
    currentSpinner.stop();
    
    const successCount = packagesToDownload.length - failedPackages.length;
    summary.downloadedVersions = packagesToDownload
      .filter(pkg => !failedPackages.some(failed => failed.name === pkg.name))
      .map(pkg => `${pkg.name}@${pkg.version}`);
    
    console.log(chalk.green(`\n✅ 下载完成`));
    
    if (failedPackages.length > 0) {
      console.log(chalk.red(`下载失败: ${failedPackages.length} 个版本`));
      failedPackages.forEach(pkg => {
        summary.errors.push(`下载失败: ${pkg.name}@${pkg.version} - ${pkg.error || '未知错误'}`);
      });
    }
  } catch (error) {
    currentSpinner.fail('下载过程中发生错误');
    summary.errors.push(`下载失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取包的下载URL
 */
async function getPackageDownloadUrl(packageName: string, version: string): Promise<string | null> {
  try {
    const registryUrl = `https://registry.npmjs.org/${packageName}/${version}`;
    const response = await axios.get(registryUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'tgz-box'
      }
    });
    
    return response.data.dist?.tarball || null;
  } catch (error) {
    return null;
  }
}

/**
 * 生成不完整包的信息文件
 */
async function generateIncompletePackagesFile(incompletePackages: PackageIntegrity[]): Promise<void> {
  ensureDirectoryExists(TEMP_DIR);
  
  const incompleteInfo = {
    timestamp: new Date().toISOString(),
    totalIncomplete: incompletePackages.length,
    packages: incompletePackages.map(pkg => ({
      name: pkg.packageName,
      path: pkg.packagePath,
      missingFiles: pkg.missingFiles
    }))
  };
  
  const filePath = path.join(TEMP_DIR, 'incomplete-packages.json');
  await fs.writeJSON(filePath, incompleteInfo, { spaces: 2 });
}

/**
 * 从package.json获取包名
 */
async function getPackageNameFromJson(packageJsonPath: string): Promise<string | null> {
  try {
    const content = await fs.readJSON(packageJsonPath);
    return content.name || null;
  } catch {
    return null;
  }
}

/**
 * 从文件名中提取版本号
 */
function getVersionFromFileName(fileName: string): string | null {
  const match = fileName.match(/-(\d+\.\d+\.\d+.*?)\.tgz$/);
  return match ? match[1] : null;
}

/**
 * 检查单个包的tgz文件（保持向后兼容）
 */
export async function checkSinglePackage(packageName: string, directory: string, downloadMissingVersion = false): Promise<CheckResult> {
  const packagePath = path.join(directory, packageName);
  
  if (!await fs.pathExists(packagePath)) {
    return {
      code: -1,
      message: `包目录不存在: ${packageName}`
    };
  }
  
  // 检查完整性
  const integrity = await checkSinglePackageIntegrity(packageName, packagePath);
  
  if (!integrity.hasPackageJson || !integrity.hasTgzFile) {
    return {
      code: -1,
      message: `包不完整: ${packageName}，缺失: ${integrity.missingFiles.join(', ')}`
    };
  }
  
  // 检查版本匹配
  const packageJsonPath = path.join(packagePath, 'package.json');
  const versionInfo = await checkPackageVersionMatch(packageJsonPath, packagePath);
  
  if (versionInfo) {
    if (downloadMissingVersion) {
      // 下载最新版本
      const summary: CheckSummary = {
        totalPackages: 1,
        incompletePackages: [],
        versionMismatchPackages: [versionInfo],
        downloadedVersions: [],
        errors: []
      };
      
      await downloadMissingVersions_internal(summary);
      
      if (summary.downloadedVersions.length > 0) {
        return {
          code: 1,
          message: `已下载最新版本: ${versionInfo.packageName}@${versionInfo.expectedVersion}`
        };
      } else {
        return {
          code: 0,
          message: `版本不匹配但下载失败: ${versionInfo.packageName}`
        };
      }
    } else {
      return {
        code: 0,
        message: `版本不匹配: ${versionInfo.packageName} (当前: ${versionInfo.currentVersion}, 期望: ${versionInfo.expectedVersion})`
      };
    }
  }
  
  return {
    code: 1,
    message: ''
  };
}

/**
 * 打印检查结果摘要
 */
export function printCheckSummary(summary: CheckSummary): void {
  console.log(chalk.bold('\n📊 依赖检查摘要:'));
  console.log(chalk.blue(`总包数: ${summary.totalPackages}`));
  
  if (summary.incompletePackages.length > 0) {
    console.log(chalk.red(`文件不完整的包: ${summary.incompletePackages.length}个`));
  }
  
  if (summary.versionMismatchPackages.length > 0) {
    console.log(chalk.yellow(`版本不匹配的包: ${summary.versionMismatchPackages.length}个`));
  }
  
  if (summary.downloadedVersions.length > 0) {
    console.log(chalk.green(`已下载版本: ${summary.downloadedVersions.length}个`));
  }
  
  if (summary.errors.length > 0) {
    console.log(chalk.red(`处理错误: ${summary.errors.length}个`));
  }
}