# Native Groundwire calling

Starting with 0.9.0-dev6 (29), the Phone PWA provides contacts, call history and a dialer that opens Groundwire through its official `groundwire:prefixNumber?dialAction=voiceCall` URI. Browser microphone capture, SIP.js, WebRTC, audio tests, background handoff/recovery and the Android ARI call controller have been removed. Groundwire owns each call from origination through termination.

## Setup

Configure the existing Asterisk account in Groundwire using the actual SIP server, transport, port and password. These are separate from the PWA HTTPS address. Enable Groundwire incoming push for native calls.

Add explicit authenticated device/SIM routes to your PBX. The [example dialplan](../ops/asterisk/groundwire.conf.example) maps *81* and *82* to gateway 2001 slots 1 and 2, for existing authenticated accounts 1001 and 1002. Adapt all identities for your deployment; additional gateways require distinct prefixes. Official Call URI documentation does not specify a reliable account selection parameter, so SIM selection is performed by the PBX prefix regardless of the active Groundwire account.

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
