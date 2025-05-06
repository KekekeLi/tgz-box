#!/usr/bin/env node
import { program } from 'commander';
import { cleanNpmCache } from './utils/cleanNpmCache.js';
import { downloadAllFromLock } from './core/downloader-lock.js';
import { downloadAllFromPackage } from './core/downloader-package.js';
import { downloadSinglePackage } from './core/downloader-single.js';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import axios from 'axios';
import got from 'got';
import stream from 'stream';
import { promisify } from 'util';

const pipeline = promisify(stream.pipeline);

type ProgressCallback = (info: {
  current: number;
  total: number;
  pkgName: string;
  version: string;
  percent?: number;
}) => void;

async function downloadWithProgress(url: string, destDir: string, fileName?: string, onProgress?: (percent: number) => void) {
  fs.mkdirSync(destDir, { recursive: true });
  const filePath = path.join(destDir, fileName || path.basename(url.split('?')[0]));
  let lastPercent = 0;
  await pipeline(
    got.stream(url)
      .on('downloadProgress', progress => {
        const percent = Math.floor((progress.percent || 0) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress && onProgress(percent);
        }
      }),
    fs.createWriteStream(filePath)
  );
  return filePath;
}

async function countAllDepsFromSingle(pkgName: string, version: string, counted = new Set<string>()): Promise<number> {
  const key = `${pkgName}@${version}`;
  if (counted.has(key)) return 0;
  counted.add(key);

  const url = `https://registry.npmjs.org/${pkgName}/${version}`;
  const res = await axios.get(url);
  const data = res.data;
  let count = 1;
  const dependencies = data.dependencies || {};
  for (const dep in dependencies) {
    const depVersion = dependencies[dep];
    // 获取实际版本号
    const depMetaUrl = `https://registry.npmjs.org/${dep}`;
    const depMetaRes = await axios.get(depMetaUrl);
    const depMetaData = depMetaRes.data;
    let matchedVersion = '';
    if (depMetaData.versions[depVersion]) {
      matchedVersion = depVersion;
    } else if (depMetaData['dist-tags'] && depMetaData['dist-tags'].latest) {
      matchedVersion = depMetaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(depMetaData.versions).pop() || depVersion;
    }
    count += await countAllDepsFromSingle(dep, matchedVersion, counted);
  }
  return count;
}

program
  .command('install')
  .alias('i')
  .option('-p, --package', '使用 package.json 下载')
  .argument('[name]', '依赖包名（如 vue 或 vue@3.4.1）')
  .action(async (name, options, cmd) => {
    cleanNpmCache();

    // 判断文件存在性
    const hasLock = fs.existsSync(path.join(process.cwd(), 'package-lock.json'));
    const hasPkg = fs.existsSync(path.join(process.cwd(), 'package.json'));

    if (name) {
      await downloadSinglePackage(name);
    } else if (options.package) {
      if (hasPkg) {
        await downloadAllFromPackage();
      } else {
        console.log('未找到 package.json');
      }
    } else if (hasLock) {
      await downloadAllFromLock();
    } else if (hasPkg) {
      await downloadAllFromPackage();
    } else {
      // 都不存在，提示用户输入
      const answer = await inquirer.prompt([
        {
          type: 'input',
          name: 'pkg',
          message: '未检测到 package.json 或 package-lock.json，请输入要下载的依赖包名（如 vue 或 vue@3.4.1）：'
        }
      ]);
      if (answer.pkg) {
        await downloadSinglePackage(answer.pkg);
      } else {
        console.log('未输入依赖包名，已退出。');
      }
    }
  });

program.parse(process.argv);