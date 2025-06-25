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

    // 4. 开始下载
    console.log('\n' + chalk.blue(`开始下载 ${totalCount} 个依赖包...`));
    await downloadPackages(packages);

    // 5. 自动检查
    console.log('\n' + chalk.blue('开始检查依赖完整性和版本匹配...'));
    await performAutoCheck();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red('操作失败:'), errorMessage);
    process.exit(1);
  } finally {
    cleanupTempDirectory(TEMP_DIR);
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

async function downloadPackages(packages: PackageItem[]) {
  const downloader = new PackageDownloader(10);
  const startTime = Date.now();
  let currentSpinner: any;

  // 设置进度回调
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

  currentSpinner = ora('开始下载...').start();
  
  try {
    const failedPackages = await downloader.downloadPackages(packages);
    
    currentSpinner.stop();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (failedPackages.length === 0) {
      console.log(chalk.green.bold(`所有依赖下载完成！`));
      console.log(chalk.green(`总计: ${packages.length} 个包`));
      console.log(chalk.green(`耗时: ${elapsed}s`));
    } else {
      console.log(chalk.yellow.bold(`下载完成，但有 ${failedPackages.length} 个包失败`));
      console.log(chalk.green(`成功: ${packages.length - failedPackages.length} 个包`));
      console.log(chalk.red(`失败: ${failedPackages.length} 个包`));
      console.log(chalk.blue(`耗时: ${elapsed}s`));
      
      console.log(chalk.red('失败的包:'));
      failedPackages.forEach(pkg => {
        console.log(chalk.red(`  - ${pkg.path}@${pkg.version}${pkg.error ? ` (${pkg.error})` : ''}`));
      });
      
      // 询问用户是否重试失败的包
      await handleFailedPackagesRetry(failedPackages);
    }
    
    console.log(chalk.blue(`文件保存位置: ./packages/`));
    
  } catch (error) {
    currentSpinner.fail('下载过程中发生错误');
    throw error;
  }
}

// 处理失败包的重试逻辑
async function handleFailedPackagesRetry(failedPackages: PackageItem[]) {
  const { shouldRetry } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'shouldRetry',
      message: `是否重新下载失败的 ${failedPackages.length} 个包？`,
      default: true
    }
  ]);

  if (!shouldRetry) {
    console.log(chalk.yellow('跳过重试，可以稍后使用相同命令重新下载'));
    return;
  }

  // 提供重试选项
  const { retryOption } = await inquirer.prompt([
    {
      type: 'list',
      name: 'retryOption',
      message: '选择重试方式:',
      choices: [
        { name: '重试所有失败的包', value: 'all' },
        { name: '选择特定的包进行重试', value: 'select' },
        { name: '取消重试', value: 'cancel' }
      ]
    }
  ]);

  if (retryOption === 'cancel') {
    return;
  }

  let packagesToRetry = failedPackages;

  if (retryOption === 'select') {
    const { selectedPackages } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedPackages',
        message: '选择要重试的包:',
        choices: failedPackages.map(pkg => ({
          name: `${pkg.path}@${pkg.version}`,
          value: pkg,
          checked: true
        }))
      }
    ]);
    packagesToRetry = selectedPackages;
  }

  if (packagesToRetry.length === 0) {
    console.log(chalk.yellow('没有选择要重试的包'));
    return;
  }

  console.log(chalk.blue(`\n开始重试下载 ${packagesToRetry.length} 个包...`));
  
  // 清除错误信息，重新下载
  const cleanPackages = packagesToRetry.map(pkg => {
    const { error, ...cleanPkg } = pkg;
    return cleanPkg;
  });
  
  await downloadPackages(cleanPackages);
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