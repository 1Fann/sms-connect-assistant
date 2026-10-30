# 更新记录 / Changelog

## 0.4.0-candidate

- 按 Apple 官方 iOS 27“信息”参考图重做 iPhone 页面，面向 iOS 27.2：底部悬浮搜索/新建、玻璃按钮、联系人头像、分组气泡与时间。
- 新增未读筛选、选择标为已读、发送线路面板；保留未知结果核对和失败提示，不将“已接受”伪装为“已送达”。
- 调整安全区、缩小视口时的输入区、浅色/深色布局；11 项前端测试和两套模拟浏览器流程通过。iOS 27.2 真机键盘与原生玻璃材质仍需对照确认。

- Rework the iPhone UI using Apple's iOS 27 Messages reference, targeting iOS 27.2: floating bottom search/compose controls, glass buttons, contact avatars, grouped bubbles and timestamps.
- Add unread filtering, selection-based read marking and a SIM options sheet. Preserve uncertain-send verification and failure states; acceptance is not delivery.
- Refine safe areas, compact-viewport composition, and light/dark layouts. Passed 11 frontend tests and two mocked browser flows; actual iOS 27.2 keyboard behavior and native glass fidelity still need device comparison.

Reference / 参考：[Apple iPhone 使用手册](https://support.apple.com/zh-cn/guide/iphone/iph82fb73ba3/27/ios/27)。网页实现不等同于系统原生控件 / Web rendering is not a native system control.

## 0.3.1-candidate

- 应用更名为“短信互联助手”，保持包名、数据和签名升级兼容。
- 公开源码使用示例域名，加入中英双语文档、上游来源说明和无需发布密钥的 CI。
- 保留默认短信应用收发修复、HTTPS/PWA、证书任务及可选 Root 守护。

- Rename the app to 短信互联助手, preserving package, data, and signed-update compatibility.
- Use an example domain in public source; add bilingual documentation, attribution, and CI without release credentials.
- Retain default-SMS fixes, HTTPS/PWA, certificate jobs, and optional Root monitoring.

## 0.3.0-candidate

- 配置检查页面、可选 Root 独立守护、可调检测间隔；手动关闭不自动拉起。
- Setup checks, optional independent Root watchdog, configurable intervals, and respect for manual stop.

## 0.2.1-candidate

- 默认短信角色兼容处理及独立发送状态刷新，失败不自动重发。
- Default SMS role compatibility and independent outgoing-state refresh without automatic resend.
