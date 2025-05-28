#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { install } from './commands/install';
import { clearCache } from './npm/cache';
import { setupCheckCommand } from './commands/check';
import { setupSignalHandlers } from './npm/npmUtils';

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));


// 设置信号处理
setupSignalHandlers();

const program = new Command();

program
  .name('tgz-box')
  .description('📦 TGZ-BOX 依赖下载工具')
  .version(packageJson.version);

program
  .command('install')
  .alias('i')
  .description('下载npm依赖的tgz文件')
  .argument('[packageName]', '要安装的包名（可选）')
  .option('-p, --package-json', '强制使用package.json（忽略package-lock.json）')
  .option('-c, --clear-cache', '下载前清理npm缓存')
  .option('--force-package', '强制使用package.json模式')
  .action(install);

program
  .command('clear-cache')
  .description('清理npm缓存')
  .action(clearCache);

// 添加检查命令
setupCheckCommand(program);

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}