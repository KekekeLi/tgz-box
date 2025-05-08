import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import got from 'got';
import stream from 'stream';
import { promisify } from 'util';
import { getRegistry } from './registry.js';

export const pipeline = promisify(stream.pipeline);

export type ProgressCallback = (info: {
  current: number;
  total: number;
  pkgName: string;
  version: string;
  failed?: boolean;
  percent?: number;
}) => void;

// 下载带进度
export async function downloadWithProgress(
  url: string,
  destDir: string,
  fileName?: string,
  onProgress?: (percent: number) => void
) {
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

// 递归下载（package.json/单包场景）
export async function downloadPackageWithVersion(
  pkgName: string,
  version: string,
  downloaded: Set<string>,
  progress: ProgressCallback,
  counters: { finished: number; failed: number },
  registry?: string
) {
  const key = `${pkgName}@${version}`;
  if (downloaded.has(key)) return;
  downloaded.add(key);

  try {
    const url = getPackageMetaUrl(pkgName, version, registry);
    const res = await axiosGetWithRetry(url);
    const data = res.data;
    const tgzUrl = data.dist.tarball;
    const saveDir = path.join(process.cwd(), 'tgz', pkgName, version);

    let lastPercent = -1;
    await downloadWithProgress(
      tgzUrl,
      saveDir,
      undefined,
      percent => {
        if (percent !== 100 && percent !== lastPercent) {
          lastPercent = percent;
          progress({
            current: counters.finished + counters.failed + 1,
            total: undefined as any, // 由外部传入
            pkgName,
            version,
            percent
          });
        }
      }
    );
    fs.writeFileSync(path.join(saveDir, 'package.json'), JSON.stringify(data, null, 2));

    counters.finished++;
    progress({
      current: counters.finished + counters.failed,
      total: undefined as any, // 由外部传入
      pkgName,
      version,
      percent: 100
    });

    // 递归下载依赖
    const dependencies = data.dependencies || {};
    for (const dep in dependencies) {
      const depVersion = dependencies[dep];
      const depMetaUrl = getPackageMetaUrl(dep, undefined, registry);
      const depMetaRes = await axiosGetWithRetry(depMetaUrl);
      const depMetaData = depMetaRes.data;
      let matchedVersion = '';
      if (depMetaData.versions[depVersion]) {
        matchedVersion = depVersion;
      } else if (depMetaData['dist-tags'] && depMetaData['dist-tags'].latest) {
        matchedVersion = depMetaData['dist-tags'].latest;
      } else {
        matchedVersion = Object.keys(depMetaData.versions).pop() || depVersion;
      }
      await downloadPackageWithVersion(dep, matchedVersion, downloaded, progress, counters, registry);
    }
  } catch (err) {
    counters.failed++;
    progress({
      current: counters.finished + counters.failed,
      total: undefined as any,
      pkgName,
      version,
      failed: true
    });
    throw err;
  }
}

// 递归统计所有依赖（package.json/单包场景）
export async function countAllDepsFromPackage(
  pkgName: string,
  version: string,
  counted = new Set<string>(),
  registry?: string,
  onProgress?: (pkgName: string, version: string, count: number) => void
): Promise<void> {
  const key = `${pkgName}@${version}`;
  if (counted.has(key)) return;
  counted.add(key);

  if (onProgress) onProgress(pkgName, version, counted.size);

  const url = getPackageMetaUrl(pkgName, version, registry);
  const res = await axiosGetWithRetry(url);
  const data = res.data;
  const dependencies = data.dependencies || {};
  for (const dep in dependencies) {
    const depVersion = dependencies[dep];
    const depMetaUrl = getPackageMetaUrl(dep, undefined, registry);
    const depMetaRes = await axiosGetWithRetry(depMetaUrl);
    const depMetaData = depMetaRes.data;
    let matchedVersion = '';
    if (depMetaData.versions[depVersion]) {
      matchedVersion = depVersion;
    } else if (depMetaData['dist-tags'] && depMetaData['dist-tags'].latest) {
      matchedVersion = depMetaData['dist-tags'].latest;
    } else {
      matchedVersion = Object.keys(depMetaData.versions).pop() || depVersion;
    }
    await countAllDepsFromPackage(dep, matchedVersion, counted, registry, onProgress);
  }
}

// 递归统计所有依赖（package-lock.json场景）
export function countAllDepsFromLock(deps: any, counted = new Set<string>(), onProgress?: (name: string, version: string, count: number) => void) {
  for (const name in deps) {
    const dep = deps[name];
    // 添加版本范围处理逻辑
    const version = dep.version || (dep.dependencies ? '' : 'unknown');
    const key = `${name}@${version}`;
    
    if (counted.has(key)) continue;
    counted.add(key);
    
    // 添加进度回调
    if (onProgress) onProgress(name, version, counted.size);
    
    // 优化嵌套依赖处理
    if (dep.dependencies) {
      countAllDepsFromLock(dep.dependencies, counted, onProgress);
    }
    
    // 处理可选依赖
    if (dep.optional) {
      counted.delete(key);
    }
  }
}

// 递归下载（package-lock.json场景）
// 新增并发控制类
export class DownloadQueue {
  private queue: Promise<void>[] = [];
  private concurrency: number;

  constructor(concurrency = 5) {
    this.concurrency = concurrency;
  }

  async add(task: () => Promise<void>) {
    const promise = task().finally(() => {
      this.queue.splice(this.queue.indexOf(promise), 1);
    });
    this.queue.push(promise);
    if (this.queue.length >= this.concurrency) {
      await Promise.race(this.queue);
    }
  }

  async done() {
    await Promise.all(this.queue);
  }
}

// 修改下载函数
/**
 * 直接根据 parseLock 得到的 packages 数组批量下载
 * @param packages PackageItem[]
 * @param progress 进度回调
 * @param registry 源
 */
export async function downloadAllFromLockDeps(
  packages: { name: string; resolved: string; path: string; v: string }[],
  progress: ProgressCallback,
  registry?: string
) {
  const concurrency = 5;
  let active = 0;
  let index = 0;
  let finished = 0;
  let failed = 0;
  const total = packages.length;
  const failedList: { name: string; version: string }[] = [];
  const queue: Promise<void>[] = [];

  function downloadOne(pkg: { name: string; resolved: string; path: string; v: string }) {
    return new Promise<void>(async (resolve) => {
      try {
        // 下载 tgz 包
        const saveDir = path.join(process.cwd(), 'tgz', pkg.path);
        await downloadWithProgress(
          pkg.resolved,
          saveDir,
          undefined,
          (percent) => {
            progress({
              current: finished + failed + 1,
              total,
              pkgName: pkg.name,
              version: pkg.v,
              percent
            });
          }
        );
        // 获取 package.json 信息
        try {
          const metaUrl = pkg.resolved.split('/-/')[0];
          const res = await axios.get(metaUrl);
          fs.writeFileSync(path.join(saveDir, 'package.json'), JSON.stringify(res.data, null, 2));
        } catch (e) {
          // package.json 获取失败不影响主流程
        }
        finished++;
        progress({
          current: finished + failed,
          total,
          pkgName: pkg.name,
          version: pkg.v,
          percent: 100
        });
      } catch (err) {
        failed++;
        failedList.push({ name: pkg.name, version: pkg.v });
        progress({
          current: finished + failed,
          total,
          pkgName: pkg.name,
          version: pkg.v,
          failed: true
        });
      }
      resolve();
    });
  }

  return new Promise<{ name: string; version: string }[]>(resolve => {
    function next() {
      while (active < concurrency && index < total) {
        const pkg = packages[index++];
        active++;
        downloadOne(pkg).then(() => {
          active--;
          if (finished + failed < total) {
            next();
          } else if (active === 0) {
            resolve(failedList);
          }
        });
      }
    }
    next();
  });
}

export function getPackageMetaUrl(pkgName: string, version?: string, registry?: string) {
  const reg = getRegistry(registry);
  return version
    ? `${reg}/${pkgName.replace('/', '%2F')}/${version}`
    : `${reg}/${pkgName.replace('/', '%2F')}`;
}

export async function axiosGetWithRetry(url: string, retry = 3, delay = 1000): Promise<any> {
  let lastErr;
  for (let i = 0; i < retry; i++) {
    try {
      return await axios.get(url, { timeout: 10000 });
    } catch (err) {
      lastErr = err;
      if (i < retry - 1) {
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastErr;
}

export function prettyLogProgress(info: { current: number; total: number; pkgName: string; version: string; percent?: number; failed?: boolean }) {
  if (info.failed) {
    process.stdout.write(
      `\x1b[31m[失败]\x1b[0m ${info.pkgName}@${info.version} ✖\n`
    );
  } else if (info.percent !== undefined && info.percent !== 100) {
    process.stdout.write(
      `\r\x1b[36m[进度]\x1b[0m [${info.current}/${info.total}] 正在下载 ${info.pkgName}@${info.version}... ${info.percent}%   `
    );
  } else if (info.percent === 100) {
    process.stdout.write(
      `\r\x1b[32m[完成]\x1b[0m [${info.current}/${info.total}] ${info.pkgName}@${info.version} ✔           \n`
    );
  }
}

/**
 * 下载完成后输出总结信息
 */
export function printDownloadSummary(total: number, finished: number, failed: number, failedList: { name: string; version: string }[]) {
  process.stdout.write('\n');
  process.stdout.write(`\x1b[32m[完成]\x1b[0m 共需下载 ${total} 个依赖，成功：${finished}，失败：${failed}\n`);
  if (failed > 0 && failedList.length > 0) {
    process.stdout.write('\x1b[31m[失败依赖列表]\x1b[0m\n');
    failedList.forEach(item => {
      process.stdout.write(`  - ${item.name}@${item.version}\n`);
    });
  }
  process.stdout.write('\n');
}


export class ProgressTracker {
  private total: number;
  private finished = 0;
  private startTime = Date.now();

  constructor(total: number) {
    this.total = total;
  }

  increment() {
    this.finished++;
    this.updateProgress();
  }

  private updateProgress() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const remaining = this.total > 0 ? 
      (elapsed / this.finished) * (this.total - this.finished) : 0;
    
    process.stdout.write(
      `\r\x1b[36m[进度]\x1b[0m ${this.finished}/${this.total} ` +
      `已用: ${elapsed.toFixed(1)}s 剩余: ${remaining.toFixed(1)}s`
    );
  }
}

export function readLock (path: string): Promise<LockData> {
  return new Promise((resolve) => {
    try {
      const context = fs.readJSONSync(path)
      resolve(context)
    } catch {
      process.stdout.write(`\x1b[31m[错误]\x1b[0m  ${path} 读取失败\n`)
      process.exit(0)
    }
  })
}

export function parseLock(lockData: LockData): PackageItem[] {
  const packages: PackageItem[] = []

  if (lockData.packages) {
    for (const key in lockData.packages) {
      const path = key.split('node_modules/').pop() || '';
      if (path) {
        const item = lockData.packages[key]
        // 修复resolved字段处理逻辑
        const cleanResolved = item.resolved.replace(/`/g, '').trim() // 移除反引号和空格
        packages.push({
          name: path.split('/').pop() || path,
          resolved: cleanResolved,
          path: path,
          v: item.version
        })
      }
    }
  } else if (lockData.dependencies) {
    const loopDependencies = (dependenciesData: any) => {
      const dependencies = dependenciesData.dependencies || {};
      Object.keys(dependencies).forEach(function (key) {
        if (key) {
          packages.push({
            name: key,
            resolved: dependencies[key].resolved.replace(/`/g, '').trim(), // 修复此处
            path: key,
            v: dependencies[key].version
          })
          loopDependencies(dependencies[key])
        }
      })
    }
    loopDependencies(lockData)
  }
  return packages
}