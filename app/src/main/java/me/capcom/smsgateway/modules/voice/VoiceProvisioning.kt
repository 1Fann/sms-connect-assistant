package me.capcom.smsgateway.modules.voice

/** Offline, secret-free review material. Never runs Asterisk commands or writes into its configuration. */
internal object VoiceProvisioning {
    fun render(web:String,native:String,gateways:List<Pair<String,String>>):String {
        val names=listOf(web,native)+gateways.map{it.second}
        require(names.all(::validEndpoint) && names.distinct().size==names.size)
        return buildString {
            appendLine("; CommLink staged configuration / 离线草案")
            appendLine("; Split into the named files on an isolated PBX. Replace placeholders locally.")
            appendLine("; Confirm each identifier is NEW. Do not replace existing files, accounts or routes.")
            appendLine("; Never expose /ari or AMI at a public origin. Publish only /ws to the browser.")
            appendLine("; --- http.conf ---")
            appendLine("[general]\nenabled=yes\nbindaddr=127.0.0.1\nbindport=<LOOPBACK_ARI_PORT>")
            appendLine("; Reverse proxy the public trusted WSS path to this listener's /ws only.")
            appendLine("; --- ari.conf ---")
            appendLine("[general]\nenabled=yes\npretty=no")
            appendLine("[<LOCAL_ARI_USER>]\ntype=user\nread_only=no\npassword=<LOCAL_ARI_PASSWORD>")
            appendLine("; --- pjsip.conf ---")
            appendLine("[cl-wss]\ntype=transport\nprotocol=wss\nbind=127.0.0.1")
            appendLine("; Provide a tested SIP/TLS transport for Groundwire and each compatible gateway.")
            appendLine("; Supply certificate, reachable signaling/media addresses, ICE, RTP ports and firewall per site.")
            fun endpoint(name:String,context:String,transport:String,pass:String,isWeb:Boolean){
                appendLine("["+name+"]\ntype=aor\nmax_contacts="+(if(isWeb)"8" else "1")+"\nremove_existing=yes\nqualify_frequency=45")
                appendLine("["+name+"-auth]\ntype=auth\nauth_type=userpass\nusername="+name+"\npassword=<"+pass+">")
                appendLine("["+name+"]\ntype=endpoint\ncontext="+context+"\ntransport="+transport+"\naors="+name+"\nauth="+name+"-auth")
                appendLine("disallow=all\nallow=ulaw,alaw\ndirect_media=no\nallow_transfer=no\nrtp_symmetric=yes\nforce_rport=yes\nrewrite_contact=yes\ndtmf_mode=rfc4733")
                if(isWeb)appendLine("webrtc=yes\ndtls_auto_generate_cert=yes")
                else appendLine("; Set media_encryption to match the tested native client/transport.")
                if(name==native)appendLine("send_pai=yes")
            }
            endpoint(web,"cl-web-in","cl-wss","RESTRICTED_WEB_PASSWORD",true)
            endpoint(native,"cl-native-in","<TESTED_NATIVE_TRANSPORT>","GROUNDWIRE_PASSWORD",false)
            for((index,gateway) in gateways.withIndex()){
                appendLine("; Gateway "+(index+1)+" owns an Android device, not a SIM.")
                endpoint(gateway.second,"cl-gateway-in","<TESTED_GATEWAY_TRANSPORT>","UNIQUE_GATEWAY_PASSWORD_"+(index+1),false)
            }
            appendLine("; --- extensions.conf (isolated contexts; do not include an external dialing context) ---")
            appendLine("[cl-web-in]\nexten => _.,1,Stasis(commlink,web)\n same => n,Hangup()")
            appendLine("[cl-native-in]\nexten => _.,1,Hangup()")
            appendLine("[cl-gateway-in]\nexten => _.,1,Stasis(commlink,incoming)\n same => n,Hangup()")
            appendLine("; If one gateway has multiple SIMs, replace its context with one route per verified distinct incoming DID.")
            appendLine("; Pass Stasis(commlink,incoming,<CONFIRMED_LOGICAL_LINE_ID>); do not guess SIM from the caller number.")
            appendLine("; Outbound: ARI creates the authenticated gateway leg and sets X-VSA-Dial and X-VSA-SIM before dial.")
            appendLine("; Required: res_stasis, res_ari + channels/bridges/endpoints/events, res_http_websocket,")
            appendLine("; res_pjsip_transport_websocket, res_rtp_asterisk, PJSIP_HEADER and TIMEOUT functions.")
        }
    }
}
