# CommLink 0.9.6 · 通话记录主动授权 / Explicit call-history authorization

## 中文

Android 配置检查与自动恢复页新增「授权并共享本机通话记录」开关。用户需要主动开启；系统权限与本机共享同意分开检查，只有两者都开启时才会扫描和同步。若小米手机管家或系统策略拦截授权弹窗，页面可打开系统应用权限设置。通讯数据授权页也提供询问系统权限和手动设置入口。

版本：0.9.6（versionCode 58）。

## English

Android Configuration checks and recovery now includes an explicit **Authorize and share this phone's call history** switch. Sharing starts only when both the Android permission and local sharing consent are enabled. If Xiaomi Security or another system policy blocks the permission dialog, users can open the system app-permission page. The directory access page also exposes the request and settings fallback.

Version: 0.9.6 (versionCode 58).

## 修复 / Fixes

- Root 守护兼容 KernelSU / APatch 的 BusyBox 路径，并验证 Root 身份；普通收发仍不依赖 Root。
- 权限状态同时检查 Android 权限和 AppOps，通话记录读取失败时给出提示。
- 修正正式签名文件路径；发布版本由标签确定。
- Support KernelSU/APatch supervisor tools, validate root identity, check both runtime permissions and AppOps, surface call-log read failures, and derive signed release versions from tags.

- Root 权限以 `su` 执行结果和 UID 0 为准，不限定管理框架；BusyBox 支持系统 PATH 和常见框架路径。
- Root authorization is verified with UID 0 independently of the framework. Supervisor tools can be found on PATH or in common framework locations.
