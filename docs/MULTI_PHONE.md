# 双手机短信共享 / Two-phone SMS sharing

## 中文

手机按角色区分，不按品牌区分。任意两部满足应用要求的安卓手机均可组成一对，当前支持一部服务器手机接入一部共享手机。两部手机安装同一 APK；普通共享不要求 Root。具体系统的短信权限、后台运行限制和网络可达性仍需验证。

1. 选择一部作为**服务器手机**，按安装说明配置域名、可信 HTTPS 证书并开启服务。iPhone 与这部手机配对。
2. 在服务器手机的「多手机短信 · 配对与共享」页面生成接入码。
3. 在另一部**共享手机**打开同一页面，输入服务器手机的域名及接入码。授予短信与 SIM 权限后连接。共享手机无需另配证书或开放入站端口，但必须能访问服务器。
4. 在两部手机上允许后台运行，并按各自系统设置自启动和电池策略。
5. 刷新 iPhone 页面。短信来源和发送线路显示为「服务器手机 · 卡 1/2」或「共享手机 · 卡 1/2」。发送前检查所选手机与 SIM；共享手机离线时，对应线路不可用，不会自动改用另一部手机发送。

两部手机可以来自相同或不同品牌。角色由配置决定；已经开启服务器模式的手机不能同时作为共享客户端。已有配对、短信标识和缓存可在 0.8.1 覆盖升级时继续使用。系统可能在覆盖安装后撤回权限，请核对短信、SIM 和后台权限。

「停止共享」停止共享手机的连接；服务器手机上的「解除接入并删除共享手机缓存」撤销授权并移除服务器缓存，不删除两部手机的原始短信。当前的双手机验证未发送真实测试短信，也不代表所有品牌和长期息屏情况均已验收。

### 自定义名称（0.8.2）

在 iPhone 的「设置 → 手机与 SIM 名称」中，分别填写两部手机及各张 SIM 卡的名称并点「保存」，例如「家中手机 · 工作卡」。名称最多 30 个字符，清空后保存恢复默认名称。共享手机离线时也可修改已缓存线路的名称。

名称保存在服务器手机上，其他已配对的 iPhone 刷新后也会显示；不会更改安卓系统中的设备名称或运营商名称。短信来源、详情及发送线路同步使用这些名称，实际收发绑定的设备和卡槽不变。解除共享手机配对时，会一并清除该共享手机及其 SIM 卡的别名。

## English

Phones are identified by role, not brand. Any two Android phones meeting the application's requirements can form a pair. Currently, one server phone supports one sharing phone. Both use the same APK; ordinary sharing does not require Root. SMS permissions, background restrictions and network reachability still need validation on each system.

1. Choose a **server phone**, configure its domain and trusted HTTPS certificate, and enable the server following the installation guide. Pair the iPhone with this phone.
2. Generate an invitation code from the server phone's multi-phone sharing page.
3. Open the same page on the **sharing phone**, enter the server's domain and invitation code, grant SMS and SIM permissions, and connect. The sharing phone needs outbound access to the server, but no separate certificate or inbound port.
4. Allow background operation on both phones and configure their system-specific autostart and battery settings.
5. Refresh the iPhone page. Message sources and sending lines use the server/sharing roles and physical SIM slots. Check the selected phone and SIM before sending. An offline sharing phone's lines are unavailable; sending never automatically falls back to the other phone.

The phones may have the same or different brands. Configuration determines the role; an enabled server cannot simultaneously act as a sharing client. Updating to 0.8.1 preserves existing pairings, message identities and cached history. Some systems revoke permissions on replacement installs, so recheck SMS, SIM and background permissions afterward.

Stopping sharing disconnects the sharing phone. Revoking the peer on the server also removes its cached shared history, while preserving both phones' original SMS records. Current two-phone verification did not send a real test SMS and does not establish compatibility with every brand or prolonged screen-off operation.

### Custom names (0.8.2)

In the iPhone settings, open the phone and SIM naming section, edit each name, and press Save. Names support up to 30 characters; saving an empty name restores the default. Cached sharing-phone lines can be renamed while offline. Aliases are stored on the server phone and appear on other paired iPhones after refresh. They do not rename the Android device or carrier. Message sources, details, and sending selectors use these aliases while the physical phone and SIM routing stays unchanged. Revoking the sharing phone also clears its phone and SIM aliases.
