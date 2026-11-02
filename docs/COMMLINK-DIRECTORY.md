# 安卓通讯录与通话记录 / Android contacts and call history

## 当前行为（0.9.0-dev13 起）

网页通讯录以安卓系统通讯录为准。每台设备按 Android 聚合联系人 ID 展示，同号码不会在助手里自动合并成另一套名片，也不再提供「待核对」、手动合并、拆分、助手内最近删除、iPhone .vcf 导入或姓名更正功能。联系人姓名采用 Android 的 DISPLAY_NAME_PRIMARY；保留账号来源和只读状态，不在网页重新拆解姓和名。

在每台要共享的安卓手机打开「通讯数据授权」并开启「共享本机通讯录」。需要网页编辑时，再开启「允许远程编辑通讯录」并授予系统联系人读写权限。电话安装本身也需要 contacts.read / contacts.write 和目标设备权限。系统联系人权限与应用内共享授权分别控制。安卓为空时网页为空；之后在安卓添加或导入联系人即可同步。不会把旧助手名片自动写入安卓。

## 网页新增与远程编辑

联系人页和通话详情均可新建联系人；通话详情也能将号码添加到现有安卓联系人。新增时明确选择目标手机，保存在该手机的本机联系人账号。修改既有联系人绑定具体设备和账号来源，不换手机、不自动写入其他来源。多个账号聚合成一张安卓联系人时，默认选择可编辑的姓名来源，用户可切换保存位置；只修改所选来源，其他来源保留。只读账号不能编辑。

点击「完成」才提交，提交前取消不写入。请求以 UUID 去重，并校验聚合联系人快照和原始来源版本；后台写入前再次检查来源版本、账号绑定、只读状态和当前授权，在一次 ContactsProvider 批处理中写入操作标记及修改。网络中断重试原请求，不创建第二个写入。联系人在外部改变时要求重新读取。号码追加只更改所选来源的号码，不提交姓名/网页收藏。

「已排队」不表示已保存。网页查询任务状态，只有安卓返回 done 才提示已写入；离线或超时显示等待，用户可继续检查进度。提交后关闭页面不会撤回已经提交的任务。网页「个人收藏」是助手的界面偏好，绑定安卓联系人身份，不修改系统 STARRED。

本版没有提供网页删除系统联系人的入口；需要删除时在安卓系统通讯录操作。读取会跟随确认的安卓删除事件，失败/临时空查询不会解释为清空所有联系人。

## 存储、升级和同步

继续使用独立 commlink-directory.db v3，不迁移短信数据库。旧助手名片及导入收据只保留在本地旧数据中，不再展示、不参与短信和通话姓名匹配，也不会自动转成系统联系人。启动时停用尚未执行的旧助手工作流写回任务，保留历史结果及新原生任务。旧联系人 API 写操作返回 410，避免旧网页把曾经仅保存助手名片的操作意外变成安卓系统写入。iPhone 导入相关解析器、页面、服务实现与测试已移除；保留历史版本说明用于追溯。

安卓 Provider 在独立线程扫描并发送原有增量日志/确认。网页身份由设备 ID + Android Contact ID 产生，不依据号码归并不同手机或不同系统联系人。内部来源/任务队列继续兼容已有设备协议。聚合姓名和姓名来源也进入版本比较，防止联系人显示名称在未修改原始版本时变化造成误写。Provider 的实际写入沿用原子标记和账号版本检查。头像仅保留已有小缩略图同步能力。

## API（电话来源 /api/v2）

- GET contacts?q=&offset=&favorite=true；GET contacts/{id}。列表返回 {items,next}。条目包含 id/deviceId/nativeContactId/name/numbers/sources/primaryRawId/revision/favorite。sources 包含 deviceId/rawId/contactId/revision/name/numbers/readOnly。revision 是可安全传给 JavaScript 的 48 位版本摘要。
- POST contacts/native/create：{destination:"android",requestId,deviceId,name,numbers}。
- POST contacts/native/edit：{destination:"android",requestId,id,revision,deviceId,rawId,sourceRevision,name?,numbers?}。不接受旧 targets 字段；不会创建统一备注覆盖层。
- POST contacts/native/favorite：{destination:"android",requestId,id,revision,favorite}，仅修改网页收藏。
- 写入响应 {id,deviceId,jobId,state,replayed}。create/edit 的 jobId 对应本次源设备写入，返回 queued 时必须继续检查结果。favorite 无 Provider 任务。
- GET contact-sync/jobs?contactId= 返回任务的 id/state/detail 等信息。done 是安卓确认；conflict/denied/failed/revoked 必须提示给用户。
- 旧 POST contacts/import、contacts/create|edit|delete|restore|merge|split 均返回 410；无权限仍先返回 403。
- GET call-history?deviceId=&offset=、GET call-history/missed、POST call-history/seen 保持不变。call_seen 按安装及来源设备区分，不修改 Android CallLog。

## English

Since dev13, Android system contacts are authoritative. Cards follow each device's Android aggregate Contact ID and DISPLAY_NAME_PRIMARY. There is no assistant-side number-based merging, review queue, split/recovery workflow, iPhone vCard import or name-order repair. Old assistant-only cards remain archived locally, are excluded from the public directory and name lookup, and are never automatically written into Android.

Enable local contact sharing; separately enable remote editing and grant Android permissions. The Phone installation also needs read/write capabilities and device access. An empty Android address book produces an empty web list. Import contacts into Android itself if needed.

Create selects one explicit device and creates a local Android contact. Edit/append binds the exact device and source revision; multi-account cards expose a source selector and preserve other sources. Read-only sources are blocked. Writes are idempotent, revision checked and marked atomically by ContactsProvider. A queued receipt is not success: only a done acknowledgement permits the UI to report an Android save. Closing after submission does not recall a pending job. Favorites remain a web preference; this version does not expose system-contact deletion.

The schema stays at v3. Public GET contacts returns native cards; new POST contacts/native/create|edit|favorite routes require explicit Android destination. Unexecuted legacy assistant write jobs are retired on startup; completed receipts and native jobs are preserved. Legacy assistant writes return 410, so cached old pages cannot silently modify system contacts. Existing device deltas, durable jobs, call records and missed-call view receipts are preserved.

Reference: [Android Contacts API](https://developer.android.com/reference/android/provider/ContactsContract.Contacts).
