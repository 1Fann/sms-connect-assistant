# 安全与隐私 / Security and privacy

## 中文

本项目仍是开发候选版本，未完成独立安全审计。配对设备可读取手机短信并通过 SIM 发送可能收费的短信。只开放可信 HTTPS 服务；不应将上游遗留管理端口直接暴露到公网。

- API Token、证书私钥等使用 Android Keystore 加密保存在应用私有目录，不随源码或 APK 分发；安装包不包含可用的部署凭据。
- 网页只缓存界面资源，不持久缓存短信正文或认证密钥；访问凭证使用 Secure / HttpOnly cookie。Android 系统短信库和应用的发送/恢复数据库仍会保存处理短信所需的数据。
- Web Push 仅发送无正文通知。Apple、CA、DNS 服务商与运营商仍参与相应网络过程。普通 SMS 没有端到端加密。
- Root 守护是可选的高权限组件。它只读取检测所需配置，不打开短信库；仅执行哈希已确认的 APK。卸载前应从应用内关闭守护。
- 不要在 Issue、截图、日志、提交或 Release 中发布短信、联系人、号码、Cloudflare Token、签名密钥、证书私钥、配对码或会话凭证。

如仓库的 Security 页面提供私密漏洞报告，请优先使用；否则先创建不含漏洞细节或私人数据的 Issue 请求私密联系方式。不要公开可利用的敏感细节或有效凭据。维护者会尽力处理，但不承诺响应时限。

## English

This is a development candidate without an independent security audit. A paired device can read the phone's SMS and send messages that may incur charges. Expose only trusted HTTPS; do not expose inherited management ports directly to the internet.

- API Tokens and certificate private keys are encrypted with Android Keystore in private app storage and are not distributed in source or APKs. The package contains no working deployment credentials.
- The browser caches interface assets, not persistent message bodies or authentication keys. Access uses Secure / HttpOnly cookies. Android's SMS database and the app's send/recovery databases still retain data needed to process messages.
- Web Push notifications omit message content. Apple, certificate authorities, DNS providers, and carriers still participate in their respective network operations. Ordinary SMS is not end-to-end encrypted.
- The optional Root watchdog is a privileged component. It reads monitoring configuration without opening the SMS database and executes only a hash-approved APK. Disable it in the app before uninstalling.
- Never include messages, contacts, phone numbers, Cloudflare Tokens, signing keys, certificate private keys, pairing codes, or session credentials in issues, screenshots, logs, commits, or releases.

Use private vulnerability reporting on the repository Security page if available. Otherwise, open an issue without sensitive details or personal data to request a private contact method. Do not disclose exploitable sensitive details or valid credentials publicly. Maintainers will make a best effort, without a guaranteed response time.
