# 通讯录、来源写回和 Android 通话记录 / Directory and Android call history

## 使用

在需要贡献数据的每台 Android 上打开「通讯数据授权」。读取通讯录、写回通讯录、读取通话记录可以分别开启。系统原有联系人权限不会自动同意共享。Android 安装方式或 ROM 可能限制通话记录权限；通讯录、短信和电话权限分别处理。

在互联电话配对时，仅勾选需要的功能和设备。「通讯录」中默认只编辑统一名片。勾选某设备的已有来源才会修改该 RawContact；「创建副本」会在所选设备新建本机联系人。所有设备的原始姓名、号码和来源标识均可查看。手机离线时，工作进入持久队列，在目标重新连接且允许写回时执行。关闭共享或撤销权限后，不会把空查询解释为全表删除。

- 按完整有效的国际号码匹配。姓名冲突保留待核对卡片，短号、匿名、字母发送方及号码末尾相同不会自动合并。可选择手动合并或拆出某个来源。
- 统一名称优先于首选来源以及其他来源。要采用某台设备的原始姓名，在编辑统一名片时清空姓名，选择优先来源。移除统一名片会进入「最近删除」，恢复不向 Android 自动创建或编辑联系人。
- 查看详情的同步记录。如果来源在排队期间改变、数据属于只读账号或系统拒绝写入，先核对最新来源，再明确选择要写回的字段/目标。瞬时 Provider 或网络错误会重试原操作 ID。删除来源时只会删除明确选中的原始联系人。
- 通话记录保留设备、系统记录 ID、原始来电显示权限、时间、秒数和类型；有可验证的 Android 电话账号-订阅映射时还提供卡槽。不会依据号码及时间把 PBX 和蜂窝记录强制合并。

## 存储与同步

0.8.9 的 SMS/Room/Peer 数据库不进入目录模块的写入路径。首次升级单独创建 `commlink-directory.db` v1。在本机为每个配对维护增量发送日志、单调序号和回执。服务端按可信设备身份及 RawContact/CallLog 原始 ID 存储，在一次 SQLite 事务中更新来源、同步水位、统一 ID 和工作状态。新配对使用独立的日志。新旧短信协议可以没有 directory 扩展字段。

Provider 扫描在独立线程上，约每 30 秒有同步机会时执行。比较原始联系人版本和账号绑定，号码等数据只读取变化来源；通话记录通过投影摘要比较。只有完整成功的快照会给已消失来源发送墓碑。空库不能证明用户有意清空整个来源，保守保留历史。照片只同步小缩略图。数据库删除保护不还原第三方账号内部私有字段。

Android 写回应先比较来源 ID、账号绑定、原始版本和只读标志。Provider 批操作同时写自定义操作标记；网络断开或写完未回 ACK 时再次提供同一 job，不产生第二个联系人副本。来源删除结果不明时若无法在 Provider 中证实，报冲突供核实。

## 接口（电话来源上 /api/v2）

- `GET contacts?q=&offset=&deleted=true&favorite=true`（筛选均可选），`GET contacts/{id}`。列表为 `{items,next}`。卡片有 `id/name/numbers/revision/favorite/conflict/sources`。来源有 `deviceId/rawId/contactId/revision/name/numbers/readOnly`。
- `POST contacts/create|edit|delete|restore|merge|split`。所有操作需要 UUID `requestId`，编辑既有卡片带 `id/revision`。目标为显式传入的 `targets:[{deviceId,rawId?,revision?,action}]`。删除须 `confirm:true`。合并额外提交 `otherId/otherRevision`；拆分提交 `deviceId/rawId`。部分来源未获授权时限制修改整张统一卡片。
- `GET contact-sync/jobs?contactId=` 可查来源操作状态。业务冲突需要重新核对版本。读/写接口分别校验安装实例权限及设备范围。
- `GET call-history?deviceId=&offset=` 返回系统通话记录，时间为毫秒，时长为秒。与 PBX 通话使用独立来源身份。

## English

Each Android participant explicitly enables contact reading, contact writing and call-history reading in the local permissions screen. Phone installations must also be approved for the corresponding capabilities and devices. By default, editing changes only the unified card. Choose an existing raw contact to update it or explicitly create a local copy on a target phone. Offline writes are durable and bound to the intended device. Revision or read-only errors require reviewing the source before submitting a new intent. Restoring a card does not silently recreate a deleted Android source.

Directory v1 uses a new SQLite file. It preserves updates and tombstones with per-link sequence acknowledgements. A failed or unexpectedly empty Provider query does not wipe the address book. Cards match verified full telephone identities, preserve each source and expose ambiguous names for review. Android call records preserve origin and identifiers; independently observed PBX events are not joined by telephone number and timestamp alone.

The three SQLite host contract checks run with `python tests/directory_sync_sql_test.py`. The Android directory integration tests use synthetic records and an isolated database. ContactsProvider behavior for OEM/account combinations, restricted call-log permission and real dual-device writeback still require explicitly authorized device tests.


## v2 · 未接来电查看状态

0.9.0-dev9 起，独立目录库升级到 v2，增加 call_seen(installation,device,raw,date) 主键表。GET /api/v2/call-history/missed 返回当前电话安装及获授权设备的未查看数量；POST /api/v2/call-history/seen 接收 records:[{id,date}]，只标记匹配日期且获授权的未接记录。两者需要 calls.read；不修改 Android CallLog。不同安装互不影响，原始 ID 被重用但日期改变时仍视为新事件。表结构迁移不触及短信、配对、联系人或原通话记录。

## v3 · iPhone 联系人导入

0.9.0-dev10 提供「联系人 → 导入 iPhone 联系人」。在 iPhone「通讯录 → 列表」长按目标列表，导出姓名和电话号码并存储到文件，再在互联电话选择 .vcf。文件先在浏览器解析并预览；只有点击确认后才上传姓名与号码。照片、邮箱、地址、备注和账号字段均忽略。不会自动读取 iPhone 全通讯录，不要求 iCloud 凭据。

仅创建助手统一名片和号码别名，不创建 Android 来源、不排队写回；无需开启 Android「允许指定来源写回」。已获通讯录读取权限的安装可以访问这些统一名片，适用于短信和通话名称匹配。同名且号码集合相同会跳过；同号码不同姓名保留独立名片供核对，不自动覆盖或强制合并。导入不是持续同步；之后修改 iPhone 联系人需要重新导出，旧助手名片不会自动更新或删除。

支持常见 vCard 2.1/3.0/4.0、Apple 分组 TEL、多号码、折行、UTF-8/UTF-16 和带字符集的 quoted-printable。仅解析有有效电话号码的卡片，文件上限 10 MiB、5000 张，每张最多 32 个号码、姓名 200 字符、号码 96 字符。不支持或无号码的卡片计为跳过，导入前显示数量。不实现任意 vCard 扩展字段。

新增 POST /api/v2/contacts/import，需要安装级 contacts.read + contacts.write，且经过现有 Origin/会话校验。请求 {requestId:UUID,contacts:[{name,numbers:[]}]}，每批 1–100 条、JSON 请求体最多 512 KiB；响应 {added,skipped,replayed?}。不接受来源写回目标。浏览器逐批提交，网络失败保留当前 requestId，用户可继续重试。重复 requestId + 相同数据返回既有结果；更改数据或跨安装复用被拒绝。每批原子提交，暂停/关闭不回滚已完成批次；重新选择相同文件仍按内容去重。

目录库 v2 → v3 仅增加 contact_imports(id PRIMARY KEY,owner,fingerprint,result,created) 收据表，保留联系人、来源、通话记录和 call_seen。v1 也支持顺序补建两张新增表。收据不含额外明文联系人副本，沿用助手本地数据库保护。不要直接降级至使用较旧目录 schema 的 APK。

### English

Phone now imports exported iPhone .vcf files. In Apple's Contacts app, open Lists, touch and hold a list, choose Export, keep names/phone numbers, and Save to Files. Select that file in Phone → Contacts → Import iPhone contacts, review locally, then explicitly confirm. Only names and phone numbers are uploaded. No system contact is created or modified, no Android writeback job is queued, and no iCloud credential is required.

Assistant cards are visible to installations approved for contact reading. Identical names and phone sets are skipped; different names sharing a number stay separate for review. This is an import, not continuous iPhone synchronization. Existing cards are not overwritten or removed by later exports.

Common vCard 2.1/3.0/4.0, Apple grouped phone fields, folding and quoted-printable are supported. Files are limited to 10 MiB and 5000 cards; cards to 32 numbers, 200-character names and 96-character phone values. Unsupported/no-phone cards are counted as skipped. Pictures and other contact fields are ignored.

POST /api/v2/contacts/import requires contacts.read and contacts.write, authenticated Phone origin/session, UUID requestId and 1–100 contacts per batch (512 KiB JSON limit). Responses report added/skipped; identical retries return a saved result. A changed body or cross-installation receipt reuse is rejected. Batches commit atomically; pausing/closing does not roll back committed work. Directory schema v3 adds only the contact_imports receipt table, preserving existing records and missed-call viewing receipts. Do not downgrade the database.

Reference: [Apple export instructions](https://support.apple.com/en-ie/guide/iphone/iph075ddebf2/ios).

## dev11 · 导入姓名顺序修复 / Name-order correction

vCard 的 N 字段按「姓；名；其他名；前缀；后缀」分开保存，FN 是导出时的显示字符串（[RFC 6350 §6.2.2](https://www.rfc-editor.org/rfc/rfc6350#section-6.2.2)）。dev11 对姓和名均为汉字、无前后缀且 FN 只由这些姓名组成的个人条目，使用姓在前、无额外空格的形式。保留英文格式、自定义显示名与公司显示名；缺少独立字段时不猜测倒转现有字符串。

已导入用户重新选择同一文件时，会读取全部获授权联系人分页，预览可更正的姓名。只有号码集合及旧版姓名准确匹配、结果唯一、没有系统来源且不存在相同新姓名的另一张卡片，才计划更正；保留原联系人 ID、号码和收藏。用户点击「确认导入并更正姓名」后，用既有 contacts/edit、预览时 revision 和空 targets 提交姓名更新。记录在预览后被改变时由服务端版本校验拒绝；重试复用同一 requestId。匹配不唯一或有关联系统来源的条目不新建副本，提示核对。后来改为不同备注的卡片不会被更名。此修复不进行数据库迁移，不触碰系统通讯录。

The N property separates family and given names, whereas FN is presentation text. dev11 uses family-first names for unambiguous structured Han personal names, retaining custom labels, company names and Latin presentation. It does not reverse arbitrary stored strings.

Reselect the original file to preview name corrections. Only a unique source-free assistant card matching the legacy name and entire phone set is eligible, provided there is no other card with the corrected name. Explicit confirmation performs a name-only edit with the original ID and revision; numbers and favorites are retained, targets stay empty, and retries reuse the request ID. Ambiguous/source-backed matches require manual review. No schema migration or system-address-book write is involved.

## dev12 · 从通话详情添加联系人 / Contacts from call details

通话详情可新建联系人或将当前号码添加到现有助手名片。需要安装级联系人读写权限，保存前可取消；不会触发系统来源写回。沿用 contacts/create 和 contacts/edit，均显式 targets:[]，编辑携带 id/revision。追加仅更新号码数组，不提交姓名或收藏。完整号码身份重复检查及 32 个号码上限在 UI 中提示；服务端仍负责最终权限与版本检查。网络重试复用相同 UUID，冲突后需返回联系人列表读取当前版本。

Call details can create an assistant card or append the number to an existing one after explicit confirmation. Both contact capabilities are required. Existing create/edit APIs retain empty targets, idempotent UUIDs and revision checks. Appending submits only numbers, preserving names/favorites; duplicate identities and the 32-number cap are checked. System contacts are unchanged.
