# SMS Connect Assistant · 短信互联助手

[中文](README.md) | English

Use your own Android phone as an SMS endpoint and read, receive, and send messages from an iPhone Home Screen web app. A single APK contains the HTTPS server and web interface; no continuously running computer is required.

**The application interface remains Chinese; repository documentation is bilingual.** The current version is **0.3.1-candidate**, pending broader device coverage and long-term testing. Based on [capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway), under Apache-2.0. This project is not affiliated with Apple, Google, Xiaomi, or the upstream project.

[Download APK](https://github.com/1Fann/sms-connect-assistant/releases) · [Installation](docs/INSTALL.en.md) · [Security and privacy](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Features

- iPhone PWA with message lists, conversations, contact search, dual-SIM selection, sending status, and light/dark themes.
- Android default SMS app mode handles text messages and system SMS database records. Ordinary operation does not require Root.
- On the tested Redmi / MIUI 14 device, setting the app as the default SMS handler and granting permissions avoids per-message Android confirmation while keeping MIUI optimization enabled. Other ROMs require testing.
- HTTPS, Android-side pairing approval, device revocation, session rotation, and idempotent requests. Unknown outcomes are not automatically resent as new requests; gateway acceptance does not mean delivery.
- Cloudflare DNS-01 certificate issuance and renewal jobs, or manual certificate import. Users maintain their own DDNS.
- iOS Home Screen Web Push without message bodies or full phone numbers. Delivery depends on Apple push services and may be delayed.
- Configurable checks every 1–1440 minutes, default 5, covering local HTTPS, certificates, permissions, and IPv6 DNS.
- Optional independent Root watchdog checks the process every 10 seconds and performs bounded recovery while respecting manual stop. Root is not required for normal SMS operation.
- International number display uses Google libphonenumber / libphonenumber-js numbering rules. These are not Apple's private formatting API and do not guarantee exact matches across all iOS versions.

## Quick start

1. Install the APK from Releases. HTTPS functionality requires Android 6+; the optional Root watchdog requires Android 8+ and a compatible Root environment.
2. Open Settings → Configuration checks and recovery (`配置检查与自动恢复`). Select the app as the default SMS handler, grant SMS/SIM/notification permissions, and allow background operation. On MIUI, also check autostart and battery restrictions.
3. Configure your own domain and trusted HTTPS certificate. `sms.example.com` in public source is a placeholder and must be replaced.
4. Point DNS at a reachable address on the phone. The tested deployment uses public IPv6 with TCP 8443 allowed only to the target device; the iPhone network must also support IPv6. Use Cloudflare DNS-only records.
5. Start the service. Open `https://your-domain:8443` in Safari, add it to the Home Screen, launch it there, enter the pairing code, and approve access on Android.
6. For optional Root protection, select Enable/update Root watchdog (`启用 / 更新 Root 守护`) and grant access in the superuser manager. Reconfirm the watchdog version after an APK update.

First-install permissions, certificates, and pairing cannot be silently granted by an APK. Updates with the same package ID and signature preserve configuration; uninstalling or reinstalling with a different signature can lose private configuration. Existing iPhone Home Screen icon names may require manual renaming.

## Preview

These screenshots use simulated browser-test data, not personal messages.

<img src="verification/conversations-light.png" width="280" alt="Simulated conversation list in light mode" /> <img src="verification/chat-dark.png" width="280" alt="Simulated messages in dark mode" />

## Build

Use JDK 17, Android SDK 35, and Build Tools 36.0.0. The Gradle Wrapper uses 8.8. Set `ANDROID_HOME` or put your own `sdk.dir` in an untracked `local.properties` file.

```sh
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

On Windows use `gradlew.bat`. Built web assets are included in the Android source. To change the web interface, use Node 24 and pnpm 11:

```sh
cd pwa
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

For a signed release set `SIGNING_STORE_FILE` (absolute path to your private keystore), `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, and `SIGNING_KEY_PASSWORD`, then run `:app:assembleRelease`. Signing keys are not included. A differently signed self-built APK cannot update an existing official installation.

## Validation and limitations

- This version passed a local build, 115 Android unit tests, 8 frontend tests, and mocked browser flows. Mock tests do not send SMS.
- Earlier versions verified dual-SIM discovery, real SMS sending/receiving, an iPhone test notification, and public IPv6 access on one Redmi / Android 13 / MIUI 14 device. Version 0.3.0 verified Root recovery after force-stop, respecting manual stop, and disabling the watchdog without stopping SMS service. Version 0.3.1 mainly renames the application and removes personal defaults from public source.
- Local HTTPS health does not prove internet reachability or carrier delivery. Non-Root background fallback checks have a 15-minute minimum and may be delayed; they cannot bypass force-stop. Root protection is not a guarantee of permanent availability.
- The certificate job checks daily and attempts renewal within 30 days of expiry. Real expiry-driven renewal, long-term locked-screen operation, watchdog startup after a full reboot, and other ROMs still need validation.
- MMS notifications are retained, but attachments are not downloaded. This is not a full MMS, iMessage, RCS, or calling client.
- SMS is not end-to-end encrypted and carrier charges may apply. Use only phones and numbers you are authorized to control.

## Attribution and license

Upstream package names and internal identifiers are retained for data and update compatibility. See [NOTICE](NOTICE) for the upstream baseline and major dependencies. Source is licensed under [Apache License 2.0](LICENSE); third-party dependencies retain their own licenses.
