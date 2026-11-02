# 构建与发布

## 本地构建

在 Windows x64、Node.js 24 环境中运行：

```powershell
npm ci
npm test
npm run dist:win
$env:MYMAP_EXECUTABLE = (Resolve-Path 'release/win-unpacked/MyMap.exe').Path
npm run test:e2e
Remove-Item Env:MYMAP_EXECUTABLE
npm run checksums
```

`release/` 包含安装版、免安装版及 `SHA256SUMS.txt`。校验文件只适用于同一批构建产物；本机与云端程序因构建时间及环境不同，可能有不同哈希。

发布前确认包内仅含程序、离线公共资源、虚构演示内容及必要许可，没有个人资料库、照片、备份或凭据。完整验证范围见 [验证方法](VALIDATION.md)。

## GitHub 发布

1. 在 `package.json` 和锁文件中同步设置目标版本。
2. 提交并推送源码，等待主分支工作流通过。
3. 创建与包版本一致的 `v*` 标签并推送。
4. 标签工作流通过成品测试后，自动创建 Release 并附上两种程序和校验文件。
5. 检查公开下载、附件校验值及标签源码。

[Windows 工作流](../.github/workflows/windows.yml) 在主分支检查源码应用；标签或手动运行时生成程序并测试真实打包产物。失败诊断保留在 Actions 附件，已存在的 Release 不自动覆盖。

日常文档只描述当前功能和维护方法，历史改动由 Git 与 [Releases](https://github.com/Lisalsj/MyMap/releases) 保存。测试工具的报告和截图写入 `test-results/`，不按版本重复提交。

## 下载与升级说明

Windows 10/11 x64：文件名含 `Setup` 为安装版，含 `Portable` 为免安装版。程序未签名，下载后请使用同批 `SHA256SUMS.txt` 校验。

升级前关闭旧程序，建议先在设置中创建完整备份。个人资料库独立于程序目录，免安装文件本身不包含旅行或照片；卸载不删除个人资料库。
