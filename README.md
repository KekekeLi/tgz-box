# 📦 TGZ-BOX

一个强大的npm包离线下载和管理工具，专为企业内网环境设计。

## 🚀 核心特性

- **智能依赖解析** - 自动解析package.json和package-lock.json中的所有依赖
- **并发高速下载** - 支持多线程并发下载，显著提升下载效率
- **自动重试机制** - 下载失败的包会自动重试，最多重试3次，提高成功率
- **交互式重试** - 支持对下载失败的包进行交互式重试，可选择重试全部或特定包
- **智能版本管理** - 当检测到版本不匹配时，自动下载最新版本同时保留当前版本
- **完整性检查** - 内置TGZ文件完整性检查，确保下载文件的可用性
- **美化进度显示** - 实时显示下载进度、成功率和详细统计信息
- **智能缓存管理** - 根据registry配置智能决定是否清理npm缓存
- **多种下载模式** - 支持从package.json、package-lock.json或指定包名下载
- **自动化流程** - 一键完成清理、解析、下载、检查的完整流程

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

### 1. 下载依赖包 (install)

#### 基本用法
```bash
# 在项目根目录下载所有依赖
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
# 1. 在有网络的环境下载依赖
cd your-project
tgz-box install

# 2. 将下载的packages目录复制到内网环境
# 3. 在内网环境中使用本地registry安装
npm install --registry file://./packages
```

### 场景2：CI/CD流水线优化
```bash
# 在构建阶段预下载依赖
tgz-box install
# 后续步骤可以使用本地文件，提高构建速度
```

### 场景3：packages目录维护
```bash
# 检查packages目录中的包完整性
tgz-box check -d /path/to/packages

# 自动修复版本不匹配的包
tgz-box check -d /path/to/packages --fix
```

## 输出结果

### 下载过程输出
```
TGZ-BOX 依赖下载工具
确保依赖树完整，版本正确

使用 package.json
依赖解析完成，共找到 301 个包（包含所有间接依赖）
开始下载 301 个依赖包...

下载进度: 132/301 (43.9%) | 成功: 132 | 失败: 0 | 耗时: 14.4s | 当前: esbuild-linux-s390x-0.15.18.tgz

下载完成！
总计: 301 个包
成功: 301 个
失败: 0 个
总耗时: 28.6s
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

## 许可证

MIT License