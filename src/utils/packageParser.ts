import { LockData, PackageItem } from '../types';
import ora from 'ora';

export function parseLockFile(lockData: LockData, showProgress = true): PackageItem[] {
  const packages: PackageItem[] = [];
  let spinner: any;
  
  if (showProgress) {
    spinner = ora('正在解析依赖...').start();
  }

  try {
    if (lockData.packages) {
      // npm v7+ format (包括v10.2.3)
      const entries = Object.entries(lockData.packages);
      const totalEntries = entries.length;
      
      for (let i = 0; i < entries.length; i++) {
        const [key, pkg] = entries[i];
        
        // 显示百分比进度，确保每10个包更新一次，避免频繁更新
        if (showProgress && spinner && totalEntries > 0 && i % 10 === 0) {
          const progress = Math.round((i / totalEntries) * 100);
          spinner.text = `解析依赖 (${progress}%)`;
        }
        
        if (key.startsWith('node_modules/') && pkg.resolved) {
          const packagePath = key.replace('node_modules/', '');
          packages.push({
            name: pkg.resolved.split('/').pop() || packagePath,
            resolved: pkg.resolved,
            path: packagePath,
            version: pkg.version
          });
        }
      }
    } else if (lockData.dependencies) {
      // npm v6 format
      let processedCount = 0;
      const totalDeps = countTotalDependencies(lockData.dependencies);
      
      const extractDependencies = (deps: any, basePath = '') => {
        for (const [name, info] of Object.entries(deps)) {
          processedCount++;
          
          // 显示百分比进度，确保每10个包更新一次
          if (showProgress && spinner && totalDeps > 0 && processedCount % 10 === 0) {
            const progress = Math.round((processedCount / totalDeps) * 100);
            spinner.text = `解析依赖 (${progress}%)`;
          }
          
          if (info && typeof info === 'object' && (info as any).resolved) {
            const pkg = info as any;
            packages.push({
              name: pkg.resolved.split('/').pop() || name,
              resolved: pkg.resolved,
              path: basePath ? `${basePath}/${name}` : name,
              version: pkg.version
            });
            
            if (pkg.dependencies) {
              extractDependencies(pkg.dependencies, basePath ? `${basePath}/${name}` : name);
            }
          }
        }
      };
      
      extractDependencies(lockData.dependencies);
    }
    
    if (showProgress && spinner) {
      spinner.succeed(`依赖解析完成，共找到 ${packages.length} 个包`);
    }
    
    return packages;
  } catch (error) {
    if (showProgress && spinner) {
      spinner.fail('依赖解析失败');
    }
    throw error;
  }
}

// 计算npm v6格式的总依赖数量
function countTotalDependencies(deps: any): number {
  let count = 0;
  
  const countRecursive = (dependencies: any) => {
    for (const [name, info] of Object.entries(dependencies)) {
      count++;
      if (info && typeof info === 'object' && (info as any).dependencies) {
        countRecursive((info as any).dependencies);
      }
    }
  };
  
  countRecursive(deps);
  return count;
}