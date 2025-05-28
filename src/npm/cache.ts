import { exec } from 'child_process';
import { promisify } from 'util';
import ora from 'ora';
import chalk from 'chalk';

const execAsync = promisify(exec);

export async function clearCache(): Promise<void> {
  const spinner = ora('清理npm缓存中...').start();
  
  try {
    await execAsync('npm cache clean --force');
    spinner.succeed(chalk.green('npm缓存清理完成'));
  } catch (error) {
    spinner.fail('npm缓存清理失败');
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`清理缓存失败: ${errorMessage}`);
  }
}