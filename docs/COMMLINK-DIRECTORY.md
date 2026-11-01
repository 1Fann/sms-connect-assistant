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
