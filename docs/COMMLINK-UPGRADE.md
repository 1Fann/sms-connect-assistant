# CommLink 0.9.0-dev · 升级与验收 / Upgrade and acceptance

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

## 本次验证结果

- 构建通过：TypeScript、两个 Vite 入口、Android release 和 Android 单元测试（151 项通过）。已核对 APK 的签名证书与 0.8.9 相同，版本 24，应用名称「通讯互联」。
- 数据与网页：36 项前端单元、9 项短信队列 SQLite、3 项目录 SQL 检查通过；另验证了真实浏览器中的线路选择、禁发和重试、会话状态写入顺序、长按与键盘、目录编辑和未就绪拨号。Node Worker 测试覆盖独立缓存与推送点击目标。
- 红米 Android 13：测试包与日用短信使用独立 UID，无需授予真实通讯数据权限。17 项 instrumentation 全部通过（目录 5、多节点 6、语音控制器 4、真实回环 TLS 授权/关闭 1、0.8.9 会话迁移 1）。语音控制器测试使用真实 SQLite 和模拟 ARI 对端，不会连接 PBX。测试后已移除两个临时测试包，日用安装仍为 0.8.9。
- 目前没有独立测试 PBX / 真实测试线路。没有做真实外线呼叫、生产 PBX 变更、iPhone 双 PWA/CallKit 实测、多手机实发或系统联系人实际写回。此版本是可测试交付，不是这些项目的验收证明。

## English

This is a development build based on SMS Connect Assistant 0.8.9. The release package keeps the original application ID and signing chain. The gateway Room database stays at v25 and the default SMS journal at v1. The peer database migrates from v2 to v3; the iPhone database migrates from v7 to v8. Existing message identities, pairing, receipts, ambiguous submissions and legacy numeric line aliases are retained. Verify a restorable device backup before production migration. Do not uninstall, clear data, or downgrade an upgraded database.

Messages stays at the original root origin on port 8443. Phone installs separately from the same trusted host at port 8444, path `/phone/`. Approve the app, installation, device list and operations on Android. Ports are separate web origins; access credentials, push subscriptions and caches are scoped separately. Pair additional Android phones to the host and explicitly grant data capabilities per source. Only verified voice gateways may originate calls; no PBX or Cloudflare changes take place automatically.

Build the two web entries before the APK. The isolated Android instrumentation build is opt-in via `-PcommLinkFixture` and uses a distinct debug application ID. Database fixtures, browser mocks and ARI simulations validate code paths, not carrier delivery or two-way media. Production acceptance requires actual SIM selection, iPhone Home Screen installs, system contacts, CallKit, RTP and a handoff that retains the original external leg. See [directory sync](COMMLINK-DIRECTORY.md) and [voice setup and validation](VOICE.en.md).
