# TGZ-BOX

一个专为内网开发环境设计的npm依赖下载工具，确保依赖树完整、版本正确。

## 功能特性

- **自动清理npm缓存** - 避免缓存导致的版本问题
- **智能文件优先级** - package-lock.json > package.json
- **多种下载模式** - 支持锁定文件、包文件、指定包名、交互式输入
- **完整依赖统计** - 下载前统计所有依赖数量（包含间接依赖）
- **美化进度显示** - 实时显示解析和下载进度、成功/失败数量、耗时等
- **并发下载** - 支持多线程并发下载，提高效率
- **自动化流程** - 解析完成后直接开始下载，无需手动确认
- **智能检查** - 自动检查packages目录中的包完整性
- **自动修复** - 自动修复package.json中的版本不匹配问题
- **失败重试** - 下载失败自动重试，最多3次
- **优化体验** - 确保进度提示可见，提升用户感知

## 安装

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