# CommLink 0.9.0-dev · 升级与验收 / Upgrade and acceptance

> 当前开发版为 **0.9.0-dev7 / 30**。电话已改为从拨号开始由 Groundwire 承载；以下旧 WebRTC / ARI 部署与验收记录是历史记录，不代表当前实现。现行配置见 [中文语音指南](VOICE.zh-CN.md)、[English voice guide](VOICE.en.md) 、[原生通话说明](releases/0.9.0-dev6.md) 和 [SIM 显示说明](releases/0.9.0-dev7.md)。

## 安装边界

这个开发版本从 0.8.9 / 23 增量开发，release 的 applicationId 仍为 `me.capcom.smsgateway.iphone`。使用原签名覆盖升级。数据库升级后，旧 APK 无法直接覆盖回退。测试数据库迁移、隔离安装及带原签名的发布构建是三个不同的检查。日用系统全面切换前，应保留与原签名和私有应用数据相匹配、**实际可恢复**的设备级备份；单独复制 SQLite 文件不能恢复 Android Keystore 密钥。迁移报错时保留原数据，记录数据库版本和脱敏错误，在复制件上修复后用更高 versionCode 覆盖；不要卸载或清数据。

| 0.8.9 基线 | CommLink 变更及保护 |
|---|---|
| Room `gateway` v25、`default-sms.db` v1 | 沿用原库，保留发送队列、提交占用、分段回执和收件恢复。结果未知的发送不创建新请求。 |
| `paired-phone.db` v2 | v3 增加设备注册、稳定线路、设备归属、来源复合键和绑定检查。旧共享手机凭据映射到旧身份，旧历史 ID 保留。新增设备有独立身份，在安卓批准；线路重绑定须核实实体 SIM。参见 [多设备协议](MULTI_PHONE.md)。 |
| `iphone.db` v7 | v8 为原会话赋予互联信息身份、安装标识、旧服务器及旧共享手机访问范围。保留刷新关系、订阅、请求、已读及会话属性。不同设备授权集合的会话标记分别保存。新手机或新功能须由主节点管理员授权。 |
| 新目录与语音能力 | 新建独立业务数据库。Android 未授权、PBX 未就绪或无返回事件时，显示相应状态。详见[目录同步](COMMLINK-DIRECTORY.md)和[语音操作](VOICE.zh-CN.md)。 |

## 两个入口

- **互联信息**使用原 HTTPS 主机 TCP 8443 的根路径，保留根 Manifest ID。旧用户从主屏幕重新打开更新。不要删除旧图标、Cookie 和配对记录来完成迁移。
- **互联电话**使用同一主机及有效证书的 TCP 8444、路径 `/phone/`。旧端口的 `/phone/` 会重定向。独立端口是独立浏览器来源；请按实际网络仅允许目标设备所需端口。在 Safari 单独添加到主屏幕，分别申请通知、完成配对。在安卓设置管理每个安装可用的设备、读写和付费拨号能力。
- 两个入口使用独立 Manifest、Worker、缓存前缀、凭据名和订阅归属。信息 Worker 与设置页只清理自己的缓存。电话 Worker 的未接提醒只打开电话应用；Groundwire 的原生来电由独立 SIP 推送路径负责。
- 共享手机只需加入主节点，按设备授权短信、通讯录、联系人写回和通话记录。无语音能力的手机仍可加入。线路排序、默认和换卡确认在安卓设备管理中操作。
- WebRTC 必须使用独立受限 SIP 身份。开发版不会在安装时改生产 PBX。手动或后台接续只调度原呼叫的用户侧通道，用户仍需接听 Groundwire；真实双向音频和锁屏体验须在测试线路上验收。

## API 与运行诊断

8443 保留原 `/api`、`/peer`、`/healthz`、主屏幕点击入口及旧线路别名。新短信请求提交 `lineId`，旧请求仍可提交 `sim`。同一个请求永远不要换线路重试。8444 有自己的 `/api/pair`、`/api/pair/finish`、`/api/refresh`、`/api/logout`。其 `/api/v2` 中包含：

| 范围 | 入口 |
|---|---|
| 安装与线路 | GET session、devices、lines。设备与线路按安装授权过滤。 |
| 目录 | GET contacts、contacts/{id}、contact-sync/jobs。POST contacts/{create,edit,delete,restore,merge,split}。写操作携带请求 ID、版本和显式写回目标。 |
| 通话记录 | GET call-history 与 voice/history。保留 Android 来源记录及 PBX 通话 ID，不按相近时间猜测合并。 |
| 浏览器通话 | GET voice/status；POST voice/web-session、calls；GET calls/{id}/state；POST calls/{id}/hangup、calls/{id}/handoff。PBX 管理凭据不下发。 |
| 通知 | GET push/key；POST push/subscribe、push/unsubscribe。电话订阅收未接提醒，不冒充 CallKit。 |

出现 401，检查安装是否已撤销；403 检查 Origin、主机名和功能/设备授权；409 检查数据版本、绑定或忙线；503 检查 ARI、注册与端点。不要用自动重拨或自动换卡消除错误。

## 测试及发布门槛

1. 运行锁定依赖的前端测试和双入口构建，再构建 Android。CI 的标准构建用 JDK 17、Gradle 8.8、Android 35。发布凭据沿用原项目的环境变量，不写入仓库。
2. 运行 `tests/delivery_journal_test.py`、`tests/directory_sync_sql_test.py`、Android 单元测试及浏览器短信/电话 fixture。Android 仪器测试应使用 `-PcommLinkFixture :app:assembleDebug :app:assembleDebugAndroidTest`。该 Debug 构建使用独立 applicationId 和构建目录，启动时跳过短信服务及守护。仅执行指定合成测试类，不授予真实短信或通讯录权限。
3. 真实接续放行需要一套经过授权的隔离 PBX、新端点、可信 WSS、媒体协商以及可靠的进线 SIM 映射。分别记录外线 ID、用户侧通道 ID、RTP 变化、接续超时和忙线恢复。先验证一通外线，再验证拒接、无媒体、丢响应和网络切换。
4. 发布前还要用真 iPhone 验证双图标安装、独立撤权、升级后保留短信 Push、未接提醒归属、通话中退后台和锁屏接听；用两部真实 SIM 手机验收正常收发、第三台设备接入、热换卡、受限系统账号的联系人写回和真实来电记录。合成数据通过不能替代这些结果。

## 首次可测试交付验证结果（部署前）

- 构建通过：TypeScript、两个 Vite 入口、Android release 和 Android 单元测试（151 项通过）。已核对 APK 的签名证书与 0.8.9 相同，版本 24，应用名称「通讯互联」。
- 数据与网页：36 项前端单元、9 项短信队列 SQLite、3 项目录 SQL 检查通过；另验证了真实浏览器中的线路选择、禁发和重试、会话状态写入顺序、长按与键盘、目录编辑和未就绪拨号。Node Worker 测试覆盖独立缓存与推送点击目标。
- 红米 Android 13：测试包与日用短信使用独立 UID，无需授予真实通讯数据权限。17 项 instrumentation 全部通过（目录 5、多节点 6、语音控制器 4、真实回环 TLS 授权/关闭 1、0.8.9 会话迁移 1）。语音控制器测试使用真实 SQLite 和模拟 ARI 对端，不会连接 PBX。测试后已移除两个临时测试包，日用安装仍为 0.8.9。
- 目前没有独立测试 PBX / 真实测试线路。没有做真实外线呼叫、生产 PBX 变更、iPhone 双 PWA/CallKit 实测、多手机实发或系统联系人实际写回。此版本是可测试交付，不是这些项目的验收证明。

## 2026-11-02 · 主节点部署（0.9.0-dev2 / 25）

用户随后授权了实际部署。此记录取代上面的“日用安装仍为 0.8.9、没有生产 PBX 变更”状态。已用相同签名覆盖升级红米主节点，保留包名和原数据。原短信 HTTPS 8443 的页面、Worker 与健康检查通过。电话 HTTPS 8444 的页面、Manifest 和 Worker 与打包资源一致；未授权 API 返回 401，电话来源没有提供 ARI 路由。用户确认 iPhone 能访问新端口、添加独立图标并完成配对；原信息图标保留。

本次运维显式启用了既有 Asterisk 的 WebSocket、PJSIP WebSocket、ARI/Stasis、SRTP、ICE 等组件。HTTP/ARI 仅绑定回环 127.0.0.1:8088；电话 HTTPS 只将 /ws 代理到本机 SIP WebSocket，要求有效电话安装的拨号授权及相同 Origin。代理限制帧大小和队列，撤权后关闭会话。真实 Android TLS 测试覆盖未授权/跨来源拒绝、文本帧双向代理和持续连接撤权。

网页使用新增受限 SIP 端点。网关绑定既有 2001，接续复用原 Groundwire 1001，不需重新输入 iPhone SIP 凭据。保留原 1001/1002、2001 及既有蜂窝呼入拨号计划。网页 context 只进入 Stasis 短期票据处理，不包含普通外拨路由。数字端点兼容已补单元测试。凭据经设备内 root 私有文件一次导入 Android Keystore，导入文件自动删除，不进入源码、APK、聊天或浏览器管理接口。

实机只读诊断确认：两张 SIM 在线、存在、已确认且启用；电话安装有主节点拨号权限；ARI 已连接，网关和 Groundwire 在线且空闲。完成 SIP Digest 注册及注销，自动检查没有拨打外线。诊断用的临时电话授权已退出，隔离 Android 测试包已移除。签名 release 构建与 152 项 JVM 测试通过。

原 APK 与 PBX 配置备份位于设备 root 专用目录。应用快照在第一次覆盖安装之后取得，不能视为经过验证的完整升级前备份；勿卸载、清数据或直接降级数据库。主配置头部的 include 经网络准备后仍保留；Asterisk 助手的全新初始化可能覆盖集成，执行前须重新备份。

真实外线、双向声音、锁屏 CallKit、后台接续、不同网络媒体、多手机、联系人写回及系统通话记录权限尚待验收。未配置 TURN，跨网直连媒体可用性须实测。多卡蜂窝呼入继续使用旧路线，没有猜测 SIM 来源。仅安装 APK 不会自动创建本次 PBX 私有配置。

## English

This is a development build based on SMS Connect Assistant 0.8.9. The release package keeps the original application ID and signing chain. The gateway Room database stays at v25 and the default SMS journal at v1. The peer database migrates from v2 to v3; the iPhone database migrates from v7 to v8. Existing message identities, pairing, receipts, ambiguous submissions and legacy numeric line aliases are retained. Verify a restorable device backup before production migration. Do not uninstall, clear data, or downgrade an upgraded database.

Messages stays at the original root origin on port 8443. Phone installs separately from the same trusted host at port 8444, path `/phone/`. Approve the app, installation, device list and operations on Android. Ports are separate web origins; access credentials, push subscriptions and caches are scoped separately. Pair additional Android phones to the host and explicitly grant data capabilities per source. Only verified voice gateways may originate calls; no PBX or Cloudflare changes take place automatically.

Build the two web entries before the APK. The isolated Android instrumentation build is opt-in via `-PcommLinkFixture` and uses a distinct debug application ID. Database fixtures, browser mocks and ARI simulations validate code paths, not carrier delivery or two-way media. Production acceptance requires actual SIM selection, iPhone Home Screen installs, system contacts, CallKit, RTP and a handoff that retains the original external leg. See [directory sync](COMMLINK-DIRECTORY.md) and [voice setup and validation](VOICE.en.md).

### Authorized deployment on 2026-11-02

The connected Redmi now runs signed 0.9.0-dev2 (25), retaining the original package/data. Asterisk web voice modules are enabled; ARI remains loopback-only. Phone exposes an authenticated, same-origin SIP WebSocket proxy with bounded frames/queues and live revocation. Existing gateway 2001 and Groundwire 1001 are reused, retaining incoming routes. SIP registration/cleanup and real Android TLS/WS checks passed without automatically originating external calls. Temporary test apps/sessions were removed; 152 JVM tests passed.

Carrier calls, two-way media, CallKit, handoff, contacts writeback and cross-network media remain unverified. TURN is not configured. The app data snapshot was taken after the first upgrade and is not a verified pre-migration rollback. PBX configuration is site-specific and is not created automatically by installing the APK.


## 同日呼出依赖补修

实际网页呼叫随后暴露了遗漏的 bridge_holding.so：ARI 已接受 dial，但内部 holding dial_bridge 无技术实现，未发出网关 INVITE。主节点已即时加载并写入持久 modules.conf。回环 UDP 合成端点测试在修复前复现失败、修复后收到携带正确号码/SIM 头的 INVITE，未由自动测试发起真实电话。详见 [语音故障与验证](VOICE.zh-CN.md)。本项是 PBX 配置修复，当前已安装 APK 仍为 0.9.0-dev2；源码的离线配置草案说明也已补充该依赖。


## 同日无声修复与实测（0.9.0-dev3 / 26）

主节点已覆盖安装 dev3。修复 WS transport 的 RTP 回环绑定后，实际浏览器 Echo 收发均有数据，用户也已确认 iPhone 回声和真实通话双向声音正常（家庭 Wi-Fi、无 VPN）。新增仅连接主节点的音频测试、单次通话麦克风流复用及取消释放、声音播放重试和包计数。39 项前端、152 项 JVM 测试及签名构建通过。当前仅保留原用户电话授权，临时诊断授权/进程和 SIP history 已清理。跨网络、锁屏和接续仍待单独验收。主屏幕 PWA 重开后的麦克风再次授权属于平台限制，详见语音文档。


## 0.9.0-dev4 / 27 · 电话网页界面

按用户录屏调整三项悬浮导航、搜索、通话列表与过滤、联系人海报、分组索引及拨号键盘。拨号、音频流、授权和 PBX 沿用原流程。通话移除是当前浏览器安装的可恢复视图状态，不删除安卓原始记录。40 项前端测试、152 项 JVM 测试、浏览器交互与短信回归、签名构建和设备 HTTPS 资源核对通过；已覆盖安装主节点。本轮未发起真实呼叫。详见[中英版本说明](releases/0.9.0-dev4.md)。
