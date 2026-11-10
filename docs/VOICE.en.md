# Native Groundwire calling

Starting with 0.9.0-dev6 (29), the Phone PWA provides contacts, call history and a dialer that opens Groundwire through its official `groundwire:prefixNumber?dialAction=voiceCall` URI. Browser microphone capture, SIP.js, WebRTC, audio tests, background handoff/recovery and the Android ARI call controller have been removed. Groundwire owns each call from origination through termination.

## Setup

Configure the existing Asterisk account in Groundwire using the actual SIP server, transport, port and password. These are separate from the PWA HTTPS address. Enable Groundwire incoming push for native calls.

Add explicit authenticated device/SIM routes to your PBX. The [example dialplan](../ops/asterisk/groundwire.conf.example) maps *81* and *82* to gateway 2001 slots 1 and 2, for the authenticated client account 1001. One Groundwire account can select all configured device/SIM routes; a separate client account per SIM is not required. Adapt all identities for your deployment; additional gateways require distinct prefixes. Official Call URI documentation does not specify a reliable account selection parameter, so SIM selection is performed by the PBX prefix regardless of the active Groundwire account.

On Android, open the protected Groundwire settings and verify the device lock screen. Each mapping line contains stable line ID, device ID, SIM slot, subscription ID and prefix. Saving application settings does not modify the PBX. Replaced, offline, unconfirmed or unmapped SIMs cannot inherit another route.

Select a line and number on the Phone PWA, then tap Call. iOS may ask to open Groundwire. The PWA reports only the launch request, not successful connection. Audio, microphone permissions, call controls and background operation belong to Groundwire.

## History and authorization

Android call-log permission and sharing must be enabled. Calls that actually pass through an Android SIM and generate a system call-log entry sync to the PWA after completion. Pure SIP calls or failures before reaching Android may have no Android record. Returning to the visible history page refreshes the data.

GET /api/v2/groundwire/routes requires an approved Phone installation, calls.dial and the relevant device grant. Only exact live line/device/slot/subscription mappings are returned; no SIP password is included. Native SIP account permissions are independently enforced by the PBX. Revoking a PWA installation does not revoke its separate Groundwire account.

Android history and the read-only legacy /api/v2/voice/history archive are retained. The old voice database is never used to control new calls. Browser calls/handoff/resume/web-session endpoints return 410; /ws is removed. Phone responses disable microphone and camera through Permissions-Policy. Only the Phone Worker cache generation changes; Messages data, cache and pairing remain intact.

## Migration and acceptance

Check that no calls are active and back up private PBX settings. Preserve native Groundwire/VSA endpoints and incoming routes. Remove the dedicated cl-web endpoint, WS transport, Stasis route, ARI credentials and HTTP/ARI module additions from the former browser deployment. Do not restore entire older PJSIP or extensions files over later native changes.

Validate both SIMs, international numbers, incoming calls, background native audio, call-log synchronization, line replacement and authorization revocation. Automated checks must not originate real external calls. Actual iPhone app launch and carrier audio require user acceptance.

Sources: [Call URIs](https://doc.acrobits.net/cloudsoftphone/call-uris/), [Dial Actions](https://doc.acrobits.net/cloudsoftphone/dialactions/).

## Single-account deployment

The current deployment retains client `1001` and removes `1002` (endpoint, auth, AOR and dialplan authorization). Prefixes `*81*`/`*82*` select the primary gateway slots, while deployment-specific `*83*`/`*84*` select the peer gateway slots. Unprefixed native dialing defaults to primary SIM 1; incoming cellular calls continue to ring `1001`. Back up private settings and confirm no active calls before account removal. Removing a PBX account does not remove the locally saved entry from Groundwire on iOS. This is a PBX configuration change and requires no CommLink APK update.

## Outgoing destination display

After validation, outgoing rules clear the internal connected-line name and set `CONNECTEDLINE(num)` to the real destination without the routing prefix. `Dial` uses option `I` to prevent gateway identity updates from replacing it with an internal `s` extension or gateway account. Apply this to both primary SIMs, both peer SIMs and the legacy unprefixed primary dialing path.

See the optional [peer gateway template](../ops/asterisk/groundwire-peer.conf.example). Include its routes from the authenticated client context and include the `commlink-native-header` handler from the primary template; adapt gateway identities and prefixes to your deployment.

References: [Asterisk CONNECTEDLINE](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Dialplan_Functions/CONNECTEDLINE/) and [Dial option I](https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/Dialplan_Applications/Dial/). This is a PBX dialplan fix and does not require a new APK.

[来电设备与卡名称 / Incoming line aliases](releases/0.9.8.md)
