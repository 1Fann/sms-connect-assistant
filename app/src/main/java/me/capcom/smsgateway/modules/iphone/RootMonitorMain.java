package me.capcom.smsgateway.modules.iphone;

import android.os.Process;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.channels.FileLock;
import java.util.*;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.*;

/** Separate root process: never opens the message database or app credentials. */
public final class RootMonitorMain {
    private static final File BASE = new File("/data/adb/sms-bridge");
    private static final String PACKAGE = "me.capcom.smsgateway.iphone";
    private static final String COMPONENT = PACKAGE + "/me.capcom.smsgateway.modules.iphone.IphoneService";
    private static String read(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] bytes = new byte[8192]; int n=in.read(bytes);
            return n < 0 ? "" : new String(bytes,0,n,"UTF-8");
        }
    }
    private static void status(String text) throws Exception {
        File next=new File(BASE,"status.tmp");
        try(FileOutputStream out=new FileOutputStream(next)) {
            out.write((new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",Locale.CHINA).format(new Date())+"\n"+text).getBytes("UTF-8"));
        }
        if(!next.renameTo(new File(BASE,"status"))) throw new IOException("status");
    }
    private static boolean command(String... args) throws Exception {
        java.lang.Process p=new ProcessBuilder(args).redirectErrorStream(true).start();
        Thread drain=new Thread(() -> { try { byte[] b=new byte[1024]; while(p.getInputStream().read(b)!=-1) {} } catch(Exception ignored) {} });
        drain.setDaemon(true); drain.start();
        if(!p.waitFor(12,TimeUnit.SECONDS)) { p.destroyForcibly(); return false; }
        return p.exitValue()==0;
    }
    private static boolean healthy(String host) {
        if(!host.matches("[a-zA-Z0-9.-]+")) return false;
        try(Socket plain=new Socket()) {
            plain.connect(new InetSocketAddress("127.0.0.1",8443),2000); plain.setSoTimeout(4000);
            try(SSLSocket socket=(SSLSocket) ((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(plain,host,8443,true)) {
                SSLParameters parameters=socket.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS");
                socket.setSSLParameters(parameters); socket.setSoTimeout(4000); socket.startHandshake();
                socket.getOutputStream().write(("GET /healthz HTTP/1.1\r\nHost: "+host+":8443\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
                ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] b=new byte[2048]; int n;
                while((n=socket.getInputStream().read(b))!=-1 && out.size()<16384) out.write(b,0,n);
                String response=out.toString("UTF-8");
                return response.startsWith("HTTP/1.1 200") && response.contains("\"sms-bridge\"");
            }
        } catch(Exception ignored) { return false; }
    }
    public static void main(String[] args) throws Exception {
        if(Process.myUid()!=0) return;
        try(RandomAccessFile lockFile=new RandomAccessFile(new File(BASE,"lock"),"rw")) {
            FileLock lock=lockFile.getChannel().tryLock(); if(lock==null) return;
            try {
                try(FileOutputStream out=new FileOutputStream(new File(BASE,"pid"))) { out.write(Integer.toString(Process.myPid()).getBytes("US-ASCII")); }
                long last=0; int failures=0;
                ArrayList<Long> attempts=new ArrayList<>();
                // Persist repair limits across daemon restart, including clock rollback.
                File repairs=new File(BASE,"repairs");
                if(repairs.isFile()) for(String s:read(repairs).trim().split(",")) try { attempts.add(Long.parseLong(s)); } catch(Exception ignored) {}
                while(new File(BASE,"enabled").isFile()) {
                    try {
                        File stateFile=new File("/data/user/0/"+PACKAGE+"/no_backup/bridge-monitor-state.json");
                        if(!stateFile.isFile()) { status("等待首次解锁或应用配置；不自动开启服务"); Thread.sleep(10000); continue; }
                        JSONObject state=new JSONObject(read(stateFile));
                        if(!state.optBoolean("enabled") || !state.optBoolean("monitor")) {
                            failures=0; last=0; status("服务或自动检测已手动关闭；不会拉起"); Thread.sleep(10000); continue;
                        }
                        long now=System.currentTimeMillis(); int minutes=Math.max(1,Math.min(1440,state.optInt("minutes",5)));
                        File checkNow=new File(BASE,"check-now"); boolean force=checkNow.delete();
                        boolean running=command("/system/bin/pidof",PACKAGE);
                        if(!running || force || last==0 || now<last || now-last>=minutes*60000L || failures>0) {
                            boolean ok=healthy(state.optString("host",""));
                            last=now; failures=ok?0:failures+1;
                            attempts.removeIf(t -> now>=t && now-t>=3600000L);
                            boolean cooldown=false; for(long t:attempts) if(t>now || now-t<60000) cooldown=true;
                            if(!ok && failures>=2 && attempts.size()<3 && !cooldown) {
                                // Re-read the desired state immediately before a recovery to honor manual stop.
                                JSONObject latest=new JSONObject(read(stateFile));
                                if(latest.optBoolean("enabled") && latest.optBoolean("monitor") && new File(BASE,"enabled").isFile()) {
                                    attempts.add(now);
                                    try(FileOutputStream out=new FileOutputStream(repairs)) {
                                        StringBuilder saved=new StringBuilder(); for(long t:attempts) saved.append(t).append(',');
                                        out.write(saved.toString().getBytes("UTF-8"));
                                    }
                                    boolean requested=command("/system/bin/am","start-foreground-service","--user","0","-n",COMPONENT,"-a",PACKAGE+".RECOVER");
                                    status(requested?"已请求恢复服务，等待下次检查确认":"系统拒绝恢复，请打开应用检查");
                                }
                            } else status(ok?"Root 守护正常；本机 HTTPS 正常；每 "+minutes+" 分钟完整检测，10 秒检查进程":"HTTPS 未通过检测；等待复检或恢复冷却（每小时最多 3 次）");
                            if(ok && (force || failures==0)) command("/system/bin/am","start-foreground-service","--user","0","-n",COMPONENT,"-a",PACKAGE+".CHECK");
                        }
                    } catch(Exception ignored) { status("检测暂时失败，稍后重试；不会重发短信"); }
                    Thread.sleep(10000);
                }
                status("Root 守护已关闭");
            } finally { lock.release(); }
        }
    }
}
