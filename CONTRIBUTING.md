# 贡献 / Contributing

## 中文

欢迎提交 Issue 和 Pull Request。请描述设备、Android / ROM 版本、应用版本、Root 是否启用、脱敏复现步骤及实际结果。不要提供真实短信、号码或凭据。

保留 Apache-2.0 许可和上游来源；本分支重点是私人 Android ↔ iPhone 短信互联。改动界面文字时保持应用中文，更新中英两份文档。涉及发送、幂等、默认短信角色或守护时应补充针对行为的测试。自动测试不得发送真实短信；真机发送须由测试者明确确认。

运行 README 中的 Android 和前端检查。浏览器模拟测试位于 `pwa/tests/browser.cjs` 和 `pwa/tests/layout.cjs`，需要 Playwright 与 Edge，或通过 `BROWSER_CHANNEL` 指定可用的浏览器通道。`PLAYWRIGHT_MODULE` 可指向本地 Playwright 模块。不要提交私有签名文件、构建缓存、部署记录或个人配置。

## English

Issues and pull requests are welcome. Include the device, Android/ROM version, app version, whether Root is enabled, redacted reproduction steps, and observed behavior. Do not include actual messages, numbers, or credentials.

Retain Apache-2.0 licensing and upstream attribution. This branch focuses on private Android ↔ iPhone SMS connectivity. Keep the application UI Chinese and update both documentation languages. Add behavioral tests for changes to sending, idempotency, default SMS handling, or monitoring. Automated tests must not send real SMS; real-device sending requires explicit tester consent.

Run the Android and frontend checks in README. Mocked browser tests are `pwa/tests/browser.cjs` and `pwa/tests/layout.cjs`; they need Playwright and Edge, or an available channel set with `BROWSER_CHANNEL`. `PLAYWRIGHT_MODULE` can point to a local Playwright module. Do not commit signing files, build caches, deployment records, or personal configuration.
