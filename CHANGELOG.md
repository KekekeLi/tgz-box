# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-05-28

- ✨ 新增并发获取下载链接功能，大幅提升版本检查速度
- 🐛 修复版本匹配检查的进度显示问题
- 🎨 优化控制台输出格式和提示信息
- 📝 更新文档，增加新功能说明

### 🚀 Added
- **版本号匹配策略调整**: 由修改dist-tag.latest调整为下载最新版本的依赖
- **并发链接获取**: 实现并发获取下载链接功能，大幅提升版本检查和下载准备速度
- **智能版本管理**: 当检测到版本不匹配时，自动下载最新版本同时保留当前版本
- **完整性检查**: 新增TGZ文件完整性检查，确保下载文件的可用性
- **自动修复功能**: check命令支持--fix参数，自动下载缺失版本
- **交互式确认**: 版本不匹配时提供用户选择是否下载最新版本
- **异常处理**: 监听未捕获异常和未处理的Promise拒绝

### 🎨 Improved
- **进度显示优化**: 更详细的进度信息，包含当前处理的包名和状态
- **控制台输出**: 优化提示信息格式
- **错误处理**: 更完善的错误捕获和用户友好的错误提示
- **性能优化**: 使用Promise.allSettled实现并发处理
- **代码复用**: 重构tgzChecker逻辑，提高代码复用性

### 🐛 Fixed
- **版本匹配检查**: 修复版本匹配检查的进度显示问题
- **控制台残留**: 解决spinner文本更新导致的控制台提示残留
- **进度计数**: 修复并发场景下的进度计数准确性
- **文件路径**: 统一使用绝对路径，避免相对路径问题

### 📝 Documentation
- **README更新**: 全面更新文档，增加新功能说明和使用示例
- **输出示例**: 更新控制台输出示例，展示新的进度显示格式
- **故障排除**: 新增临时文件清理等故障排除说明
- **技术实现**: 更新技术栈说明，包含并发优化和信号处理

### 🔧 Technical
- **TypeScript**: 新增CheckResult、PackageIntegrity、VersionMismatchInfo等接口
- **架构重构**: 重新设计tgzChecker模块，分离关注点
- **并发控制**: 实现可配置的并发数量控制
- **内存优化**: 优化大量包处理时的内存使用

## [1.0.0] - 2025-05-26

### 🚀 Added
- **初始版本发布**: TGZ-BOX依赖下载工具首次发布
- **智能依赖解析**: 支持package.json和package-lock.json解析
- **并发下载**: 多线程并发下载，支持重试机制
- **交互式重试**: 下载失败后支持交互式重试选择
- **美化进度显示**: 实时显示下载进度和统计信息
- **多种下载模式**: 支持全量下载、指定包下载等模式
- **缓存管理**: 智能npm缓存清理功能
- **命令行界面**: 基于commander.js的完整CLI

### 📦 Commands
- `tgz-box install` - 下载依赖包
- `tgz-box check` - 检查TGZ文件
- `tgz-box clear-cache` - 清理npm缓存

### 🎯 Features
- 支持package.json和package-lock.json
- 自动重试机制（最多3次）
- 实时进度显示
- 错误统计和报告
- 文件完整性验证

---

## 版本说明

- **Major版本**: 包含破坏性变更或重大功能更新
- **Minor版本**: 新增功能，向后兼容
- **Patch版本**: Bug修复和小幅改进

## 贡献指南

如果你发现了bug或有功能建议，请在GitHub上提交issue或pull request。