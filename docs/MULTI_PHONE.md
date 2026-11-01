# 多设备通讯－配对与共享 / Multi-device pairing and sharing

## 中文

一部 Android 主节点运行 HTTPS 服务。其他 Android 手机主动连接主节点，共享已授权的数据与本机 SIM；它们不需要部署第二套 HTTPS 服务或 PBX。普通短信共享不依赖 Root。语音需要独立验证本机 Voice SIP Agent、蜂窝桥接及主节点 PBX。

1. 在主节点开启原 HTTPS 服务，保留已有证书和 iPhone 配对，在「多设备通讯－配对与共享」生成一次性接入码。每次生成会替换之前尚未完成的邀请。
2. 在新节点输入主节点域名和接入码，按需启用短信和发送权限。联系人、写回、通话记录在单独的授权页设置。回到主节点审批请求。自报设备型号仅用于辅助辨认。
3. 对每台设备分别审批。列表使用独立设备身份，设备在线时可看到可用线路。共享节点无需对外开放入站端口。实际后台可靠性取决于系统策略和连接情况。
4. 在主节点线路管理中可以将线路设为默认、移至首位、停用、启用，并在设备／线路名称设置里修改备注。iPhone 显示逻辑线路；请在发送前核对设备和 SIM。失效的已选线路不会自动换成另一张。
5. 检测到换卡、槽位移动或已消失的订阅重新出现时，原绑定可能暂停。核对实际 SIM 后再确认。若同一张实体 SIM 移到另一台设备，原设备必须先报告旧卡已移出；核对新位置，在新线路上选择关联旧线路。Android 的槽位和订阅 ID 本身不能证明跨设备卡片身份。
6. 「停止共享」会停止子节点连接。主节点可单独撤销某个设备，其凭据立即失效。共享短信历史与幂等记录保留在主节点。重新接入需要新邀请和审批；升级客户端可凭旧身份材料和新凭据恢复原设备身份。卸载或清除应用数据丢失身份材料后，应作为新设备审批。

### 兼容与持久化

- 继续使用原 Android 应用 ID、签名和数据库文件。已有 v1/v2 共享节点的凭据摘要、历史、线路别名、发送阶段和待推送事件迁入 `paired-phone.db` v3。不要卸载或清库。
- 原本机槽位 1–4 和旧共享设备 101–104 保留兼容别名，原 `xia:` 消息身份不变。新节点由主节点分配 UUID，其历史按 `(设备身份, 系统记录 ID)` 去重，分页使用独立的主节点顺序号。
- v3 同步复用原 HTTPS 心跳，提供设备能力和实际选卡字段；旧客户端继续收到其旧格式。每个任务、状态查询、接收确认和推送事件绑定到已认证设备。给 A 的任务不能由 B 领取、确认或完成。
- 每条业务线路有独立 UUID，数字别名供旧版界面及历史显示。本机和升级共享端的新任务在入队前保存所选订阅。执行时使用匹配的订阅创建 SmsManager。结果未知的请求必须先核实，不会因重连新建发送请求。
- 旧版共享端不具备客户端新增的最终选卡校验。涉及热拔插或大量线路，先升级对应子节点。系统若以完全相同的槽位和订阅 ID 替换实体卡且未报告过中断，普通应用无法据此可靠识别卡片。

## English

One Android phone hosts HTTPS. Additional Android peers connect outbound and share only the features enabled on them. A peer does not need its own HTTPS server or PBX. Cellular voice still needs its own validated gateway on that phone.

1. Keep the existing HTTPS setup on the host. Generate a one-time invitation in multi-device pairing. A new invitation replaces the previous pending one.
2. Enter the host and invitation on the new phone. Enable SMS sharing if desired, and grant contacts, write-back or call-log access separately. Confirm the request on the host. Repeat for each device.
3. Select a named device and line on iPhone. The host can choose a default, change order, disable a line or confirm a changed subscription. An unavailable saved selection cannot silently route to another SIM.
4. Confirm the physical SIM after a change. To retain a logical line when moving a card between devices, the old phone must report its absence. Choose the old identity on the new line and confirm the binding on Android.
5. Revoke peers individually. Revocation blocks their credentials while keeping SMS history and submission journals on the host. A new client can restore its device identity with the old identity material, a new credential, a fresh invitation and host approval.

The non-destructive database upgrade from v2 preserves old numeric aliases, `xia:` IDs, in-flight delivery phases and notifications. New histories, receipts and jobs are scoped to their authenticated device. The v3 protocol adds explicit physical slots and capabilities while preserving v1/v2 message exchange. New clients bind sends to the selected subscription through modem submission; upgrade legacy peers before relying on protection against SIM changes. Radio delivery, swap detection and background behavior still require tests on each target phone.
