import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { checkTgzFiles, checkSinglePackage, printCheckSummary } from '../utils/tgzChecker';
import path from 'path';

interface CheckOptions {
  fix?: boolean;
  package?: string;
  directory?: string;
}

export async function check(options: CheckOptions = {}): Promise<void> {
  try {
    console.log(chalk.cyan('🔍 TGZ文件检查工具'));
    console.log(chalk.gray('用于检查packages目录中的npm包完整性\n'));
    
    let targetDirectory = options.directory || process.cwd();
    
    // 如果没有指定目录，询问用户
    if (!options.directory) {
      const { directory } = await inquirer.prompt([
        {
          type: 'input',
          name: 'directory',
          message: '请输入要检查的目录路径（packages目录）:',
          default: process.cwd(),
          validate: (input: string) => {
            if (!input.trim()) {
              return '目录路径不能为空';
            }
            return true;
          }
        }
      ]);
      targetDirectory = directory;
    }
    
    // 转换为绝对路径
    targetDirectory = path.resolve(targetDirectory);
    
    console.log(chalk.blue(`📂 检查目录: ${targetDirectory}`));
    
    if (options.package) {
      // 检查单个包
      console.log(chalk.blue(`📦 检查包: ${options.package}`));
      
      const result = await checkSinglePackage(options.package, targetDirectory, options.fix);
      
      if (result.message) {
        switch (result.code) {
          case -1:
            console.log(chalk.red(`❌ ${result.message}`));
            break;
          case 0:
            console.log(chalk.yellow(`⚠️  ${result.message}`));
            break;
          case 1:
            if (result.message.includes('Edit:')) {
              console.log(chalk.green(`✅ ${result.message}`));
            } else {
              console.log(chalk.green('✅ 包检查通过'));
            }
            break;
        }
      } else {
        console.log(chalk.green('✅ 包检查通过'));
      }
    } else {
      // 检查所有包
      const summary = await checkTgzFiles(targetDirectory, options.fix);
      printCheckSummary(summary);
      
      // 如果有问题且未启用自动修复，询问是否要修复
      if (!options.fix && summary.versionMismatchPackages.length > 0) {
        const { shouldFix } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'shouldFix',
            message: `发现 ${summary.versionMismatchPackages.length} 个版本不匹配的包，是否要自动修复？`,
            default: false
          }
        ]);
        
        if (shouldFix) {
          console.log(chalk.blue('\n🔧 开始修复版本不匹配的包...'));
          const fixSummary = await checkTgzFiles(targetDirectory, true);
          printCheckSummary(fixSummary);
        }
      }
    }
    
  } catch (error) {
    console.error(chalk.red('❌ 检查过程中发生错误:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

// 导出命令配置
export function setupCheckCommand(program: Command): void {
  program
    .command('check')
    .alias('c')
    .description('检查packages目录中的tgz文件完整性')
    .option('-f, --fix', '自动修复package.json中的版本号')
    .option('-p, --package <name>', '检查指定的包')
    .option('-d, --directory <path>', '指定要检查的目录路径')
    .action(check);
}