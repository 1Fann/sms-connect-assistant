# CommLink voice integration and validation

The host already contains the WebSocket, ARI, Stasis, SRTP and crypto module files. The existing manager provisions a selective modules.conf with autoload=no; those modules were not in its load list. HTTP was disabled and ICE was off. Although the ARI general setting was enabled, the ARI module was not loaded. Reinstallation is not indicated by these checks. Validate dependencies, WSS, restricted routes and media on a separate PBX before any production change.


Voice is opt-in. Android owns the outside cellular channel through a loopback Asterisk ARI/Stasis controller. The Phone PWA uses restricted SIP.js credentials over WSS; Groundwire is a separate SIP endpoint. Calls and handoff state persist in commlink-voice.db (v1, calls/events/transfers); the SMS journals are not modified by this feature.

## Verified baseline

A read-only probe found Asterisk 20.6.0, three PJSIP endpoints and three UDP transports. RTP was loaded. ARI, Stasis, HTTP WebSocket and PJSIP WebSocket modules were not loaded, AMI was disabled and RTP ICE support was off. Public WSS, media reachability and NAT/TURN requirements remain unverified. No production account was changed and no call was made. Local Voice SIP Agent source reports custom.3 while the installed app reports custom.5. The examined source accepts X-VSA-Dial and X-VSA-SIM (1 or 2) on outbound-to-cellular INVITEs. Additional slots on this adapter are refused. A device shares one concurrent cellular call across its SIMs.

## Isolated PBX setup

1. Prepare a test ARI HTTP/WS listener on 127.0.0.1, Stasis, PJSIP WebSocket and RTP/WebRTC support. Expose only the SIP WebSocket path through a trusted WSS endpoint. Check ICE, TURN, DTLS-SRTP, codecs and NAT on each target network. Do not publish ARI or AMI. Use the existing PBX manager for installation and operational checks.
2. Create separate endpoint, AOR, credentials and dialplan context for the WebRTC role, native role and each vetted gateway. The browser context may only present a short-lived ticket to Stasis. Disable REFER/unrestricted transfers and exclude all external dialplan contexts. A single Groundwire account handles incoming calls. Preserve legacy production accounts through acceptance.
3. On Android open SIP service → Groundwire. Device credential verification gates editing and revealing passwords. Enter local ARI details, WSS and SIP domain, a restricted web endpoint, a Groundwire endpoint, device-to-gateway bindings and explicitly allowed numbers or prefixes. An empty allowlist denies outbound calls. Generate a Groundwire password draft or enter an already configured value. Saving drafts will not provision or rotate credentials on the PBX. The export uses credential placeholders and must be reviewed manually. ICE server entries may be configured as a JSON array; restrict and rotate TURN credentials.
4. Configure/provision the separate Voice SIP Agent on each cellular gateway. The standard application cannot use its DUMP-protected provisioning receiver. Assign the tested endpoint to its device and verify slot behavior on hardware. For incoming multi-SIM calls configure trusted per-DID routing to Stasis(commlink,incoming,<logical-line-id>); when the source SIM is ambiguous, do not guess. Do not replace existing inbound routes until the new routing is verified.

## Call and handoff behavior

POST calls allocates a durable call ID and returns a short-lived internal SIP URI. A single authorized INVITE redeems it. The backend rechecks access, live device/subscription bindings, gateway registration and channel occupancy before creating an outside leg, attaching slot/dial headers and dialing once. Ambiguous submissions are never automatically redialed. A browser disconnect does not issue an external dial or immediate hangup.

Both explicit and opt-in background handoffs call Groundwire through ARI. CallKit acceptance is manual. The native leg is joined muted. Both directions of RTP counters on native and outside legs must advance before switching microphones, persisting NATIVE_ACTIVE and dropping the old web leg. This measures media traffic, not human-audible quality. Native failure attempts to preserve WebRTC; unresolved legs retain the gateway lock until bounded cleanup and reconciliation. Lock-screen JS notification is best effort. New incoming calls use the same controller, resolve trusted caller names, and create one user-facing record per outside call. PBX and Android rows without a proven association stay separate.

GET voice/status and GET voice/history report availability and visible calls. Dial access is required for POST voice/web-session, calls, calls/{id}/handoff and calls/{id}/hangup. GET calls/{id}/state checks the installation and line. Local-admin test ringing only addresses the configured native endpoint and terminates upon answer or timeout.

## Release validation

Run Gradle testDebugUnitTest and the PWA checks. Unit fixtures cover explicit slot/device restrictions, destination policy, actual OkHttp requests to a local fake ARI, duplicate-dial avoidance, RTP counter gates and fault injection at cutover. A passing test does not certify production voice readiness. In an isolated PBX exercise stale tickets, wrong endpoints, revoked grants, busy gateways, unanswered native legs, one-way RTP, device reboot and network loss. Verify exactly one outside channel and a held gateway lock throughout handoff.

Real WSS calling, iPhone foreground audio, dual-SIM routing, Chinese Caller ID, Groundwire push and lock-screen answer, Wi-Fi/VPN transitions and two-way audio through a native handoff remain hardware acceptance items. See the [Chinese guide](VOICE.zh-CN.md), [Asterisk WebRTC setup](https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/) and [Acrobits incoming call flow](https://doc.acrobits.net/server-components/sipis/incoming-calls/).

## Deployment update, 2026-11-02

The user subsequently authorized deployment. Version 0.9.0-dev2 now runs on the connected Redmi. Web voice modules are enabled, ARI remains loopback-only, and the Phone HTTPS origin provides an authenticated SIP-only WebSocket proxy. Existing gateway and Groundwire accounts are reused while incoming routes are retained. SIP registration/cleanup and real TLS authorization/revocation checks passed. Carrier calls, two-way media and handoff remain unverified. See [the deployment record](COMMLINK-UPGRADE.md).


## ARI dial accepted but no outbound INVITE (2026-11-02 repair)

The host was missing bridge_holding.so. ARI create/dial uses an internal holding dial bridge before calling the channel. The HTTP dial request can be accepted while that asynchronous operation fails, leaving the Android controller waiting until its deadline. Simple/mixing bridges and SIP registration alone do not verify this dependency.

The module is now loaded and explicitly persisted in modules.conf without replacing accounts, routes or app data. The deployment checklist also retains bridge_simple, bridge_softmix, res_timing_timerfd, RTP and codecs. The exported provisioning notes now include this requirement.

verification/ari_loopback_dial.py reproduced the failure before repair and received the correct INVITE and destination/SIM headers afterward. It uses a separate ARI event application and a temporary endpoint whose sole contact is an ephemeral 127.0.0.1 UDP socket. No carrier, registered gateway or Groundwire endpoint is dialed. It requires an idle PBX, returns a synthetic busy response, and removes the temporary resources. Credentials are read only from a private file inside the PBX. This is signaling validation, not proof of real calls or bidirectional media.

See [Asterisk 20.6 control.c](https://github.com/asterisk/asterisk/blob/20.6.0/res/stasis/control.c), get_dial_bridge and app_control_dial.


## WebRTC media repair and microphone lifecycle (0.9.0-dev3 / 26)

RTP from the Android gateway advanced while the browser leg stayed at zero. A real browser echo test reproduced ICE checking / DTLS new. The virtual WebSocket transport was bound to loopback; Asterisk 20.6 also used that transport address for its RTP socket. Changing its bind to [::] restored routable IPv4/IPv6 ICE candidates without changing the loopback-only HTTP/ARI listener or adding a TCP 5060 listener.

The production HTTPS/WSS echo test then reached connected for ICE, DTLS and peer connection, receiving/sending 504 packets in roughly ten seconds with no external allocation request. The user confirmed iPhone echo and two-way carrier audio on the home Wi-Fi with VPN disabled. WAN, VPN, CallKit and native handoff remain separate acceptance items.

The Phone settings now include a bounded internal Echo test (no phone/carrier), explicit playback recovery, and per-call microphone capture shared by SDP operations and stopped at completion/cancellation. Late permission results are also stopped. 39 frontend tests, 152 JVM tests and the signed build passed. Temporary diagnostic authorization/processes were removed and SIP history disabled/cleared.

Home Screen permission persistence remains controlled by iOS. Safari per-site permission is not guaranteed to apply to the installed PWA. See [WebKit issue 327237](https://bugs.webkit.org/show_bug.cgi?id=327237); no permanent permission is promised and capture is not retained after calls.
