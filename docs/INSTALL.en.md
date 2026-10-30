# Installation, networking, and monitoring

[中文](INSTALL.zh-CN.md) | English | [Home](../README.en.md)

## Initial Android setup

Open Settings → Configuration checks and recovery (`配置检查与自动恢复`). Select the app as the default SMS handler, grant SMS/SIM/notification permissions, and exempt it from battery optimization. Contacts access is optional and enables contact names. On MIUI, separately allow autostart and unrestricted battery use; locking the app in Recents may help. Keep MIUI optimization enabled. Setting names and behavior vary by ROM.

Default SMS mode makes this app responsible for receiving and recording text messages. MMS attachments are not supported; use an appropriate client if full MMS support is needed. The native inbox supports reading and manually sending text messages.

## Domain and HTTPS

1. Prepare your own domain and DDNS. The validated deployment points its AAAA record at the phone's global unicast IPv6 address, not the router, a link-local address, or ULA.
2. Keep Cloudflare DNS-only mode. Where supported, allow IPv6 TCP 8443 only to the phone. Do not expose unrelated management ports for this project.
3. Under Domain, certificate and iPhone pairing (`域名、证书与 iPhone 配对`), enter a hostname such as `sms.example.com` without protocol or port, and the Cloudflare Zone ID.
4. Create a restricted API Token for that Zone with Zone Read and DNS Edit, then save it using the encrypted-token button. Never post the Token on GitHub or use a Global API Key.
5. Read the linked Let's Encrypt terms. You may test DNS-01 before explicitly accepting terms and issuing a production certificate. The app creates and cleans up validation TXT records; it does not change AAAA or existing DDNS. The domain will appear in public certificate transparency logs.
6. For other DNS providers, import a PKCS#12 file containing the private key and intermediate certificate chain. The certificate must be trusted by iPhone. Importing does not configure automatic renewal for another DNS provider.
7. Start the service and test `https://your-domain:8443` from both the LAN and another IPv6-capable network. Local health does not prove internet reachability.

Production issuance schedules daily checks and attempts renewal with fewer than 30 days remaining. Network availability, OS scheduling, Token permissions, and CA limits can cause failures. Failures retain the old certificate and never downgrade to plaintext. Check issuance status before expiry.

## iPhone pairing and notifications

Open the URL in Safari, use Share → Add to Home Screen, then launch it from the Home Screen. Generate a three-minute pairing code on Android, enter it on iPhone, and approve access on Android. Only authorize devices you trust to read and send SMS.

iOS 16.4+ Home Screen web apps can request notification permission. Subscribe and test in Settings; successful submission does not prove reception, which must be confirmed on the device. Notifications omit message bodies and full numbers.

Before sending, check the SIM and recipient. If the outcome is uncertain, verify actual reception before retrying. The app retains the original request ID rather than automatically creating a new send request. Refresh status when the network returns.

## Interval monitoring

The default interval is 5 minutes, configurable from 1 to 1440 minutes, with a manual check button. Checks cover HTTPS, certificates, default SMS role, permissions, battery exemption, global IPv6, and the domain's AAAA records. DNS mismatches only produce a warning; the app does not take over DDNS.

Without Root, checks run at the selected interval while the service is alive. WorkManager fallback checks have a 15-minute minimum and may be delayed. Bounded HTTPS recovery requires two consecutive failures; an invalid certificate requires attention. It cannot bypass force-stop.

Optional Root monitoring requires Android 8+. Enable it in the setup page and grant superuser access. A separate process checks the app process every 10 seconds and HTTPS at the selected interval. Recovery requires consecutive failures, allows at most three attempts per hour, and has a one-minute minimum cooldown. It never resends messages or silently changes the default SMS role or SMS permissions.

- Manually disabling the public service or automatic checks prevents recovery.
- Disabling Root monitoring stops its own process and removes its own boot hook; SMS service remains unchanged.
- Boot startup waits for boot completion and first unlock. A compatible `service.d` Root environment is required; runtime behavior has currently been tested only on a Magisk device.
- Files live in `/data/adb/sms-bridge`, with boot hook `/data/adb/service.d/98-sms-bridge.sh`. Other assistants are not modified.
- Startup verifies the approved APK hash. After updating the APK, select Enable/update Root watchdog (`启用 / 更新 Root 守护`) and refresh its status.

Revoked Root access, termination of the watchdog itself, OS restrictions, or network failure can still interrupt operation. Health checks are not a delivery guarantee for SMS, notifications, or internet connectivity.

## Updates, removal, and troubleshooting

Update with the same signing identity without clearing app data. Before uninstalling, disable Root monitoring and switch the default SMS handler if appropriate. Reinstallation requires certificates and pairing to be configured again.

Start troubleshooting with the setup checks and Root status, then inspect phone connectivity, DNS, certificates, and router rules. Report only redacted errors; never upload messages, contacts, real numbers, pairing codes, or keys.
