# 通讯互联 · CommLink

中文 | [English](README.en.md)

将多台安卓手机的短信、SIM 线路、联系人和通话记录汇集到 iPhone。

[下载安装包](https://github.com/1Fann/sms-connect-assistant/releases/latest) · [更新说明](https://github.com/1Fann/sms-connect-assistant/releases)

## 功能

- 两个独立主屏幕网页应用：互联信息和互联电话。
- 短信收发、通知预览、未读角标和多设备线路选择。
- 读取安卓通讯录，支持远程编辑和通话记录同步。
- 通过 Groundwire 接听和拨打电话，支持来电显示手机名与卡名。

## 使用

日常短信不依赖 Root。网页需要可访问的 HTTPS 地址及证书；语音需另行配置 Voice SIP Gateway、Asterisk 和 Groundwire。

从 Releases 下载，按安装说明完成授权，在本机填写自己的账号和连接参数。同包名、同签名的版本可覆盖升级并保留数据。

## 文档

- [安装使用](docs/INSTALL.zh-CN.md)
- [设备与线路](docs/MULTI_PHONE.md)
- [联系人与通话记录](docs/COMMLINK-DIRECTORY.md)
- [语音配置](docs/VOICE.zh-CN.md)
- [安全说明](SECURITY.md)

## 许可证

基于 [Android SMS Gateway](https://github.com/capcom6/android-sms-gateway)。许可证见 [LICENSE](LICENSE)。应用界面保持中文。
