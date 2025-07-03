# 智能失败包管理策略

## 概述

为了解决网络不稳定导致的下载失败问题，我们实现了一套智能的失败包管理策略。这个策略通过**效率优先、失败隔离、智能重试**的方式，大幅提升了下载成功率和用户体验。

## 核心思想

传统的下载策略是"一刀切"的方式：所有包一起下载，失败了就全部重试。这种方式的问题是：
- 个别包的网络问题会影响整体下载效率
- 用户需要等待所有包（包括失败的）完成才能看到结果
- 重试时会重复下载已经成功的包

**新策略的核心思想**：
> 将下载失败的包与正常下载流程隔离，优先保证大部分包的快速下载，然后集中处理失败的包。

## 策略流程

### 1. 主要下载阶段
```
📦 开始下载 100 个包
├── 跳过 0 个之前失败的包
├── 并发下载 100 个包（高并发：30）
├── 成功：95 个包
└── 失败：5 个包 → 加入失败缓存
```

### 2. 智能重试阶段
```
🔄 第 1 次重试
├── 重试 5 个失败的包（低并发：10）
├── 成功：3 个包 → 从失败缓存移除
└── 失败：2 个包 → 保留在失败缓存

🔄 第 2 次重试
├── 重试 2 个失败的包（低并发：10）
├── 成功：1 个包 → 从失败缓存移除
└── 失败：1 个包 → 最终失败
```

### 3. 结果处理阶段
```
📊 下载完成统计
├── ✅ 成功下载：99/100 个包
├── ❌ 最终失败：1 个包
├── 📄 生成 failed-packages.json
└── 💡 提供后续处理建议
```

## 技术实现

### 失败包管理器 (FailedPackageManager)

```typescript
class FailedPackageManager {
  // 核心功能
  addFailedPackage(pkg, error)     // 添加失败包
  isPackageFailed(pkg)             // 检查包是否失败
  removeSuccessfulPackage(pkg)     // 移除成功包
  
  // 重试控制
  canRetry()                       // 是否可以重试
  incrementRetryCount()            // 增加重试次数
  
  // 结果处理
  generateFailedPackageJson()      // 生成失败包文件
  getStatistics()                  // 获取统计信息
}
```

### 下载器优化 (PackageDownloader)

```typescript
// 支持跳过失败包的下载
async downloadPackages(packages, skipFailed = true) {
  // 过滤出需要下载的包
  const packagesToDownload = skipFailed 
    ? packages.filter(pkg => !failedPackageManager.isPackageFailed(pkg))
    : packages;
    
  // 执行下载...
}
```

### 智能下载流程 (downloadPackagesWithRetry)

```typescript
async function downloadPackagesWithRetry(packages) {
  // 1. 清理缓存，开始新会话
  failedPackageManager.clearFailedPackages();
  
  // 2. 主要下载（高并发，跳过失败包）
  await performDownloadRound(downloader, packages, '主要下载', true);
  
  // 3. 重试失败包（最多2次，低并发）
  while (failedPackageManager.canRetry() && hasFailedPackages()) {
    await performDownloadRound(retryDownloader, failedPackages, '重试', false);
  }
  
  // 4. 生成最终报告
  await generateFinalReport();
}
```

## 策略优势

### 1. 🚀 提升下载效率
- **并发优化**：主下载使用高并发（30），重试使用低并发（10）
- **时间节省**：不等待失败包，优先完成可下载的包
- **资源利用**：避免重复下载已成功的包

### 2. 🛡️ 增强稳定性
- **故障隔离**：失败包不影响其他包的下载
- **智能重试**：针对失败包使用更保守的策略
- **断路器**：配合网络优化器的断路器模式

### 3. 📊 更好的用户体验
- **实时反馈**：用户可以立即看到大部分包的下载进度
- **清晰报告**：详细的成功/失败统计和错误信息
- **后续处理**：自动生成失败包文件供后续处理

### 4. 🔧 灵活的错误处理
- **自动重试**：最多2次自动重试，无需用户干预
- **错误分类**：区分网络错误、超时错误等不同类型
- **恢复机制**：成功下载的包会自动从失败缓存中移除

## 配置参数

| 参数 | 主下载 | 重试下载 | 说明 |
|------|--------|----------|------|
| 并发数 | 30 | 10 | 重试时使用更保守的并发数 |
| 超时时间 | 30s | 30s | 统一的超时时间 |
| 最大重试 | - | 2次 | 最多重试2次 |
| 重试延迟 | - | 指数退避 | 避免网络拥塞 |

## 使用示例

### 基本使用
```bash
# 使用新策略下载
npm run build
node dist/index.js install

# 下载过程中会看到：
# 📦 采用智能下载策略：先下载稳定包，失败包将在最后重试
# 主要下载: 95/100 (95.0%) | 成功: 95 | 失败: 0 | 耗时: 45.2s
# 🔄 第 1 次重试，尝试下载 5 个失败的包...
# 重试 1: 3/5 (60.0%) | 成功: 3 | 失败: 2 | 耗时: 12.1s
```

### 失败包处理
如果有包最终下载失败，会生成 `failed-packages.json`：

```json
{
  "name": "failed-packages",
  "version": "1.0.0",
  "description": "Failed packages that could not be downloaded after retries",
  "dependencies": {
    "some-package": "1.0.0"
  },
  "failedPackages": [
    {
      "name": "some-package",
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/some-package/-/some-package-1.0.0.tgz",
      "error": "timeout of 30000ms exceeded",
      "retryCount": 2
    }
  ]
}
```

### 后续处理
```bash
# 可以稍后重新尝试下载失败的包
node dist/index.js install --package failed-packages.json
```

## 与网络优化器的协同

新的失败包管理策略与现有的网络优化器完美配合：

- **断路器模式**：当网络状况很差时，自动降低并发数
- **自适应重试**：根据网络状况调整重试策略
- **智能降级**：在重试阶段使用更保守的网络配置

## 总结

这套智能失败包管理策略通过**分离关注点**的设计思想，将下载效率和错误处理分开优化：

1. **效率优先**：主下载阶段专注于快速下载大部分包
2. **精准重试**：重试阶段专注于解决特定的失败包
3. **用户友好**：提供清晰的进度反馈和后续处理方案

这种策略在保持高下载效率的同时，显著提升了整体的成功率和用户体验。