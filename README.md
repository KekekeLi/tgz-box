# 📦 TGZ-BOX

一个强大的npm包离线下载和管理工具，专为企业内网环境设计。

## 🚀 核心特性

- **智能依赖解析** - 自动解析package.json和package-lock.json中的所有依赖
- **并发高速下载** - 支持多线程并发下载，显著提升下载效率
- **自动重试机制** - 下载失败的包会自动重试，最多重试3次，提高成功率
- **交互式重试** - 支持对下载失败的包进行交互式重试，可选择重试全部或特定包
- **智能版本管理** - 自动检查并下载每个major版本的最新版本
- **完整性检查** - 内置TGZ文件完整性检查，确保下载文件的可用性
- **优化进度显示** - 简洁的单行动态进度更新，实时显示下载进度、成功率和详细统计信息
- **智能缓存管理** - 根据registry配置智能决定是否清理npm缓存
- **多种下载模式** - 支持从package.json、package-lock.json或指定包名下载
- **自动化流程** - 一键完成清理、解析、下载、检查的完整流程
- **Major版本策略** - 同时下载指定版本和每个major版本的最新版本，确保版本覆盖完整性

## 📦 安装

### 全局安装
```bash
npm install tgz-box -g
```

### 本地安装
```bash
npm install tgz-box --save-dev
```

## 使用方法

### 环境变量配置

为了优化下载性能，可以设置以下环境变量：

```bash
# 网络环境配置
export FAST_NETWORK=true    # 快速网络环境，增加并发数到20
export SLOW_NETWORK=true    # 慢速网络环境，减少并发数到5

# 生产环境配置
export NODE_ENV=production  # 生产环境，增加超时时间
```

### 1. 下载依赖包 (install)

#### 基本用法
```bash
# 在项目根目录下载所有依赖 - 下载指定版本和每个major版本的最新版本
tgz-box install
# 或使用简写
tgz i
```

#### 指定包名下载
```bash
# 下载指定包及其依赖
tgz-box install vue@3.4.1
tgz-box install lodash
```

#### 命令选项
```bash
# 强制使用package.json（忽略package-lock.json）
tgz-box install -p
tgz-box install --package-json

# 下载前清理npm缓存
tgz-box install -c
tgz-box install --clear-cache

# 强制使用package.json模式
tgz-box install --force-package

# 组合使用
tgz-box install vue -p -c
```

### 2. 检查TGZ文件 (check)

#### 检查packages目录
```bash
# 检查当前目录下的所有包
tgz-box check
# 或使用简写
tgz c

# 检查指定目录
tgz-box check -d /path/to/packages
tgz-box check --directory /path/to/packages
```

#### 检查单个包
```bash
# 检查指定包
tgz-box check -p vue
tgz-box check --package vue
```

#### 自动修复版本不匹配
```bash
# 检查并自动修复
tgz-box check -f
tgz-box check --fix

# 修复指定包
tgz-box check -p vue -f
```

### 3. 清理缓存 (clear-cache)
```bash
# 清理npm缓存
tgz-box clear-cache
```

## 使用场景

### 场景1：内网开发环境部署
```bash
# 1. 在有网络的环境下载依赖的指定版本和每个major版本最新tgz文件
cd your-project
tgz-box install

# 2. 将下载的packages目录复制到内网环境
# 3. 在内网环境中使用本地registry安装
npm install --registry file://./packages
```

### 场景2：CI/CD流水线优化
```bash
# 在构建阶段预下载依赖的指定版本和多个major版本
tgz-box install
# 后续步骤可以使用本地文件，提高构建速度
```

### 场景3：packages目录维护
```bash
# 检查packages目录中的包完整性，包含指定版本和每个major版本的最新版本
tgz-box check -d /path/to/packages

# 自动修复版本不匹配的包，包含指定版本和每个major版本的最新版本，支持离线开发和版本兼容性测试
tgz-box check -d /path/to/packages --fix
```

## 输出结果

### 下载过程输出
```
TGZ-BOX 依赖下载工具
确保依赖树完整，版本正确

使用 package.json
依赖解析完成，共找到 301 个包（包含所有间接依赖）
正在获取包版本信息... ✓ 获取到 301 个包的版本信息

📦 lodash:
  当前版本: 4.17.21
  将下载每个major版本的最新版本: 3.10.1, 4.17.21

📦 react:
  当前版本: 18.2.0
  将下载每个major版本的最新版本: 16.14.0, 17.0.2, 18.2.0

🔄 准备下载 450 个版本...
正在获取下载链接... ✓ 获取到 450 个下载链接
开始下载major版本最新依赖...
下载进度: 200/450 (44.4%) | 成功: 200 | 失败: 0 | 耗时: 18.2s | 当前: esbuild-linux-s390x-0.15.18.tgz

下载完成！
总计: 450 个版本
成功: 450 个
失败: 0 个
总耗时: 42.3s
文件保存在: ./packages
```

### 检查结果输出
```
TGZ文件检查工具
用于检查packages目录中的npm包完整性

检查目录: /path/to/packages
所有包都完整且版本正确

检查结果摘要:
总依赖数: 150

⚠️ 版本不匹配的包 (3个)

✅ 已修复的依赖 (3个)
```

## 配置说明

### 目录结构
```
project/
├── package.json
├── package-lock.json
└── packages/              # 下载的tgz文件目录
    ├── vue/
    │   ├── package.json
    │   └── vue-3.4.1.tgz
    └── lodash/
        ├── package.json
        └── lodash-4.17.21.tgz
```

### 文件优先级
1. `package-lock.json` (最高优先级)
2. `package.json`
3. 用户输入的包名

## 故障排除

### 常见问题

#### 1. 下载失败
```bash
# 清理缓存后重试
tgz-box clear-cache
tgz-box install
```

#### 2. 网络超时
```bash
# 设置npm registry
npm config set registry https://registry.npmmirror.com/
tgz-box install
```

#### 3. 权限问题
```bash
# 使用sudo（仅限Linux/macOS）
sudo tgz-box install
```

#### 4. 版本不匹配
```bash
# 使用check命令检查并修复
tgz-box check --fix
```

### 调试模式
```bash
# 启用详细日志
DEBUG=tgz-box* tgz-box install
```

## 技术实现

- **语言**: TypeScript
- **依赖解析**: 支持npm v6和v7+格式的package-lock.json
- **下载引擎**: 基于axios的并发下载
- **进度显示**: 使用ora和chalk美化输出
- **文件操作**: 基于fs-extra的异步文件操作
- **命令行**: 使用commander.js构建CLI

```

## 更新日志

### v2.1.0
- ✨ **重大更新**: 下载策略调整为每个major版本的最新版本
- ✨ 新增major版本分析功能，自动识别并下载每个major版本的最新版本
- ✨ 新增版本覆盖完整性检查，确保major版本覆盖完整
- 🎨 优化下载进度显示，分步骤展示版本分析和下载过程
- 🎨 增强控制台输出，详细显示每个包的版本分析结果
- 📚 更新文档说明，反映新的下载策略

### v2.0.0
- ✨ 新增并发获取下载链接功能，显著提升下载效率
- ✨ 新增优雅退出处理，支持 Ctrl+C 取消操作并自动清理临时文件
- 🔧 版本号匹配策略调整: 由修改dist-tag.latest调整为下载最新版本的依赖
- 🔧 智能版本管理: 自动检查并下载缺失的版本
- 🔧 完整性检查: 验证已下载文件的完整性并自动修复
- 🔧 交互式确认: 下载前提供详细信息供用户确认
- 🔧 异常处理: 完善的错误处理和重试机制
- 🎨 进度显示优化: 更清晰的进度条和状态提示
- 🎨 控制台输出优化: 更友好的用户界面和信息展示
- 🐛 修复版本匹配检查逻辑
- 🐛 修复控制台输出残留问题
- 🐛 修复进度计数不准确问题
- 🐛 修复文件路径处理问题
- 📚 更新文档和使用说明
- 🔧 优化代码结构和性能
- 🔧 提升代码复用性和可维护性

## 许可证

MIT License