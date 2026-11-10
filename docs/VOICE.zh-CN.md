# Groundwire 原生通话

当前从 0.9.0-dev6（29）起，互联电话只提供通讯录、通话记录与拨号入口。点击拨号使用 Groundwire 官方的 Call URI：`groundwire:前缀号码?dialAction=voiceCall`。网页不申请麦克风，不注册 SIP，不运行 WebRTC，不做网页到原生的接续；Android 不再运行 ARI 通话控制器。切到后台时通话仍属于 Groundwire，无需再接听一通接续来电。

## 配置与拨号

1. 在 Groundwire 中登录自己的 Asterisk SIP 账号并开启原生来电推送。服务器、端口、UDP/TCP/TLS 与密码以实际 PBX 为准，不使用电话网页的 HTTPS 地址。推荐只保留一个 Groundwire 客户端账号（示例为 `1001`）；网页拨号时它应属于目标 PBX。多个设备和 SIM 通过路由前缀区分，无需每张 SIM 一个客户端账号。
2. 在 PBX 已认证的原生账号 context 中引入明确的设备/SIM 路由。参考 [原生路由模板](../ops/asterisk/groundwire.conf.example)。示例前缀 `*81*`、`*82*` 分别选同一网关的 SIM 1、SIM 2，不能原样套用到多个网关。
3. 在安卓「SIP 服务 · Groundwire → 管理 Groundwire 账号和线路」通过锁屏验证，填写 SIP 服务器、账号以及路线映射。每行依次是稳定线路 ID、设备 ID、卡槽、订阅 ID、拨号前缀。前缀必须与 PBX 配置一致。应用保存设置不会替用户改 PBX。
4. iPhone 网页选择设备/SIM，输入号码，点击拨号。iOS 可能要求确认打开 Groundwire；后续媒体、通话控制和锁屏由 Groundwire 处理。网页仅显示已请求打开应用，不将此状态当作接通。
5. 在安卓允许通话记录访问并开启共享。通话结束后，回网页的「通话」页查看同步记录。只有真正生成安卓通话记录的呼叫会按此路径同步；纯 SIP 内线或在到达安卓之前失败的呼叫，不保证有安卓记录。

官方 Call URI 未提供可依赖的账号选择参数，因此不猜测 account 参数，也不依赖 Groundwire 当前默认账号来选择 SIM。示例 PBX 在认证客户端账号 `1001` 后解析前缀，向 VSA 网关 2001 添加 X-VSA-Dial / X-VSA-SIM。当前部署中，Groundwire 无前缀直接拨号默认使用主设备 SIM 1；选择其他 SIM 应从网页选择线路，或使用对应前缀。蜂窝来电仍呼叫 `1001`。其他设备必须配置独立前缀及目标网关，不能退回主机或另一张 SIM。

## 授权与兼容

GET /api/v2/groundwire/routes 需要电话配对、calls.dial 及对应设备授权。只返回与当前稳定线路、设备、卡槽和订阅完全匹配的可用映射；离线、换卡、待确认或未配置的线路不提供拨号链接。链接不含 SIP 密码。Groundwire 自身的拨号权限由 PBX 的 SIP 账号控制，撤销网页配对不会同时注销该原生账号。

保留 /api/v2/call-history 和只读 /api/v2/voice/history。旧的 commlink-voice.db 仅作为历史档案读取，不再创建或调度通话。原浏览器 calls、handoff、resume、web-session 返回 410，/ws 不再存在。电话页面通过 Permissions-Policy 禁用麦克风和摄像头。只更新电话 Worker 缓存，不撤销配对，不清除短信缓存或历史。

## 从旧网页语音迁移

先确认没有活动通话并备份私有 PBX 配置。保留 Groundwire、VSA、Asterisk 的原生端点和入站规则，撤下旧 cl-web 端点、WS transport、Stasis 路由、ARI 账号及仅为网页添加的 HTTP/ARI 模块设置。不要直接恢复整个旧 pjsip.conf 或 extensions.conf，以免丢失后来修改的原生配置。

现用红米的原生示例路由是 *81* → 2001/SIM 1、*82* → 2001/SIM 2；仅保留客户端账号 `1001`，由明确前缀选择 SIM。新增设备不会自动套用这两条路由。网站和主屏幕图标仍为原 8443 信息入口与 8444/phone/ 电话入口。

验证应覆盖两张 SIM、国际前缀、呼入、Groundwire 切后台、安卓记录同步、换卡/撤权阻止链接，以及旧网页接口失效。自动检查不得拨打真实外线；真实 iPhone 唤起与声音需用户验收。

参考：[Call URIs](https://doc.acrobits.net/cloudsoftphone/call-uris/)、[Dial Actions](https://doc.acrobits.net/cloudsoftphone/dialactions/)。

## 单账号部署整理

当前部署已移除 `1002` 的 endpoint、认证、AOR 和拨号授权，保留 `1001`。主设备 SIM 1/2 使用 `*81*`/`*82*`，从设备 SIM 1/2 使用 `*83*`/`*84*`；后两条是部署配置，不包含在单网关示例模板中。移除账号前应备份私有配置并确认没有活动通话。Groundwire 中本地保存的旧账号需由用户删除，服务端删除不会同步清除 iPhone 的账号条目。这是 PBX 配置调整，不需要重新安装 CommLink APK。

## 呼出号码显示

原生呼出规则在号码校验后，将 `CONNECTEDLINE` 号码设为去掉线路前缀后的目标号码，并清空内部显示名称；`Dial` 使用 `I` 选项，防止语音网关的内部身份覆盖该号码。不要把 Gosub 的入口 `s` 或网关分机号当作真实被叫号码。主设备两条线路、从设备两条线路和旧的无前缀主设备拨号路径均需采用同样处理。

第二网关可参考 [从设备路由模板](../ops/asterisk/groundwire-peer.conf.example)。部署时在认证客户端 context 中引入路由，并包含主模板的 `commlink-native-header` 子流程；网关账号和前缀需按实际配置匹配。

机制参考：[Asterisk CONNECTEDLINE](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Dialplan_Functions/CONNECTEDLINE/)、[Dial 的 I 选项](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Dialplan_Applications/Dial/)。此修复属于 PBX 拨号规则，无需重装 APK。

[来电设备与卡名称 / Incoming line aliases](releases/0.9.8.md)
