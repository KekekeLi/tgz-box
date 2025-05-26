import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import ora from 'ora';

const execAsync = promisify(exec);

/**
 * 清理npm缓存
 */
export async function clearCache(): Promise<void> {
  const spinner = ora('正在清理npm缓存...');
  spinner.start();
  
  try {
    console.log(chalk.blue('🧹 开始清理npm缓存...'));
    
    // 执行npm cache clean --force命令
    await execAsync('npm cache clean --force');
    
    spinner.succeed(chalk.green('✅ npm缓存清理完成'));
  } catch (error) {
    spinner.fail(chalk.red('❌ npm缓存清理失败'));
    console.error(chalk.red('错误详情:'), error instanceof Error ? error.message : String(error));
    throw error;
  }
}