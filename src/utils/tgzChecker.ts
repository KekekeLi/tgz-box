import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import semver from 'semver';
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



interface CheckSummary {
  totalPackages: number;
  incompletePackages: PackageIntegrity[];
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
  const summary: CheckSummary = {
    totalPackages: 0,
    incompletePackages: [],
    downloadedVersions: [],
    errors: []
  };
  
  try {
    // 统一扫描：一次性获取所有包的信息
    const packageInfoMap = new Map<string, { currentVersion: string, packagePath: string, hasPackageJson: boolean, hasTgzFile: boolean }>();
    await scanAllPackages(directory, packageInfoMap, summary);
    
    // 检查文件完整性
    packageInfoMap.forEach((info, packageName) => {
      if (!info.hasPackageJson || !info.hasTgzFile) {
        const missingFiles: string[] = [];
        if (!info.hasPackageJson) missingFiles.push('package.json');
        if (!info.hasTgzFile) missingFiles.push('.tgz文件');
        
        summary.incompletePackages.push({
          packageName,
          packagePath: info.packagePath,
          hasPackageJson: info.hasPackageJson,
          hasTgzFile: info.hasTgzFile,
          missingFiles
        });
      }
    });
    
    // 如果有不完整的包，生成临时文件
    if (summary.incompletePackages.length > 0) {
      await generateIncompletePackagesFile(summary.incompletePackages);
      console.log(chalk.yellow(`\n⚠️  发现 ${summary.incompletePackages.length} 个依赖存在文件缺失，请重新下载这些依赖`));
      console.log(chalk.blue(`缺失依赖信息已保存到: ${path.join(TEMP_DIR, 'incomplete-packages.json')}`));
    } else {
      console.log(chalk.green('\n✅ 所有依赖文件完整'));
    }
    
    // 下载每个包的major版本（如果需要）
    if (downloadMissingVersions && packageInfoMap.size > 0) {
      console.log(chalk.blue(`\n🔄 开始下载依赖的所有major最高版本...`));
      await downloadMajorVersionsOptimized(packageInfoMap, summary);
    }
    
    return summary;
  } catch (error) {
    console.error(chalk.red('检查过程中发生错误:'), error instanceof Error ? error.message : String(error));
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }
}

/**
 * 统一扫描所有包的信息（完整性和版本信息）
 */
async function scanAllPackages(
  directory: string, 
  packageInfoMap: Map<string, { currentVersion: string, packagePath: string, hasPackageJson: boolean, hasTgzFile: boolean }>,
  summary: CheckSummary
): Promise<void> {
  const items = await fs.readdir(directory);
  
  for (const item of items) {
    const fullPath = path.join(directory, item);
    const stat = await fs.lstat(fullPath);
    
    if (stat.isDirectory()) {
      await scanAllPackages(fullPath, packageInfoMap, summary);
    } else if (item === 'package.json') {
      const packageDir = path.dirname(fullPath);
      const packageName = await getPackageNameFromJson(fullPath);
      const packageVersion = await getPackageVersionFromJson(fullPath);
      
      if (packageName && packageVersion) {
        summary.totalPackages++;
        
        // 检查文件完整性
        const contents = await fs.readdir(packageDir);
        const hasPackageJson = await fs.pathExists(fullPath);
        const tgzFiles = contents.filter(file => path.extname(file) === '.tgz');
        const hasTgzFile = tgzFiles.length > 0;
        
        // 避免重复添加同一个包
        if (!packageInfoMap.has(packageName)) {
          packageInfoMap.set(packageName, {
            currentVersion: packageVersion,
            packagePath: packageDir,
            hasPackageJson,
            hasTgzFile
          });
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
 * 优化的下载major版本函数
 */
async function downloadMajorVersionsOptimized(
  packageInfoMap: Map<string, { currentVersion: string, packagePath: string, hasPackageJson: boolean, hasTgzFile: boolean }>,
  summary: CheckSummary
): Promise<void> {
  const totalPackages = packageInfoMap.size;
  
  // 第一步：批量获取版本信息
  console.log(chalk.blue(`\n📡 正在获取 ${totalPackages} 个包的版本信息...`));
  
  const packageVersionsMap = new Map<string, { allVersions: string[], currentVersion: string, packagePath: string }>();
  let completedCount = 0;
  
  // 优化：尝试从本地批量读取，失败的再从网络获取
  const packageEntries = Array.from(packageInfoMap.entries());
  const localResults = new Map<string, string[]>();
  const needNetworkFetch: Array<[string, { currentVersion: string, packagePath: string }]> = [];
  
  // 批量从本地读取版本信息
  for (const [packageName, info] of packageEntries) {
    try {
      const localVersions = await getPackageAllVersionsFromLocal(packageName, './packages');
      if (localVersions && localVersions.length > 0) {
        localResults.set(packageName, localVersions);
        packageVersionsMap.set(packageName, { 
          allVersions: localVersions, 
          currentVersion: info.currentVersion, 
          packagePath: info.packagePath 
        });
        completedCount++;
      } else {
        needNetworkFetch.push([packageName, info]);
      }
    } catch (error) {
      needNetworkFetch.push([packageName, info]);
    }
    
    // 显示进度
    const percentage = ((completedCount / totalPackages) * 100).toFixed(1);
    process.stdout.write(`\r   进度: ${completedCount}/${totalPackages} (${percentage}%) - ${packageName}`);
  }
  
  // 对于需要网络获取的包，分批处理
  if (needNetworkFetch.length > 0) {
    const batchSize = 15; // 增加批次大小提高效率
    
    for (let i = 0; i < needNetworkFetch.length; i += batchSize) {
      const batch = needNetworkFetch.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async ([packageName, info]) => {
        try {
          const allVersions = await getPackageAllVersions(packageName);
          completedCount++;
          
          // 显示进度
          const percentage = ((completedCount / totalPackages) * 100).toFixed(1);
          process.stdout.write(`\r   进度: ${completedCount}/${totalPackages} (${percentage}%) - ${packageName}`);
          
          return {
            success: true,
            packageName,
            allVersions,
            currentVersion: info.currentVersion,
            packagePath: info.packagePath
          } as const;
        } catch (error) {
          completedCount++;
          const percentage = ((completedCount / totalPackages) * 100).toFixed(1);
          process.stdout.write(`\r   进度: ${completedCount}/${totalPackages} (${percentage}%) - ${packageName} (失败)`);
          
          return {
            success: false,
            packageName,
            error: error instanceof Error ? error.message : String(error)
          } as const;
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      // 处理批次结果
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { packageName, allVersions, currentVersion, packagePath } = result.value;
          packageVersionsMap.set(packageName, { allVersions, currentVersion, packagePath });
        } else if (result.status === 'fulfilled' && !result.value.success) {
          summary.errors.push(`获取${result.value.packageName}版本信息失败: ${result.value.error}`);
        }
      }
      
      // 批次间短暂延迟
      if (i + batchSize < needNetworkFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }
  
  // 清除进度显示并输出完成信息
  process.stdout.write('\r' + ' '.repeat(100) + '\r');
  console.log(`✅ 获取到 ${packageVersionsMap.size} 个包的版本信息`);
  
  if (packageVersionsMap.size === 0) {
    console.log(chalk.yellow('没有可处理的包'));
    return;
  }
  
  // 第二步：计算需要下载的版本
  
  const packagesToDownload: PackageItem[] = [];
  let processedCount = 0;
  const totalVersionPackages = packageVersionsMap.size;
  
  // 使用spinner显示分析进度
  let analysisSpinner = ora('正在分析需要下载的版本...').start();
  
  packageVersionsMap.forEach(({ allVersions, currentVersion, packagePath }, packageName) => {
    const latestVersionsPerMajor = getLatestVersionsPerMajor(allVersions, currentVersion);
    
    // 创建一个Set来避免重复版本
    const versionsToDownload = new Set<string>();
    
    // 1. 添加指定版本（当前版本）
    versionsToDownload.add(currentVersion);
    
    // 2. 添加每个major版本的最新版本
    latestVersionsPerMajor.forEach(version => {
      versionsToDownload.add(version);
    });
    
    const finalVersions = Array.from(versionsToDownload).sort((a, b) => semver.compare(a, b));
    
    finalVersions.forEach(version => {
      packagesToDownload.push({
        name: packageName,
        version: version,
        resolved: '', // 稍后获取
        path: path.relative(path.resolve('./packages'), packagePath)
      });
    });
    
    processedCount++;
    const percentage = ((processedCount / totalVersionPackages) * 100).toFixed(1);
    
    // 更新spinner文本
    analysisSpinner.text = `正在分析需要下载的版本: ${processedCount}/${totalVersionPackages} (${percentage}%) - @${packageName}`;
  });
  
  // 停止分析spinner并显示完成信息
  analysisSpinner.stop();
  console.log(chalk.green(`✅ 分析完成，共需要下载 ${packagesToDownload.length} 个版本`));
  
  if (packagesToDownload.length === 0) {
    console.log(chalk.yellow('没有需要下载的版本'));
    return;
  }
  
  // 第三步：批量获取下载链接并下载
  console.log(chalk.blue('📦 开始下载major版本依赖...'));
  
  const concurrency = 12; // 提高并发数
  const downloader = new PackageDownloader(concurrency);
  
  // 使用spinner显示下载进度
  let currentSpinner: any;
  const startTime = Date.now();
  
  downloader.setProgressCallback((progress) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const percentage = ((progress.completed + progress.failed) / progress.total * 100).toFixed(1);
    
    const message = [
      `下载进度: ${progress.completed + progress.failed}/${progress.total} (${percentage}%)`,
      `成功: ${progress.completed}`,
      `失败: ${progress.failed}`,
      `耗时: ${elapsed}s`,
      progress.current ? `当前: ${progress.current}` : ''
    ].filter(Boolean).join(' | ');

    if (currentSpinner) {
      currentSpinner.text = message;
    }
  });
  
  currentSpinner = ora('正在获取下载链接...').start();
  
  try {
    // 优化：并行获取下载链接，提高效率
    const urlPromises = packagesToDownload.map(async (pkg) => {
      try {
        const downloadUrl = await getPackageDownloadUrl(pkg.name, pkg.version);
        if (downloadUrl) {
          return { ...pkg, resolved: downloadUrl };
        } else {
          summary.errors.push(`${pkg.name}@${pkg.version}: 获取下载链接失败`);
          return null;
        }
      } catch (error) {
        summary.errors.push(`${pkg.name}@${pkg.version}: 获取下载链接失败`);
        return null;
      }
    });
    
    const results = await Promise.allSettled(urlPromises);
    const packagesWithUrls: PackageItem[] = [];
    
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        packagesWithUrls.push(result.value);
      }
    });
    
    if (packagesWithUrls.length === 0) {
      if (currentSpinner) {
        currentSpinner.stop();
      }
      console.log(chalk.yellow('没有可下载的包'));
      return;
    }
    
    // 更新spinner文本，开始下载
    if (currentSpinner) {
      currentSpinner.text = `获取到 ${packagesWithUrls.length} 个下载链接，开始下载...`;
    }
    
    const failedPackages = await downloader.downloadPackages(packagesWithUrls);
    
    // 停止spinner
    if (currentSpinner) {
      currentSpinner.stop();
    }
    
    const successCount = packagesWithUrls.length - failedPackages.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    summary.downloadedVersions = packagesWithUrls
      .filter(pkg => !failedPackages.some(failed => failed.name === pkg.name && failed.version === pkg.version))
      .map(pkg => `${pkg.name}@${pkg.version}`);
    
    console.log(chalk.green.bold(`✅ Major版本下载完成`));
    console.log(chalk.green(`   成功: ${successCount} 个版本`));
    console.log(chalk.green(`   耗时: ${elapsed}s`));
    
    if (failedPackages.length > 0) {
      console.log(chalk.yellow(`   失败: ${failedPackages.length} 个版本`));
      failedPackages.forEach(pkg => {
        summary.errors.push(`${pkg.name}@${pkg.version}: ${pkg.error || '下载失败'}`);
      });
    }
  } catch (error) {
    // 停止spinner
    if (currentSpinner) {
      currentSpinner.stop();
    }
    console.log(chalk.red.bold(`❌ 下载过程中发生错误`));
    summary.errors.push(`下载过程异常: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 从本地package.json获取包的所有版本
 */
async function getPackageAllVersionsFromLocal(packageName: string, packagesDir: string): Promise<string[] | null> {
  try {
    const packageJsonPath = path.join(packagesDir, packageName, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
      return null;
    }
    
    const packageContent = await fs.readJSON(packageJsonPath);
    const versions = Object.keys(packageContent.versions || {});
    
    // 使用semver进行排序
    return versions
      .filter(version => semver.valid(version))
      .sort((a, b) => semver.compare(a, b));
  } catch (error) {
    return null;
  }
}

/**
 * 获取包的所有版本信息并进行语义化版本排序（优先从本地读取，失败时从npm源获取）
 */
async function getPackageAllVersions(packageName: string, packagesDir?: string): Promise<string[]> {
  // 优先从本地读取
  if (packagesDir) {
    const localVersions = await getPackageAllVersionsFromLocal(packageName, packagesDir);
    if (localVersions && localVersions.length > 0) {
      return localVersions;
    }
  }
  
  // 本地读取失败时从npm源获取
  try {
    const registry = getNpmRegistry();
    const registryUrl = `${registry.replace(/\/$/, '')}/${packageName}`;
    // 根据网络环境调整超时时间
    const timeout = process.env.NODE_ENV === 'production' ? 30000 : 20000;
    const response = await axios.get(registryUrl, {
      timeout,
      headers: {
        'User-Agent': 'tgz-box'
      }
    });
    
    const versions = Object.keys(response.data.versions || {});
    
    // 使用semver进行排序
    return versions
      .filter(version => semver.valid(version))
      .sort((a, b) => semver.compare(a, b));
  } catch (error) {
    throw new Error(`获取 ${packageName} 版本信息失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 获取每个major版本的最新版本
 */
function getLatestVersionsPerMajor(versions: string[], currentVersion?: string): string[] {
  const majorGroups = new Map<number, string[]>();
  
  // 按major版本分组
  versions.forEach(version => {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (match) {
      const major = parseInt(match[1]);
      if (!majorGroups.has(major)) {
        majorGroups.set(major, []);
      }
      majorGroups.get(major)!.push(version);
    }
  });
  
  // 获取每个major版本的最新版本
  const latestVersions: string[] = [];
  majorGroups.forEach((versionList, major) => {
    // 使用semver进行正确的版本排序，获取最新的
    const sortedVersions = versionList
      .filter(version => semver.valid(version)) // 只保留有效的semver版本
      .sort((a, b) => semver.rcompare(a, b)); // 降序排序，最新版本在前
    
    const latestInMajor = sortedVersions[0];
    // 排除当前已指定的版本
    if (currentVersion !== latestInMajor) {
      latestVersions.push(latestInMajor);
    }
  });
  
  return latestVersions;
}

/**
 * 获取当前npm配置的registry地址
 */
function getNpmRegistry(): string {
  try {
    const { execSync } = require('child_process');
    const registry = execSync('npm config get registry', { encoding: 'utf8' }).trim();
    return registry || 'https://registry.npmjs.org/';
  } catch (error) {
    return 'https://registry.npmjs.org/';
  }
}

/**
 * 获取包的下载URL
 */
async function getPackageDownloadUrl(packageName: string, version: string): Promise<string | null> {
  try {
    const registry = getNpmRegistry();
    const registryUrl = `${registry.replace(/\/$/, '')}/${packageName}/${version}`;
    // 根据网络环境调整超时时间
    const timeout = process.env.NODE_ENV === 'production' ? 20000 : 15000;
    const response = await axios.get(registryUrl, {
      timeout,
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
 * 获取包的当前版本从package.json
 */
async function getPackageVersionFromJson(packageJsonPath: string): Promise<string | null> {
  try {
    const packageContent = await fs.readJSON(packageJsonPath);
    // 优先使用version字段，如果没有则使用dist-tags.latest
    return packageContent.version || packageContent['dist-tags']?.latest || null;
  } catch (error) {
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
  
  // 如果需要下载major版本
  if (downloadMissingVersion) {
    // 创建临时summary
    const summary: CheckSummary = {
      totalPackages: 1,
      incompletePackages: [],
      downloadedVersions: [],
      errors: []
    };
    
    // 扫描单个包的信息
    const packageInfoMap = new Map<string, { currentVersion: string, packagePath: string, hasPackageJson: boolean, hasTgzFile: boolean }>();
    await scanAllPackages(packagePath, packageInfoMap, summary);
    
    // 下载major版本
    await downloadMajorVersionsOptimized(packageInfoMap, summary);
    
    if (summary.downloadedVersions.length > 0) {
      return {
        code: 1,
        message: `已下载major版本: ${summary.downloadedVersions.join(', ')}`
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
  console.log(chalk.blue('\n📊 依赖检查摘要:'));
  console.log(chalk.white(`总包数: ${summary.totalPackages}`));
  console.log(chalk.white(`文件不完整: ${summary.incompletePackages.length}`));
  console.log(chalk.white(`已下载版本: ${summary.downloadedVersions.length}`));
  
  // 只显示非下载相关的错误
  const nonDownloadErrors = summary.errors.filter(error => 
    !error.includes('下载失败') && 
    !error.includes('获取下载链接失败')
  );
  
  if (nonDownloadErrors.length > 0) {
    console.log(chalk.red(`处理错误: ${nonDownloadErrors.length}`));
    console.log(chalk.red('\n错误详情:'));
    nonDownloadErrors.forEach((error, index) => {
      console.log(chalk.red(`${index + 1}. ${error}`));
    });
  } else {
    console.log(chalk.green(`处理错误: 0`));
  }
}