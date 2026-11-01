# CommLink 语音接入与验收

## 当前交付边界

CommLink 通过独立的本机 Asterisk ARI 控制器保有外线，在网页和 Groundwire 之间切换用户端。SIP.js 在 iPhone 前台注册并建立 WebRTC 会话。语音默认关闭，短信、联系人和记录功能可以独立使用。代码和本地测试不能证明运营商接通、CallKit 锁屏来电或真实双向音频。

本次只读检测到主节点运行 Asterisk 20.6.0 的发行版构建，3 个 PJSIP 端点和 3 个 UDP transport。res_rtp_asterisk 已加载；res_ari、res_ari_channels、res_stasis、res_http_websocket、res_pjsip_transport_websocket 未加载。AMI 和 ICE support 显示关闭，HTTP 状态未报告启用的监听。实际 NAT 穿透、转发策略、有效公网 WSS、TURN 和授权账号需要管理员验证。没有读取或导出 PBX 密码，没有更改现网账号、拨号计划或呼叫。

**为什么没有启用网页语音。** 主机已安装 WebSocket 传输、ARI、Stasis、SRTP 和加密模块文件。现有 Asterisk 助手的 fresh-config.py 生成精简的 modules.conf，使用 autoload=no，只显式加载传统 SIP/RTP 等所需模块。网页语音相关模块运行时加载数为 0。HTTP 服务被关闭，ARI 配置段虽为 enabled=yes，实际没有提供可用接口。现有证据不要求重装 PBX，也不足以证明打开全部模块就能通话。请先在隔离环境验证依赖、受限路由、WSS 证书和媒体，再决定生产变更。AMI 不是本实现的必需条件。


主节点安装的本地网关包版本显示 0.3.5-custom.5。相邻 voice-sip-dualsim 工程的 Gradle 版本为 0.3.5-custom.3，文档和运行包不能替代匹配版本的真机验收。已核实其源代码中两条 SIP 实现接受下行 INVITE 的 X-VSA-Dial 和 X-VSA-SIM，后者接受 1 或 2，并在蜂窝端重新解析当前卡槽与 PhoneAccount。没有把 X-VSA-SIMSLOT 或未验证的返回头用于选卡。该适配一次仅允许一条设备外线，超过两槽的此版本网关不开放语音。通用设备注册仍可发现更多 SMS 线路。

## 接入条件

1. 在隔离的测试 PBX 上准备 Asterisk HTTP、ARI/Stasis、PJSIP WebSocket、RTP/ICE、DTLS-SRTP 与音频编解码器。提供可被 iPhone 信任的 WSS 地址，验证 iPhone 和语音网关双方的媒体候选。仅把 WSS 的 /ws 暴露给浏览器。ARI HTTP/WS 限于安卓主节点回环接口；不得把 ARI 代理到公网。
2. 分别为网页票据、Groundwire 和每台网关建立独立 PJSIP endpoint、AOR、认证和专用入站 context。网页 context 只处理 CommLink 的短期票据，禁止包含普通外拨路由、转接任意分机或通过 Refer 绕过票据。端点禁用任意 SIP 转移功能（包括 allow_transfer），验证客户端携带伪造标头无法直接选择网关。Groundwire 在单一账号上接收 PBX 的授权来电。既有生产分机不会被删除。
3. 从安卓主节点打开「SIP 服务 · Groundwire」。先在系统设置锁屏凭据，再验证并编辑 ARI 本机端口、账号、WSS、SIP 域、受限网页端点、Groundwire 和网关映射。每行映射包含已配对 Android 设备 ID 和 PJSIP 网关端点。只有在当前设备入站线路唯一时才填写可选的入站 line_id。多卡入站若没有可信的 DID/线路证据，保持关闭，不能靠主叫号码或默认卡推断。设置允许外拨的精确号码或受限前缀，空列表拒绝全部外拨。
4. “导出 PBX 配置草案”生成包含占位符的审阅材料，其中没有密码。需人工检查已有对象是否同名、目标 PBX 所需 TLS/网络项和支持的传输，并先应用到隔离实例。界面可生成 Groundwire 密码草案或录入已配置的密码。须在 PBX 管理器与 Groundwire 完成配套设置，保存本机密码不会重置现网账号。所有设备使用各自 SIP 网关凭据；新手机无需再运行一套 PBX。普通 Android 应用不能调用 Agent 受 DUMP 保护的 ADB provision 广播。可在安卓界面检测 Agent 并打开它，由用户完成授权、Shizuku 和音频设置。
5. Gateways 的在线来自 PBX endpoint 状态。分配前检查 CommLink 设备心跳、明确绑定的 line_id、实时 slot/subscriptionId、PBX 当前通道数量和主节点持久资源锁；兑换网页票据时再次核对授权和绑定。网页获取的只有受限网页 SIP 账号。启用 ICE 时可在主机设置 ICE server JSON；需保护 TURN 的使用范围和生存期。管理员应先用测试目的地验证受限 prefix，避免留下开放网关。

## 真实呼叫与故障行为

网页先连接 WSS，再以请求 UUID、号码、授权线路向主节点申请呼叫。同一 ID/目的地只得到同一个呼叫结果。网页随后拨内部一次性票据。仅在来自指定 PJSIP endpoint 且票据未过期时，控制器创建外线通道，在它上面设置两条选卡/拨号头，再发出一次 dial。外线提交后通信错误按未知处理，绝不重拨。浏览器只有收到 ARI 外线 Up 和桥接成功才显示 WEB_ACTIVE；这还须与实际双向声音分别验证。

手动接续和已启用的后台接续均由主节点呼叫 Groundwire，避免依赖不确定的 URL scheme。服务端持久记录原 outside、web、native 通道、设备资源、时间和接续请求 ID。只有新通道 Up 后才尝试加入原混音桥。新原生麦克风先静音，确认外线和原生两侧 RTP 收发计数都推进后，才静音网页、开原生麦克风，持久标记接续完成并释放网页通道。RTP 包递增是媒体路径证据，不能证明用户实际听到清晰声音或分辨单通。两次采样间只有静音且无 RTP 时会保守失败。用户必须在 Groundwire 接听系统来电。

可见性切换仅在用户开启自动模式后发送 keepalive 请求。后台 JS 可能被立即挂起；已知网页 SIP 通道消失时，服务器可按已保存的自动接续偏好尝试回拨。单纯的页面连接断开不会指示重新拨号。原生超时或媒体验证失败时尝试恢复网页；网页通道已丢失则有界回收外线。PBX不可达时保留锁和待清理的通道 ID，重连后查询实际通道再回收，通道上另设最长存续时间。文本记录、推送投递、原生响铃与双向音频不是同一状态。

真实蜂窝呼入由已绑定的网关进入 commlink 的 incoming Stasis 应用；在能确定来源线路时按当前联系人解析名称，呼叫已配置的 Groundwire。未获可靠 SIM 来源的多卡网关应先使用现有经验证的 PBX 路由，再在测试 PBX 中验证独立 DID 到稳定 line_id 的映射。现有呼入和旧账号不应自动切换到新规则。

## 接口和存储

电话安装通过 /api/v2/voice/status 查看语音状态。POST voice/web-session、POST calls、POST calls/{id}/handoff、POST calls/{id}/hangup 要求拨号授权。GET calls/{id}/state 按安装与线路查询，GET voice/history 返回有权查看的记录。管理员测试在本机验证锁屏凭据后，仅呼叫 Groundwire 并在应答或超时后结束，绝不测试真实手机号。电话业务由独立监听上的限流保护。

新增 commlink-voice.db v1 存储 calls、events、transfers。每个设备最多一条 active 记录，用户侧切换不会新建外线记录；不可证实属于同一通电话的 Android 系统行和 PBX 记录分别保留。原短信库没有语音迁移，语音凭据由 Android Keystore 包装并保存于 noBackupFilesDir。

## 验收清单

- 本地自动化覆盖绑定交叉和换卡、授权号码、真实 OkHttp 请求的 ARI 路径与错误、RTP 双向门控、先持久化后释放网页及恢复分支。接入者需执行工程的 testDebugUnitTest 和前端测试。现网只读探测未产生呼叫。
- 上线前在隔离 PBX 测试重复分配、票据重放、撤销授权、错误端点、无效卡槽、两台网关同槽、网关已忙、呼叫取消、拒接、原生超时、单向 RTP、重连、应用重启和跨安装越权。故障后核对同一外线通道最多一次 dial，恢复期间设备一直被占用。
- 需后续真机验证新账号的 Groundwire 原生和锁屏响铃、CallKit 应答、Caller ID 中文、内外网双向音频、Wi-Fi/热点/VPN、WebRTC 和 Groundwire 交接是否保有同一条 SIM 外线。仅在具备明确授权时测试真实号码；本次未执行这些测试。

参考：[Asterisk WebRTC](https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/)、[ARI Channels](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Asterisk_REST_Interface/Channels_REST_API/)、[Acrobits 来电接续流程](https://doc.acrobits.net/server-components/sipis/incoming-calls/)。
