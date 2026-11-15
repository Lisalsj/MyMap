# 构建与发布

## 本机验收

需要 Windows x64、Node.js 24、npm 和 Git。先安装依赖，再执行完整验收：

```powershell
npm ci
npm run verify:local
```

命令依次检查格式和单元测试、独立安装版 A→B 更新、正式打包、打包程序界面、免安装版保存重启与离线隔离、更新清单和发行包内容。任何阶段失败都会停止，不推送源码或发布。测试仅使用独立资料库。

`release/` 输出安装版、免安装版、`latest.yml` 和 `SHA256SUMS.txt`。验收记录位于忽略提交的 `test-results/reports/local-release.json`，包含提交、各阶段结果及当前四个附件的大小和哈希。安装包与更新清单必须来自同一批构建，包内不能包含个人资料库、照片、备份或凭据。

本机若已配置 `ELECTRON_BUILDER_NSIS_DIR`，优先使用该工具目录；否则检测项目中已有的 `test-results/build-tools/nsis`，没有时使用 electron-builder 的默认工具缓存。不在项目中固定个人工具路径。

## 发布新软件版本

先在包清单与锁文件中同步增加版本，准备简短中文更新说明，并在本地提交所有源码改动。发布要求 main 分支、干净工作区及与项目配置一致的 origin：

```powershell
npm run release:local -- --notes test-results/release-notes.md
```

命令重新执行完整验收，然后一次性推送 main 和版本标签；再创建草稿 Release，上传当前版本的安装版、免安装版、更新清单和校验文件。四个附件的大小及远端 SHA-256、安装包与清单的 SHA-512 全部一致后才公开，并检查公开下载。不会自动修改版本、提交代码、强制推送或覆盖已公开版本。

源码推送使用 origin 已有的 Git 登录。Release API 优先读取 `GH_TOKEN` / `GITHUB_TOKEN` 环境变量，否则复用 Git Credential Manager 中 github.com 的登录；环境变量不会自动替 Git 配置认证。凭据只在内存中使用，不写入报告或命令行。网络代理读取 `HTTPS_PROXY`，也兼容 `ALL_PROXY`；没有代理变量时直接连接。

只检查本机成品和发布条件，不修改 GitHub：

```powershell
npm run release:local -- --dry-run
```

dry-run 仍完整验收，最后显示 `publishable` 与阻止原因。已有公开版本会被明确识别，不会覆盖。已有验收记录且源码、版本和附件均未变化时，可用 `--resume --dry-run` 检查，而不重复构建。

网络中断后保留同一批文件和原说明，续传命令为：

```powershell
npm run release:local -- --resume --notes test-results/release-notes.md
```

续传要求原验收全部通过、提交与文件哈希未变；相同草稿附件会跳过，不一致附件会停止并提示检查，不会删除或覆盖。不要在续传前重新打包，重新打包可能产生不同校验值。源码变化后必须重新验收。若已经公开但公开下载检查遇到网络问题，先检查 Release 页面；命令不会为重试覆盖公开附件。

## 云端手动构建

[Windows 工作流](../.github/workflows/windows.yml) 仅允许 Actions 页的 **Run workflow** 手动触发，执行相同本机验收命令并提供构建附件，不公开 Release。普通分支和标签推送均不触发构建。

GitHub 账户账单锁定可能导致运行器尚未启动就失败，手动入口也无法绕过此限制；请在账户设置处理，或联系 GitHub 支持。历史失败记录保留，不作为本机成品故障的证据。账户恢复后可先手动验证云端，再单独决定是否恢复自动触发。

日常说明只维护当前流程。历史变化由 Git 与 Releases 保存，报告和截图保存在忽略提交的测试目录。

## 下载与升级

Windows 10/11 x64：`Setup` 为安装版，`Portable` 为免安装版。程序未签名，请使用同批 `SHA256SUMS.txt` 校验。

升级前关闭旧程序，建议先创建完整备份。个人资料库独立于程序目录，免安装文件不包含旅行或照片，卸载不删除个人资料库。
