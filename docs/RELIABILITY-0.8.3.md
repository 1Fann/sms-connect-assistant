# 0.8.3 可靠性验证 / Reliability validation

构建阶段进行了本地代码、SQLite 故障模拟和构建验证，没有拨打电话或发送短信。后续实机检查单独记录在本文末尾。

- Android 单元测试 142 项通过，包括并发替换任务只提交一次、持久 claim 后中断、modem 回复丢失后不重发、取消任务不提交，以及共享 offered 未获确认时保留重交接资格。
- 7 项 Python SQLite 测试直接提取生产 SQL，覆盖旧请求迁移保守处理、持久提交标记的并发唯一性与重开连接、共享响应丢失及重复确认、旧任务不自动重投、150 条待查记录公平轮转、共享推送事件去重及持久接收确认。
- 前端 36 项测试通过，包含已接受任务转为未知、真实送达后不被旧结果覆盖。前端资源重新构建并随 APK 打包。
- 私有库 iphone.db 从版本 5 升级至 6，共享库 paired-phone.db 从 1 升级至 2。保留原记录，新增请求代际、提交标记、接收确认和推送事件；不支持数据库迁移后的覆盖降级。

需要实机继续验收的项目包括真实短信交接与送达回执、Android WorkManager 推送入队，以及共享手机进程退出和整机重启后的恢复。服务器手机的单次重启结果记录于下文。无 Root 的共享机仍受后台启动及周期任务限制。持久提交标记提供的是不盲目重复提交保障，不能同时保证崩溃窗口内一定发送成功；结果不明时保留未知，需人工核实。

旧客户端继续兼容，但新协议只有升级后的共享端才会声明。原有 handed/unknown 任务及旧 generation 1 去重记录不会被自动重新发送。共享推送按至少一次入队处理；极端的入队成功但本地事件删除前崩溃可能重新提醒，通知使用既有合并标识，不包含短信内容。

The build stage used host tests and builds only, with no calls or real SMS transmissions. Device follow-up is recorded separately below. All 142 Android unit tests, 7 production-SQL fault fixtures, and 36 frontend tests passed. The fixtures cover concurrent/crash-safe submission claims, legacy migration, lost handoff replies, repeated receipts, fair delivery polling and persistent push events. Web assets were rebuilt for inclusion in the APK.

The private databases migrate from iphone.db version 5 to 6 and paired-phone.db version 1 to 2, preserving existing records. In-place downgrade is unsupported. Device validation is still required for real SMS handoff and delivery callbacks, Android WorkManager push persistence, and sharing-phone process and reboot recovery. The single server-phone reboot result is recorded below. A non-root sharing phone remains subject to Android background restrictions. At-most-once modem submission can leave an ambiguous request unsent after a crash; unknown outcomes require verification instead of blind resending.

Legacy clients retain their previous protocol, and legacy ambiguous jobs are not automatically replayed. Shared-message push enqueue is at least once. A crash after WorkManager commits but before deleting the local event can repeat a generic notification; the existing notification tag coalesces alerts, and no SMS content is sent in the push.

## 2026-11-01 实机后续验证 / Device follow-up

两部手机均已覆盖安装同签名 0.8.3，安装文件哈希与已验证构建一致，所需权限完整。通过 API 确认四条 SIM 线路在线、两机历史短信合计 166 条可读取。

红米在插电、黑屏条件下分别进行了一次独立故障试验：RootMonitor 被 KILL 后恢复用时 0.83 秒；短信业务进程被 KILL 后，本机 HTTPS 与前台服务首次同时就绪用时 2.38 秒，随后继续稳定观察 3 秒。计时包含设备观测开销，是单次样本，不是所有设备或所有故障的恢复上限。

本轮没有发送真实短信或推送，以上安装、API 和恢复检查不证明运营商短信或 iPhone 推送实际送达。

红米服务器手机已完成一次无人干预的整机重启。设备 `deviceSecure=false`，观察者没有输入解锁、启动 Activity 或发送启动服务命令。从重启请求开始计时，系统完成启动为 37.53 秒，用户空间自动解锁为 37.84 秒，短信 HTTPS 首次就绪为 56.05 秒，全套服务首次就绪为 62.06 秒，并于 66.08 秒完成稳定确认（持续观察 4.02 秒）。这些时间包含系统启动和查询开销，验证的是本机接口及服务状态，不是实际短信或推送送达。小米共享手机没有重启，本记录不能视为两机重启验收。数据来源为 `reliability-20261031/private/full-retest-20261101-084900/reboot.json`。

Both phones were updated to the same-signature 0.8.3 APK. Installed file hashes matched the verified build, and required permissions were present. API checks confirmed four online SIM lines and 166 readable history records across the pair.

On the plugged-in Redmi with its screen off, two separate single-sample fault tests measured 0.83 seconds to recover after killing RootMonitor, and 2.38 seconds to first observe both local HTTPS and foreground-service readiness after killing the SMS business process. Readiness then remained stable during a further three seconds of observation. These timings include device-observation overhead and are individual observations, not universal recovery bounds.

No real SMS or push was sent in this round. Installation, API access and process recovery do not establish carrier or iPhone notification delivery.

The Redmi server phone completed one unattended reboot with `deviceSecure=false`. The observer issued no unlock, Activity-launch or service-start commands. Measured from the reboot request, system boot completed at 37.53 seconds, the user was automatically unlocked at 37.84 seconds, SMS HTTPS was first ready at 56.05 seconds, all services were first ready at 62.06 seconds, and stability was confirmed at 66.08 seconds after 4.02 seconds of continued observation. Timings include operating-system startup and query overhead. Checks cover local interfaces and service state, not actual SMS or push delivery. The Xiaomi sharing phone was not rebooted, so this is not a two-phone reboot acceptance result. Evidence: `reliability-20261031/private/full-retest-20261101-084900/reboot.json`.
