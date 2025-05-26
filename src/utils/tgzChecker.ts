import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';

interface CheckResult {
  code: number; // -1: error, 0: warning, 1: success
  message: string;
}

interface CheckSummary {
  totalPackages: number;
  missingTgzPackages: string[];
  versionMismatchPackages: string[];
  fixedPackages: string[];
  errors: string[];
}

/**
 * 检查指定目录中的npm包是否包含.tgz文件
 * @param directory 要检查的目录路径（通常是packages目录）
 * @param autoFix 是否自动修复package.json中的版本号
 * @returns 检查结果摘要
 */
export async function checkTgzFiles(directory: string, autoFix = false): Promise<CheckSummary> {
  const spinner = ora('正在检查tgz文件...');
  spinner.start();
  
  const summary: CheckSummary = {
    totalPackages: 0,
    missingTgzPackages: [],
    versionMismatchPackages: [],
    fixedPackages: [],
    errors: []
  };
  
  try {
    await checkDirectory(directory, summary, autoFix, spinner);
    
    if (summary.missingTgzPackages.length === 0 && summary.versionMismatchPackages.length === 0) {
      spinner.succeed('检查结果：所有包都完整且版本正确 \n ');
    } else {
      spinner.warn('检查结果：发现问题包 \n');
    }
    
    return summary;
  } catch (error) {
    spinner.fail('检查过程中发生错误');
    summary.errors.push(error instanceof Error ? error.message : String(error));
    return summary;
  }
}

/**
 * 检查单个包的tgz文件
 * @param packageName 包名
 * @param directory 包所在目录
 * @param autoFix 是否自动修复
 * @returns 检查结果
 */
export async function checkSinglePackage(packageName: string, directory: string, autoFix = false): Promise<CheckResult> {
  const packagePath = path.join(directory, packageName);
  
  if (!await fs.pathExists(packagePath)) {
    return {
      code: -1,
      message: `包目录不存在: ${packageName}`
    };
  }
  
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (!await fs.pathExists(packageJsonPath)) {
    return {
      code: -1,
      message: `package.json不存在: ${packageName}`
    };
  }
  
  return await editPackage(packageJsonPath, autoFix);
}

/**
 * 递归检查目录
 */
async function checkDirectory(directory: string, summary: CheckSummary, autoFix: boolean, spinner: any): Promise<void> {
  const items = await fs.readdir(directory);
  
  for (const item of items) {
    const fullPath = path.join(directory, item);
    const stat = await fs.lstat(fullPath);
    
    if (stat.isDirectory()) {
      await checkDirectory(fullPath, summary, autoFix, spinner);
    } else if (item === 'package.json') {
      summary.totalPackages++;
      spinner.text = `正在检查包 ${summary.totalPackages}...`;
      
      const result = await editPackage(fullPath, autoFix);
      
      if (result.message) {
        switch (result.code) {
          case -1:
            if (result.message.includes('No .tgz')) {
              const packageName = extractPackageName(result.message);
              summary.missingTgzPackages.push(packageName);
            } else {
              summary.errors.push(result.message);
            }
            break;
          case 0:
            if (result.message.includes('No newest')) {
              const packageName = extractPackageName(result.message);
              summary.versionMismatchPackages.push(packageName);
            }
            break;
          case 1:
            if (result.message.includes('Edit:')) {
              const packageName = extractPackageName(result.message);
              summary.fixedPackages.push(packageName);
            }
            break;
        }
      }
    }
  }
}

/**
 * 编辑包的package.json文件
 */
async function editPackage(fullPath: string, editPackageJSON: boolean): Promise<CheckResult> {
  try {
    const packageContent = await fs.readFile(fullPath, 'utf-8');
    let parsedContent: any;
    
    try {
      parsedContent = JSON.parse(packageContent);
    } catch (error) {
      return {
        code: -1,
        message: `Invalid JSON in ${fullPath}`
      };
    }
    
    const packageName = parsedContent.name;
    let newest: string;
    
    try {
      newest = parsedContent['dist-tags']['latest'];
    } catch (e) {
      return {
        code: 0,
        message: `No "dist-tags.latest" in ${packageName}`
      };
    }
    
    const targetDirectory = path.dirname(fullPath);
    const contents = await fs.readdir(targetDirectory);
    
    // 移除package.json，只保留.tgz文件
    const tgzFiles = contents.filter(file => 
      file !== 'package.json' && path.extname(file) === '.tgz'
    );
    
    if (tgzFiles.length === 0) {
      return {
        code: -1,
        message: `No .tgz in ${packageName}`
      };
    }
    
    const hasNewest = tgzFiles.some(file => file.includes(newest));
    
    if (!hasNewest) {
      if (editPackageJSON) {
        try {
          // 获取最新的tgz文件版本
          const newestTgzVersion = getVersionFromFileName(tgzFiles[tgzFiles.length - 1]);
          const message = `Edit: ${packageName} ${newest} -> ${newestTgzVersion}`;
          
          parsedContent['dist-tags']['latest'] = newestTgzVersion;
          await fs.writeFile(path.join(targetDirectory, 'package.json'), JSON.stringify(parsedContent, null, 2));
          
          return {
            code: 1,
            message
          };
        } catch (e) {
          return {
            code: -1,
            message: e instanceof Error ? e.message : String(e)
          };
        }
      } else {
        return {
          code: 0,
          message: `No newest(${newest}) .tgz in ${packageName}`
        };
      }
    }
    
    return {
      code: 1,
      message: ''
    };
  } catch (error) {
    return {
      code: -1,
      message: `Error processing ${fullPath}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * 从文件名中提取版本号
 */
function getVersionFromFileName(fileName: string): string {
  // 假设文件名格式为: package-name-version.tgz
  const match = fileName.match(/-([\d\.]+.*?)\.tgz$/);
  if (match) {
    return match[1];
  }
  throw new Error(`Cannot extract version from filename: ${fileName}`);
}

/**
 * 从错误消息中提取包名
 */
function extractPackageName(message: string): string {
  const patterns = [
    /No \.tgz in (.+)$/,
    /No newest\(.+\) \.tgz in (.+)$/,
    /Edit: (.+?) /,
    /No "dist-tags\.latest" in (.+)$/
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return 'unknown';
}

/**
 * 打印检查结果摘要
 */
export function printCheckSummary(summary: CheckSummary): void {
  console.log(chalk.bold('检查结果摘要:'));
  console.log(chalk.blue(`总包数: ${summary.totalPackages}`));
  
  if (summary.missingTgzPackages.length > 0) {
    console.log(chalk.red(`缺少tgz文件的包: ${summary.missingTgzPackages.length}个`));
  }
  
  if (summary.versionMismatchPackages.length > 0) {
    console.log(chalk.yellow(`版本不匹配的包: ${summary.versionMismatchPackages.length}个`));
  }
  
  if (summary.fixedPackages.length > 0) {
    console.log(chalk.green(`已修复的包: ${summary.fixedPackages.length}个`));
  }
  
  if (summary.errors.length > 0) {
    console.log(chalk.red(`错误: ${summary.errors.length}个`));
  }
}