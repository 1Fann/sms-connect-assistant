# 0.7.4 后台恢复 / Background recovery

0.7.2 修复了独立检查进程退出后无人恢复，以及升级 APK 后旧哈希让守护永久退出的问题。0.7.3 缩短首次故障后的固定等待，保留连续故障退避。应用界面、配对、证书、短信内容和发送队列不变。

- Magisk 启动独立监护脚本；用 BusyBox `flock` 防止重复监护，锁会随进程退出释放，旧 PID 文件不会阻止下次启动。
- 0.7.4 中检查进程首次退出立即重建，连续短期退出再按 1、2、4 秒递增重试，最多等待 5 分钟；稳定运行 5 分钟后重置间隔。每次仍校验 APK，检查进程自身启动也需要时间。停用 Root 守护后停止监护及检查进程。
- 检查进程每约 1 秒读取缓存 PID 的 `/proc` 启动身份，正常时不反复运行 `pidof`；PID 被复用或进程变为僵尸不会误报存活。已观察到原进程退出、且新的精确包名查询确认没有替代进程时，当轮即可请求恢复，省去重复等待 1 秒和连接已退出服务；首次发现未知状态仍要求两次缺失确认。保留每小时 3 次、至少间隔 60 秒限制及恢复前重读开关。
- 完整 HTTPS 检测仍按用户设置的分钟间隔执行；第一次发现进程缺失会额外确认一次，异常时每 10 秒复检，发出恢复请求后约 2 秒确认一次。没有改成每秒 TLS 请求或每秒重启服务。
- 等待系统启动的检查改为约 1 秒；等待应用状态或首次解锁的前 2 分钟按 1 秒检查，随后放缓至 5 秒，不访问未解锁的私密数据。
- 监护仅执行已记录 SHA-256 的 APK。APK 不一致时等待应用刷新，不会直接信任变化后的文件。
- 在 0.7.2 或以上显式启用过 Root 守护后，后续应用启动（包括系统允许的开机/更新启动）会刷新已授权的运行文件；已停用的守护不会被重新启用。**从 0.7.1 或更早版本升级后须点一次「启用 / 更新 Root 守护」**，建立此授权状态。
- 本机 HTTPS 探测增加总截止时间，避免缓慢响应无限延长检查。诊断文件写入失败不会再直接结束检查进程。
- 手动关闭公网服务或自动检查仍优先于恢复，恢复仍每小时最多 3 次，不会通过重发短信测试链路。

## 边界与验收

守护可以等待首次解锁；没有迁移短信、证书、配对或令牌到解锁前可访问的存储。需要这些私密数据的 HTTPS 短信功能仍要在首次解锁后恢复。常规锁屏不等于重启后的首次解锁状态。

保留原有 HTTPS 服务唤醒锁策略，未新增永久 Root 唤醒锁；CPU 深度休眠时，独立脚本的等待和检查可能延后。守护整个进程树被终止、系统故障、外网或 iPhone 推送故障仍不保证自动恢复。`/healthz` 只验证本机 HTTPS，不等同短信实际送达。

本地测试：

```sh
python tests/root_supervisor_test.py
./gradlew :app:testDebugUnitTest :app:assembleRelease
```

已由用户授权的 Root 部署也可以通过原有非导出服务刷新**当前已启用**的守护，无需改动私有偏好文件或打开配置页面：

```sh
am start-foreground-service --user 0 -n me.capcom.smsgateway.iphone/me.capcom.smsgateway.modules.iphone.IphoneService -a me.capcom.smsgateway.iphone.REFRESH_ROOT_GUARD
```

这条命令须在 Root 环境执行；如果没有已启用的本项目守护，只记录未启用，不创建新的开机守护或改变服务开关。

Windows 如没有 `sh`，测试支持 `--shell <sh.exe>`。脚本测试替换 Android 命令，覆盖检查进程崩溃、退避、手动停用、开机等待和哈希不匹配；不覆盖 Android 内核文件锁与实际电话/短信链路。真机还需验证重复启动仅一套进程、杀掉检查进程后恢复、关闭守护不复活、APK 升级刷新、重启未解锁及解锁后恢复、拔电息屏过夜。

已在用户 Redmi 上用临时目录和模拟检查进程验证实际 Magisk BusyBox 文件锁：运行时第二实例取锁失败；模拟检查进程没有继承锁描述符；只终止监护进程、保留模拟检查进程后可以重新取锁。Android `mksh` 不向外部 `flock` 保留编号描述符，因此入口先切换到 Magisk BusyBox `ash`。该隔离验证没有启动/停止生产短信服务，也没有发送短信。

## English

Version 0.7.4 restarts the checker immediately after its first exit; repeated short failures retain exponential backoff. An observed cached-process death plus a fresh exact-package lookup with no replacement can recover on that one-second tick, without another sample or a redundant connection attempt to the dead service. Initial unknown process state still needs confirmation. Full HTTPS checks retain their configured cadence. Service recovery still respects manual stop, a 60-second cooldown, and the three-per-hour cap. Signature/hash verification, first-unlock handling and enabled-guard refresh remain in effect.

Private credentials, certificates, pairing state, SMS data and the send queue remain unchanged. Recovery waits for credential-encrypted storage after first unlock; this is not full Direct Boot support. Existing wake-lock behavior is unchanged, so CPU suspend may delay the root loop. Local health is not proof of public reachability or message delivery. Run the offline supervisor tests and Android tests above; device restart, deep sleep and end-to-end delivery remain separate acceptance checks.

## 2026-10-31 Redmi / MIUI 14 device verification (0.7.2)

Installed same-signature updates on one Redmi Note 10 Pro running Android 13, MIUI 14 and Magisk. Existing application data and monitor settings were retained. The device currently has no secure lock-screen credential; no lock-screen setting was changed.

真实息屏测试中，分别结束五项套件的检测工作进程，均自动恢复：Voice SIP 15.3 秒、Asterisk 6.8 秒、Bark 11.2 秒、短信互联 11.1 秒、DDNS 28.6 秒。这里只结束检测工作进程，没有用结束真实通话或发送短信来测试。

整机重启一次，全程没有手动解锁或打开应用；约 67 秒后，所需前台服务和重启后的新检测记录齐备。随后确认网关 SIP 注册、Shizuku 连接、音频就绪、本机短信 HTTPS、Bark ping 及 DDNS 本机健康正常。DDNS 配置和原偏好摘要保持一致。

随后强制进入深度 Doze 75 秒，Voice SIP、Asterisk、短信互联和 Bark 的检测记录均在此期间更新，电话检查状态正常。已退出强制 Doze，恢复正常电源策略。

These are service-readiness tests, not new end-to-end cellular calls, actual SMS delivery, APNs delivery, or an overnight battery-powered suspend test. No automatic real calls or messages were sent. Unattended boot on this device does not establish Direct Boot support before first credential unlock on a password-protected device. Existing wake-lock preferences were preserved; no global battery policy was disabled.

## 2026-10-31 recovery-speed follow-up

The second pass removes fixed first-failure waits, adds inexpensive cached-process checks, and keeps backoff for repeated failures. Full network checks retain their configured cadence. These measurements replace neither the original baseline above nor its stated limitations.

| Component | Checker replacement (s) | Actual local service ready after process kill (s) |
|---|---:|---:|
| voice | 0.3 | 13.16 |
| asterisk | 0.2 | 11.77 |
| sms | 1.9 | 2.69 |
| bark | 1.4 | 1.48 |
| ddns | 2.1 | 1.41 |

Phone readiness required SIP registration plus the gateway’s connected Shizuku and ready audio flags; PBX readiness required the engine and gateway registration. SMS, Bark and DDNS required successful local HTTP(S) responses, with the configured Host header retained for SMS. No real call, SMS or push notification was generated. Measurements include polling overhead and are not upper bounds for network faults or repeated failures.

In the final unattended reboot, Android reported boot completion at 36.8 seconds; all five service checks were simultaneously ready by 69.39 seconds. These timings include the operating-system restart and polling overhead; the initial 67-second baseline above used foreground-service presence and fresh monitor records, so it is not the same measurement.

The unattended reboot phase measurements and final installed artifact hashes are recorded in `D:/CodeX/HELP/reliability-20261031/speed-verification.json`. No unlock input or app-launch request was sent by that test. The device had no secure screen-lock credential before testing; no lock-screen setting was changed.

<!-- recovery-target-20261031:start -->
## 2026-10-31 恢复目标实机复测

红米 Note 10 Pro / MIUI 14，接电、息屏、ADB 连接，沿用现有唤醒设置。每次终止单个进程前均确认蜂窝与 PBX 空闲。

- 守护工作进程（短信互联）：0.84, 0.88 s（范围 0.84–0.88 s）。
- 短信互联业务进程退出至本地就绪：3.00, 2.61 s（范围 2.61–3.00 s）。整机重启后该项首次观测就绪：53.91 s。

重启各时间均从同一次重启请求起算。全部六项首次齐备 61.97 s，稳定确认 66.12 s；无安全锁屏凭据，观察者未输入解锁、未主动启动界面或服务。强制深度休眠 77.66 s，4 次抽查六项服务与五个工作进程均正常，结束后已解除强制状态。

数值为本机含探测开销的首次观测，不是普适上限。守护与业务分别连续抽样确认至少 1 秒和 3 秒。电话就绪检查含网关状态及匹配的 PBX 注册记录；本次未拨打真实电话、发送短信或通知，也未验证外网送达或双向通话音频。
<!-- recovery-target-20261031:end -->
