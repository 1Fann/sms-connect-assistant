# 更新记录 / Changelog

## 0.9.0-dev10 · iPhone 联系人导入

- 互联电话导入 .vcf：本地预览、明确确认、仅保存助手姓名/号码，不写系统通讯录。
- 去重、分批原子提交与相同请求重试；目录 v3 保留原有联系人、通话和未接查看状态。
- 52 项 TypeScript、145 项 JVM、15 项 Android 隔离测试通过；真机文件导入等待用户确认。
- Import iPhone .vcf files into assistant-only cards with local preview and explicit confirmation. Add duplicate detection, atomic batches and idempotent retries; migrate directory schema to v3 without changing system contacts. See [release notes](docs/releases/0.9.0-dev10.md).

## 0.9.0-dev · CommLink

- 保留 0.8.9 短信入口和签名身份，加入多设备注册、逻辑线路、独立电话 PWA、分安装授权、双向联系人写回及通话记录。
- 语音适配器使用受限的网页 SIP 端点和本机 ARI。真实选卡、锁屏、媒体和接续的发布门槛见 [升级说明](docs/COMMLINK-UPGRADE.md)。
- Adds device-scoped pairing and lines, the Phone PWA, contact write-back, call records and an opt-in Asterisk/WebRTC/Groundwire integration. Physical voice acceptance is pending.


## 0.6.0-candidate

- 补齐左滑“隐藏提醒 + 删除”，静音标记、长按菜单和联系人详情开关共享持久状态。
- 推送按对话实际静音，在入队、执行和重试时检查；匹配全球号码格式与地区，不做后缀模糊匹配。保留短信接收和安卓通知；显式测试通知独立。已提交到 Apple 的提醒不能撤回。
- 新增“编辑 → 选择信息 / 编辑置顶”、批量标未读、向右完整滑动切换已读、气泡长按拷贝/转发、向左拖动查看时间。转发仅创建草稿。
- 124 项 Android 单元测试、14 项前端测试及三套模拟浏览器流程通过；更新保留配对、证书与原有检测设置。

- Complete swipe-left Hide Alerts + Delete, persistent mute indicators, and matching long-press/contact-sheet controls.
- Suppress actual per-conversation push at enqueue, execution, and retry using country-aware sender identity, without suffix matching. SMS reception and Android alerts remain active; explicit test notifications are independent. Already-submitted Apple notifications cannot be recalled.
- Add Edit → Select Messages / Edit Pins, batch mark unread, full swipe-right read toggling, long-press bubble copy/forward, and drag-left timestamps. Forwarding only creates a draft.
- Pass 124 Android unit tests, 14 frontend tests, and three mocked browser flows. Upgrades preserve pairing, certificates, and monitoring settings.

Reference / 参考：[Apple 隐藏提醒操作](https://support.apple.com/zh-cn/guide/iphone/iph62faab6a4/27/ios/27)。Web rendering does not implement iMessage, RCS or iOS system Focus controls.

## 0.5.0-candidate

- 新增左滑删除、右滑已读/未读、长按菜单、最多九个置顶会话、批量删除及“最近删除”恢复。
- 置顶、未读与移除状态保存在安卓端，重新打开或覆盖升级后保留。删除只影响助手显示，安卓原始短信不删除；新短信仍会正常出现，恢复不设自动过期。
- 打磨滑动回弹、菜单和底部弹层进出、页面切换与气泡动画；响应系统“减弱动态效果”，防止纵向滚动及长按松手误触。
- 118 项 Android 单元测试、14 项前端测试和三套模拟浏览器流程通过；实机更新保留原有配对、证书及检测间隔。

- Add swipe-to-remove, swipe-to-mark read/unread, long-press menus, up to nine pinned conversations, bulk removal, and Recently Deleted recovery.
- Store conversation metadata on Android across reloads and signed upgrades. Removal only changes the assistant view, preserving original Android SMS; new messages remain visible and recovery has no automatic expiry.
- Refine swipe settling, menu/sheet transitions, navigation and bubble entrances. Respect Reduced Motion and prevent vertical scrolling or long-press release from activating unintended actions.
- Pass 118 Android unit tests, 14 frontend tests and three mocked browser flows. Signed device updates retain pairing, certificates and monitor settings.

References / 参考：[Apple 对话置顶与未读操作](https://support.apple.com/zh-cn/guide/iphone/iphe9b48b89e/27/ios/27)、[Apple 删除对话操作](https://support.apple.com/zh-cn/guide/iphone/iph2c9c4bfcb/27/ios/27)。此项目使用助手内移除/恢复语义，未模拟 iCloud 删除，也不实现 iMessage 功能。Web gestures and motion approximate Messages; they are not native system controls.

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
