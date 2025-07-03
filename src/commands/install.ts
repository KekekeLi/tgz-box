import ora from 'ora';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { InstallOptions, PackageItem } from '../types';
import { checkFilesExistence, readLockFile, cleanupTempDirectory } from '../utils/fileUtils';
import { parseLockFile } from '../utils/packageParser';
import { PackageDownloader } from '../utils/downloader';
import { clearCache } from '../npm/cache';
import { generateLockFileFromPackage, generateLockFileFromPackageName } from '../npm/npmUtils';
import { checkTgzFiles } from '../utils/tgzChecker';
import { failedPackageManager } from '../utils/failedPackageManager';
import path from 'path';
import {
  PACKAGE_JSON_PATH,
  PACKAGE_LOCK_PATH,
  TEMP_DIR
} from '../utils/constants';

export async function install(packageName?: string, options: InstallOptions = {}) {

  try {
    // 1. 清理缓存（如果需要）
    if (options.clearCache) {
      await clearCache();
    }

    // 2. 确定下载模式并解析依赖
    const lockFilePath = await determineLockFile(options, packageName);
    const lockData = await readLockFile(lockFilePath);
    
    // 3. 解析依赖（启用进度提示）
    const packages = parseLockFile(lockData, true);
    const totalCount = packages.length;

    if (totalCount === 0) {
      console.log(chalk.yellow('没有找到需要下载的依赖包'));
      return;
    }

    // 4. 开始智能下载（跳过失败包，最后重试）
    console.log('\n' + chalk.blue(`开始下载 ${totalCount} 个依赖包...`));
    await downloadPackagesWithRetry(packages);

    // 5. 自动检查
    console.log('\n' + chalk.blue('开始检查依赖完整性和版本匹配...'));
    await performAutoCheck();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red('操作失败:'), errorMessage);
    process.exit(1);
  } finally {
    // 清理临时目录和失败包缓存
    cleanupTempDirectory(TEMP_DIR);
    await failedPackageManager.cleanup();
  }
}

async function determineLockFile(options: InstallOptions, packageName?: string): Promise<string> {
  // 如果指定了包名，生成临时lock文件
  if (packageName) {
    console.log(chalk.blue(`准备下载指定包: ${packageName}`));
    return await generateLockFileFromPackageName(packageName);
  }

  const { hasPackageJson, hasPackageLock } = checkFilesExistence();

  // 如果两个文件都不存在，提示用户输入
  if (!hasPackageJson && !hasPackageLock) {
    const { inputPackageName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputPackageName',
        message: '未找到package.json或package-lock.json，请输入要下载的包名:',
        validate: (input: string) => input.trim() !== '' || '包名不能为空'
      }
    ]);
    
    return await generateLockFileFromPackageName(inputPackageName.trim());
  }

  // 优先级处理
  if (hasPackageLock && !options.forcePackage) {
    console.log(chalk.blue('正在解析 package-lock.json...'));
    return PACKAGE_LOCK_PATH;
  }
  
  if (hasPackageJson && (options.package || options.forcePackage || !hasPackageLock)) {
    console.log(chalk.blue('正在解析 package.json...'));
    return await generateLockFileFromPackage(PACKAGE_JSON_PATH);
  }

  throw new Error('无法确定要使用的配置文件');
}

async function downloadPackagesWithRetry(packages: PackageItem[]) {
  const downloader = new PackageDownloader(30); // 提高并发数，因为会跳过失败包
  const totalStartTime = Date.now();
  
  // 清理之前的失败包缓存（开始新的下载会话）
  failedPackageManager.clearFailedPackages();
  failedPackageManager.resetRetryCount();
  
  console.log(chalk.blue('📦 采用智能下载策略：先下载稳定包，失败包将在最后重试'));
  
  // 第一轮：正常下载（跳过失败包）
  await performDownloadRound(downloader, packages, '主要下载', true);
  
  // 重试失败的包，最多2次
  while (failedPackageManager.canRetry() && failedPackageManager.getFailedPackages().length > 0) {
    failedPackageManager.incrementRetryCount();
    const retryRound = failedPackageManager.getCurrentRetryCount();
    const failedPackages = failedPackageManager.getFailedPackages();
    
    console.log(chalk.yellow(`\n🔄 第 ${retryRound} 次重试，尝试下载 ${failedPackages.length} 个失败的包...`));
    
    // 重试时使用更保守的并发数
    const retryDownloader = new PackageDownloader(10);
    await performDownloadRound(retryDownloader, failedPackages, `重试 ${retryRound}`, false);
  }
  
  // 最终结果统计
  const finalStats = failedPackageManager.getStatistics();
  const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(1);
  
  console.log('\n' + '='.repeat(60));
  console.log(chalk.blue.bold('📊 下载完成统计'));
  console.log('='.repeat(60));
  
  const successCount = packages.length - finalStats.totalFailed;
  console.log(chalk.green(`✅ 成功下载: ${successCount}/${packages.length} 个包`));
  
  if (finalStats.totalFailed > 0) {
    console.log(chalk.red(`❌ 最终失败: ${finalStats.totalFailed} 个包 (已重试 ${finalStats.retryCount} 次)`));
    
    // 显示失败的包
    const failedPackages = failedPackageManager.getFailedPackages();
    console.log(chalk.red('\n失败的包列表:'));
    failedPackages.forEach((pkg, index) => {
      console.log(chalk.red(`  ${index + 1}. ${pkg.name}@${pkg.version}`));
      if (pkg.error) {
        console.log(chalk.gray(`     错误: ${pkg.error}`));
      }
    });
    
    // 生成失败包的package.json
    await failedPackageManager.generateFailedPackageJson('./failed-packages.json');
    console.log(chalk.yellow('\n💡 提示: 可以稍后使用生成的 failed-packages.json 重新尝试下载这些包'));
  } else {
    console.log(chalk.green.bold('🎉 所有包下载成功！'));
  }
  
  console.log(chalk.blue(`⏱️  总耗时: ${totalElapsed}s`));
  console.log(chalk.blue(`📁 文件保存位置: ./packages/`));
  console.log('='.repeat(60));
}

// 执行单轮下载的辅助函数
async function performDownloadRound(
  downloader: PackageDownloader, 
  packages: PackageItem[], 
  roundName: string, 
  skipFailed: boolean
): Promise<void> {
  const startTime = Date.now();
  let currentSpinner: any;

  // 设置进度回调
  downloader.setProgressCallback((progress) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const percentage = progress.total > 0 ? ((progress.completed + progress.failed) / progress.total * 100).toFixed(1) : '0.0';
    
    const message = [
      `${roundName}: ${progress.completed + progress.failed}/${progress.total} (${percentage}%)`,
      `成功: ${progress.completed}`,
      `失败: ${progress.failed}`,
      `耗时: ${elapsed}s`,
      progress.current ? `当前: ${progress.current}` : ''
    ].filter(Boolean).join(' | ');

    if (currentSpinner) {
      currentSpinner.text = message;
    }
  });

  currentSpinner = ora(`开始${roundName}...`).start();
  
  try {
    await downloader.downloadPackages(packages, skipFailed);
    currentSpinner.stop();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.green(`${roundName}完成，耗时: ${elapsed}s`));
    
  } catch (error) {
    currentSpinner.fail(`${roundName}过程中发生错误`);
    throw error;
  }
}



// 修改performAutoCheck函数
async function performAutoCheck(directory?: string) {
  try {
    const packagesDir = directory || path.resolve('./packages');
    
    // 进行完整性和版本检查，自动下载缺失版本
    const summary = await checkTgzFiles(packagesDir, true);
    
    // 优化提示信息格式
    console.log('\n' + '='.repeat(50));
    console.log(chalk.blue('📋 安装结果摘要'));
    console.log('='.repeat(50));
    
    if (summary.incompletePackages.length > 0) {
      console.log(chalk.yellow(`⚠️  发现 ${summary.incompletePackages.length} 个不完整的包`));
      console.log(chalk.gray('   已生成详细信息文件供查看'));
    }
    
    if (summary.downloadedVersions.length > 0) {
      console.log(chalk.green(`✅ 已下载 ${summary.downloadedVersions.length} 个major版本依赖`));
    }
    
    if (summary.errors.length > 0) {
      console.log(chalk.red(`❌ 检查过程中发现 ${summary.errors.length} 个错误`));
      console.log(chalk.gray('   错误详情:'));
      summary.errors.forEach(error => console.log(chalk.red(`     - ${error}`)));
    }
    
    if (summary.incompletePackages.length === 0 && 
        summary.errors.length === 0) {
      console.log(chalk.green('✅ 所有依赖都完整'));
    }
    
    console.log('='.repeat(50) + '\n');
    
    return summary;
    
  } catch (error) {
    console.log(chalk.yellow('自动检查失败，可以手动运行 `tgz-box check` 进行检查'));
    return { incompletePackages: [], downloadedVersions: [], errors: [] };
  }
}