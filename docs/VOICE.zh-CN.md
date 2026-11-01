# CommLink 语音接入与验收

## 当前交付边界

CommLink 通过独立的本机 Asterisk ARI 控制器保有外线，在网页和 Groundwire 之间切换用户端。SIP.js 在 iPhone 前台注册并建立 WebRTC 会话。语音默认关闭，短信、联系人和记录功能可以独立使用。代码和本地测试不能证明运营商接通、CallKit 锁屏来电或真实双向音频。

部署前的只读检测曾发现主节点运行 Asterisk 20.6.0 的发行版构建，3 个 PJSIP 端点和 3 个 UDP transport。res_rtp_asterisk 已加载；res_ari、res_ari_channels、res_stasis、res_http_websocket、res_pjsip_transport_websocket 未加载。AMI 和 ICE support 显示关闭，HTTP 状态未报告启用的监听。实际 NAT 穿透、转发策略、有效公网 WSS、TURN 和授权账号需要管理员验证。没有读取或导出 PBX 密码，没有更改现网账号、拨号计划或呼叫。

**为什么没有启用网页语音。** 主机已安装 WebSocket 传输、ARI、Stasis、SRTP 和加密模块文件。现有 Asterisk 助手的 fresh-config.py 生成精简的 modules.conf，使用 autoload=no，只显式加载传统 SIP/RTP 等所需模块。网页语音相关模块运行时加载数为 0。HTTP 服务被关闭，ARI 配置段虽为 enabled=yes，实际没有提供可用接口。现有证据不要求重装 PBX，也不足以证明打开全部模块就能通话。请先在隔离环境验证依赖、受限路由、WSS 证书和媒体，再决定生产变更。AMI 不是本实现的必需条件。


主节点安装的本地网关包版本显示 0.3.5-custom.5。相邻 voice-sip-dualsim 工程的 Gradle 版本为 0.3.5-custom.3，文档和运行包不能替代匹配版本的真机验收。已核实其源代码中两条 SIP 实现接受下行 INVITE 的 X-VSA-Dial 和 X-VSA-SIM，后者接受 1 或 2，并在蜂窝端重新解析当前卡槽与 PhoneAccount。没有把 X-VSA-SIMSLOT 或未验证的返回头用于选卡。该适配一次仅允许一条设备外线，超过两槽的此版本网关不开放语音。通用设备注册仍可发现更多 SMS 线路。

## 2026-11-02 部署更新

用户随后授权部署，主节点现已运行 0.9.0-dev2，网页语音模块已启用。上面的缺模块状态是部署前记录。ARI 仅在回环监听，电话 HTTPS 8444 的 /ws 提供受安装授权和 Origin 检查保护的 SIP 代理。复用既有网关与 Groundwire，原蜂窝呼入路线保留。注册、注销及真实 TLS 代理授权检查通过；真实外线、音频和接续仍待验收。详见[部署记录](COMMLINK-UPGRADE.md)。

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


## 呼出卡在等待：ARI holding bridge 依赖（2026-11-02 修复）

实机出现“注册在线、ARI 接受 dial，但安卓未呼出”。持久通话状态停在 DIALING 后超时，Asterisk 同时记录 “Could not create class stasis. No technology to support it.”。已加载的 bridge_simple、bridge_softmix 不能替代 bridge_holding。Asterisk 20 的 ARI create/dial 在真正调用通道之前，会把它放入内部 holding dial_bridge；缺少该技术时异步执行失败，即使 dial HTTP 已返回 204，也没有向网关发出 INVITE。

已在主节点即时加载 bridge_holding.so，并将 load=bridge_holding.so 写入现有 modules.conf，保留原账户、拨号计划和应用数据，无需重装 Asterisk 或 Android App。原配置的备份位于设备 root 私有目录。部署清单还应明确保留 bridge_simple、bridge_softmix、res_timing_timerfd、res_rtp_asterisk 和对应编解码器。

新增 verification/ari_loopback_dial.py，使用独立的临时 ARI 事件应用，以及只指向 127.0.0.1 临时 UDP 端口的合成 SIP 端点，验证真实 Asterisk 的 create → 设置号码/SIM 头 → dial 路径。不会选择已注册的网关、Groundwire 或真实电话。缺模块时稳定复现 HTTP 接受但 INVITE 不到达；加载后 INVITE 到达且两条选卡/拨号头正确。合成端点返回忙线，测试结束移除临时通道、端点和事件连接。检查开始前要求 PBX 无活跃通道。

该脚本使用 PBX 内的私有凭据文件，字段为 port、ariUser、ariPassword。必须在主节点 chroot 内以管理员身份运行，不能将凭据文件放入源码。正常验证命令为：
    python3 /opt/asterisk-app/ari_loopback_dial.py --credentials-file <PBX内部私有配置路径>
只有复现已知缺模块状态才使用 --expect-no-invite。这个检查验证呼出信令链路，不代表真实蜂窝接通、WebRTC 双向媒体或 Groundwire 接续已验收。

模块 loading 与错误依据：[Asterisk 20.6 control.c](https://github.com/asterisk/asterisk/blob/20.6.0/res/stasis/control.c)，见 get_dial_bridge 与 app_control_dial。


## WebRTC 无声与麦克风处理（0.9.0-dev3 / 26）

用户确认网页能够呼出后，真实测试显示：安卓网关收到的 RTP 包持续增长，而网页端收发均为零。独立浏览器回声测试也复现 ICE checking / DTLS new，尚无加密媒体连接。

根因是 WebSocket 虚拟 transport 的 bind=127.0.0.1。Asterisk 20.6 的 create_rtp 会将 transport 的地址用于 RTP 套接字；只打开 rtp_ipv6 不会改变这一绑定。信令代理的回环地址因此被错误沿用为媒体绑定，提供的 ICE 候选无法完成有效连接。已将虚拟 WS transport 改为 bind=[::]，HTTP / ARI 仍只绑定 127.0.0.1:8088，浏览器仍通过受授权保护的 HTTPS /ws 代理访问。实测未新增 TCP 5060 监听，也没有把 ARI 暴露到公网。该方式不依赖写死的家庭 IPv6 地址。

修复后，实际浏览器通过生产 HTTPS/WSS 入口连接内部 Echo，ICE、DTLS 和 peer connection 均 connected，约十秒内收到和发出音频包分别为 504；没有调用外线分配 API。随后用户在 iPhone 主屏幕应用确认能听到回声，并再次确认真实蜂窝测试双方都能听见。当前验收范围为该家庭 Wi-Fi、未开启 VPN 的场景；外网、VPN、锁屏及 Groundwire 接续不能由此推定通过。

新版加入「设置 → 通话音频测试」，仅拨主节点的 cl-audio-test 内部扩展，使用 Echo 且服务端最长 30 秒，结束释放麦克风。该扩展没有外线拨号指令。网页拨号时先从用户点击申请一次音频流，同一通话的 SDP 处理复用该流；晚到的权限结果会在取消后关闭。增加播放重试按钮、媒体连接/包计数提示，以及相应资源释放测试。39 项前端测试、152 项 JVM 测试与签名发布构建通过；临时诊断安装授权和浏览器进程已移除，SIP history 已关闭并清空。

主屏幕 PWA 重新启动后的麦克风询问仍受 iOS/WebKit 控制，不能由安卓、PBX 或网页永久授权；Safari 单站允许不保证继承到主屏幕应用。已更正界面说明，不以通话结束后保持采集的方式伪装永久授权。对应 [WebKit 327237](https://bugs.webkit.org/show_bug.cgi?id=327237) 是主屏幕应用跨启动权限的公开问题报告，不代表每个系统版本或本设备的所有权限行为均已验证。

源码依据：[Asterisk 20.6 create_rtp](https://github.com/asterisk/asterisk/blob/20.6.0/res/res_pjsip_sdp_rtp.c)。
