# 更新记录 / Changelog

## 0.9.2 · 息屏联网与共享同步恢复

- 主机和共享服务在 Android 13 及以下运行期间申请 Wi-Fi 高性能锁。共享端切换默认网络时可提前重试。既有定时检查会提示连续两分钟未能完成同步。
- On Android 13 and earlier, the host and sharing services request a high-performance Wi-Fi lock. A default-network change can shorten a sharing retry, and the periodic monitor reports sustained sync failures. [中英文说明 / Release notes](docs/releases/0.9.2.md)

## 0.9.1 · 版本整理与短信启动修复

- 版本名统一为 0.9.1，versionCode 升至 53，沿用原包名与签名升级链。
- 汇总 dev27–dev29：不再闪出配对页或第二次“正在载入”；首次鉴权、短信和会话状态合并返回，SIM 线路映射整页批量读取。
- 短信内容仍从安卓实时获取，不持久缓存到 iPhone。版本号调整不改变现有证书、配对和权限配置。
- Rename the release to 0.9.1 (53), retaining package/signing identity and the latest live-startup fixes. See [release notes](docs/releases/0.9.1.md).

## 0.9.0-dev29 · 启动页面衔接

- 首次实时响应完成后，在同一次界面更新中提交短信、会话状态与已授权状态，避免启动页之后再闪过“正在载入”或错误空列表。
- Publish authenticated access, initial SMS and conversation metadata together, moving directly from the startup shell to the prepared inbox. Browser checks cover transient loading, populated/empty inboxes, expiry and network retry.

## 0.9.0-dev28 · 实时短信启动优化

- 首次实时短信响应同时返回当前授权范围内的会话状态，合并启动鉴权、短信和会话状态请求。旧服务端不包含会话状态时仍兼容分开读取。
- 一页本机短信的稳定 SIM 别名改为批量读取；同页已读时间按号码复用，保留历史线路、未读与移除规则。
- 不保存 iPhone 本地短信列表或正文，每次都读取安卓实时数据。网络往返仍决定最低等待时间。
- One authenticated live response supplies initial SMS and scoped conversation metadata. Batch stable SIM aliases and reuse per-request read marks without persistent SMS caching.

## 0.9.0-dev27 · 启动状态修复

- 区分会话验证中、已授权与未配对，避免重开短信时先闪出配对页面。验证期间仅显示无个人数据的列表占位。
- 网络失败时保留重试入口；只有确认会话失效才进入配对。授权检查、并行读取与界面缓存保持生效。
- Distinguish pending, valid and expired sessions. Show a neutral inbox shell during validation, retry network failures, and reveal pairing only after an authentication rejection. Browser fixtures cover expiry, revocation and retry without SMS sends.

## 0.9.0-dev26 · 短信启动与联系人优化

- 短信界面缓存优先显示，后台先准备版本资源再替换页面；更新中断时保留完整旧版，不缓存认证 API、短信正文或凭据。
- 会话首次读取并行进行；安卓页内复用姓名、号码格式与 SIM 查询，并批量匹配通讯录。
- 包含 dev16–dev24 保留的联系人号码排序、写回优先处理、系统电话键盘和点空白收起等调整。联系人编辑键盘仍可能在部分 iPhone 上闪动，不宣称已完全解决。
- Cached Messages startup, complete background shell updates, parallel initial reads and batch sender-name resolution. Includes retained contact ordering, write-back and system-keyboard refinements. See [release notes](docs/releases/0.9.0-dev26.md).

## 0.9.0-dev15 · 互联电话联系人界面

- 依照用户提供的录屏调整联系人列表、详情和编辑页。字母索引支持拖动，详情支持选择号码发短信或拨号，编辑页逐行增删电话。
- Restyled the Phone directory, contact card and editor against the supplied iPhone recording. Existing Android thumbnails appear on supported cards. See the [release notes](docs/releases/0.9.0-dev15.md).

## 0.9.0-dev14 · 通讯录读取兼容修复

- 兼容拒绝 Data.IS_READ_ONLY 投影的通讯录 Provider，保留原始账号只读、版本及批处理行数保护。
- 同步异常仅保存不含联系人内容的提示；网页读取失败时不再显示“通讯录为空”。
- Handle providers that reject the field-level read-only projection without bypassing account or transactional write guards. Surface sanitized scan failures rather than an empty address book. See [release notes](docs/releases/0.9.0-dev14.md).

## 0.9.0-dev13 · 安卓通讯录为准

- 移除 iPhone 导入、姓名修复、助手名片合并/拆分及最近删除入口；只展示安卓系统联系人，旧助手数据保留但不再参与姓名匹配。
- 网页新增/编辑/号码追加绑定目标安卓及来源版本，等待手机写入确认；旧 API 返回 410，未执行的旧工作流写回任务停用。
- Android-native contacts are authoritative; remote writes require explicit device/source binding and a Provider acknowledgement. Legacy assistant imports and merge workflows are removed. See [release notes](docs/releases/0.9.0-dev13.md).

## 0.9.0-dev12 · 电话布局与联系人入口

- 下移拨号页线路和设置，固定底部导航/搜索，保留键盘避让。
- 通话详情新增「新建联系人／添加到现有联系人」，仅保存助手名片，保留幂等、版本与重复号码保护。
- 用户已确认 iPhone 位置、滚动稳定及新增入口。Lower dialer controls, anchor the dock, and add explicit assistant-only contact actions. See [release notes](docs/releases/0.9.0-dev12.md).

## 0.9.0-dev11 · 中文姓名顺序

- 根据独立姓/名字段修正明确的中文个人姓名，保留英文、公司及自定义备注。
- 重新选择原文件可预览并更正已导入姓名，保留原联系人身份、号码和收藏，避免创建重复副本。
- Fix structured Han name ordering and offer explicit, revision-checked correction of legacy assistant-only cards. See [release notes](docs/releases/0.9.0-dev11.md).

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
