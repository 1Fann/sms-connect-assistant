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
    private static String lastStatus="";
    private static long lastStatusAt;
    private static String read(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] bytes = new byte[8192]; int n=in.read(bytes);
            return n < 0 ? "" : new String(bytes,0,n,"UTF-8");
        }
    }
    private static void status(String text) {
        // Diagnostics (for example, full storage) must not terminate recovery.
        long elapsed=System.nanoTime();
        if(text.equals(lastStatus) && elapsed-lastStatusAt<TimeUnit.SECONDS.toNanos(30)) return;
        try {
            File next=new File(BASE,"status.tmp");
            try(FileOutputStream out=new FileOutputStream(next)) {
                out.write((new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss",Locale.CHINA).format(new Date())+"\n"+text).getBytes("UTF-8"));
            }
            if(next.renameTo(new File(BASE,"status"))) { lastStatus=text; lastStatusAt=elapsed; }
        } catch(Exception ignored) { }
    }
    private static boolean command(String... args) throws Exception {
        java.lang.Process p=new ProcessBuilder(args).redirectErrorStream(true).start();
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        Thread drain=new Thread(() -> {
            try (InputStream in=p.getInputStream()) {
                byte[] bytes=new byte[1024]; int count;
                while((count=in.read(bytes))!=-1) if(output.size()<8192) output.write(bytes,0,count);
            } catch(IOException ignored) {}
        });
        drain.setDaemon(true); drain.start();
        if(!p.waitFor(12,TimeUnit.SECONDS)) { p.destroyForcibly(); return false; }
        drain.join(1000);
        return !drain.isAlive() && p.exitValue()==0 && !output.toString("UTF-8").contains("Error:");
    }
    private static ProcessIdentity discoverProcess() throws Exception {
        java.lang.Process p=new ProcessBuilder("/system/bin/pidof",PACKAGE).redirectErrorStream(true).start();
        try {
            if(!p.waitFor(2,TimeUnit.SECONDS)) throw new IOException("process lookup timeout");
            if(p.exitValue()==1) return null;
            if(p.exitValue()!=0) throw new IOException("process lookup failed");
            byte[] bytes=new byte[1024]; int n=p.getInputStream().read(bytes);
            if(n<=0) return null;
            for(String value:new String(bytes,0,n,"US-ASCII").trim().split("\\s+")) {
                if(!value.matches("[0-9]+")) throw new IOException("process lookup response");
                try {
                    ProcessIdentity identity=ProcessIdentity.capture(new File("/proc"),Integer.parseInt(value),PACKAGE);
                    if(identity!=null) return identity;
                } catch(FileNotFoundException ignored) { /* Process exited between discovery and capture. */ }
            }
            return null;
        } finally { p.destroy(); }
    }
    private static boolean healthy(String host) {
        if(!host.matches("[a-zA-Z0-9.-]+")) return false;
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
        try(Socket plain=new Socket(); SocketDeadline timeout=new SocketDeadline(plain,8000)) {
            plain.connect(new InetSocketAddress("127.0.0.1",8443),2000); plain.setSoTimeout(4000);
            try(SSLSocket socket=(SSLSocket) ((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(plain,host,8443,true)) {
                SSLParameters parameters=socket.getSSLParameters(); parameters.setEndpointIdentificationAlgorithm("HTTPS");
                socket.setSSLParameters(parameters); socket.setSoTimeout(remainingMillis(deadline)); socket.startHandshake();
                socket.getOutputStream().write(("GET /healthz HTTP/1.1\r\nHost: "+host+":8443\r\nConnection: close\r\n\r\n").getBytes("US-ASCII"));
                ByteArrayOutputStream out=new ByteArrayOutputStream(); byte[] b=new byte[2048]; int n;
                while(out.size()<16384) {
                    // A slow response must not keep resetting a per-read timeout forever.
                    socket.setSoTimeout(remainingMillis(deadline));
                    n=socket.getInputStream().read(b);
                    if(n==-1) break;
                    out.write(b,0,n);
                }
                String response=out.toString("UTF-8");
                return response.startsWith("HTTP/1.1 200") && response.contains("\"sms-bridge\"");
            }
        } catch(Exception ignored) { return false; }
    }
    // A peer provides no local HTTPS listener. Its normal service checks the
    // authenticated connection; the root guard restores its process and wakes
    // the service at the configured interval without reading any credentials.
    static boolean serviceHealthy(boolean peerMode, boolean running, String host) {
        return peerMode ? running : healthy(host);
    }
    static int remainingMillis(long deadline) throws SocketTimeoutException {
        long remaining=deadline-System.nanoTime();
        if(remaining<=0) throw new SocketTimeoutException("health deadline");
        return (int)Math.min(4000, Math.max(1,TimeUnit.NANOSECONDS.toMillis(remaining)));
    }
    public static void main(String[] args) throws Exception {
        if(Process.myUid()!=0) return;
        try(RandomAccessFile lockFile=new RandomAccessFile(new File(BASE,"lock"),"rw")) {
            FileLock lock=lockFile.getChannel().tryLock(); if(lock==null) return;
            try {
                try(FileOutputStream out=new FileOutputStream(new File(BASE,"pid"))) { out.write(Integer.toString(Process.myPid()).getBytes("US-ASCII")); }
                long last=0, lastDiscovery=0, started=android.os.SystemClock.elapsedRealtime();
                int failures=0, missingSamples=0;
                boolean lastHealthy=false, recovering=false;
                ProcessIdentity process=null;
                ArrayList<Long> attempts=new ArrayList<>();
                // Persist repair limits across daemon restart, including clock rollback.
                File repairs=new File(BASE,"repairs");
                if(repairs.isFile()) for(String s:read(repairs).trim().split(",")) try { attempts.add(Long.parseLong(s)); } catch(Exception ignored) {}
                while(new File(BASE,"enabled").isFile()) {
                    try {
                        File stateFile=new File("/data/user/0/"+PACKAGE+"/no_backup/bridge-monitor-state.json");
                        if(!stateFile.isFile()) { status("等待首次解锁或应用配置；不自动开启服务"); Thread.sleep(RootMonitorPolicy.waitForState(started,android.os.SystemClock.elapsedRealtime())); continue; }
                        JSONObject state=new JSONObject(read(stateFile));
                        if(!state.optBoolean("enabled") || !state.optBoolean("monitor")) {
                            failures=0; missingSamples=0; last=0; recovering=false;
                            status("服务或自动检测已手动关闭；不会拉起"); Thread.sleep(5000); continue;
                        }
                        long now=System.currentTimeMillis(); int minutes=Math.max(1,Math.min(1440,state.optInt("minutes",5)));
                        long elapsed=android.os.SystemClock.elapsedRealtime();
                        File checkNow=new File(BASE,"check-now"); boolean force=checkNow.delete();
                        boolean cachedDied=process!=null && !process.alive();
                        if(cachedDied) process=null;
                        if(process==null && (cachedDied || missingSamples==1 || lastDiscovery==0 || elapsed-lastDiscovery>=5000)) {
                            process=discoverProcess(); lastDiscovery=elapsed;
                        }
                        boolean running=process!=null;
                        boolean confirmedProcessLoss=cachedDied && !running;
                        missingSamples=RootMonitorPolicy.missingSamples(running,confirmedProcessLoss,missingSamples);
                        boolean probed=confirmedProcessLoss || RootMonitorPolicy.probeDue(elapsed,last,minutes,force,missingSamples==1,failures,recovering);
                        if(probed) {
                            // A verified dead app cannot own HTTPS. Avoid a redundant network wait
                            // and a second one-second sample; live-process failures still need probes.
                            lastHealthy=!confirmedProcessLoss && serviceHealthy(state.optBoolean("peer"),running,state.optString("host",""));
                            last=android.os.SystemClock.elapsedRealtime(); failures=lastHealthy?0:failures+1;
                            recovering=false;
                        }
                        if(probed || RootMonitorPolicy.recoveryNeeded(lastHealthy,failures,missingSamples)) {
                            attempts.removeIf(t -> now>=t && now-t>=3600000L);
                            boolean cooldown=false; for(long t:attempts) if(t>now || now-t<60000) cooldown=true;
                            if(RootMonitorPolicy.recoveryNeeded(lastHealthy,failures,missingSamples) && attempts.size()<3 && !cooldown) {
                                // Re-read the desired state immediately before a recovery to honor manual stop.
                                JSONObject latest=new JSONObject(read(stateFile));
                                if(latest.optBoolean("enabled") && latest.optBoolean("monitor") && new File(BASE,"enabled").isFile()) {
                                    attempts.add(now);
                                    try(FileOutputStream out=new FileOutputStream(repairs)) {
                                        StringBuilder saved=new StringBuilder(); for(long t:attempts) saved.append(t).append(',');
                                        out.write(saved.toString().getBytes("UTF-8"));
                                    }
                                    boolean requested=command("/system/bin/am","start-foreground-service","--user","0","-n",COMPONENT,"-a",PACKAGE+".RECOVER");
                                    if(!requested && !running) {
                                        requested=command("/system/bin/am","broadcast","--user","0","--include-stopped-packages",
                                                "-n",PACKAGE+"/me.capcom.smsgateway.modules.iphone.RootRecoveryReceiver","-a",PACKAGE+".RECOVER");
                                    }
                                    recovering=requested; last=android.os.SystemClock.elapsedRealtime(); lastDiscovery=0;
                                    status(requested?"已请求恢复服务，等待下次检查确认":"系统拒绝恢复，请打开应用检查");
                                }
                            } else if(probed) status(lastHealthy?(state.optBoolean("peer")?"Root 从设备守护：应用进程正常；每 "+minutes+" 分钟唤醒共享服务，1 秒轻量检查进程":"Root 守护正常；本机 HTTPS 正常；每 "+minutes+" 分钟完整检测，1 秒轻量检查进程"):(state.optBoolean("peer")?"从设备应用进程未运行；等待复检或恢复冷却（每小时最多 3 次）":"HTTPS 未通过检测；等待复检或恢复冷却（每小时最多 3 次）"));
                            if(probed && lastHealthy) {
                                if(state.optBoolean("peer")) {
                                    command("/system/bin/am","start-foreground-service","--user","0","-n",COMPONENT,
                                            "-a",PACKAGE+".CHECK","--ez","force_check",Boolean.toString(force));
                                } else {
                                    command("/system/bin/am","start-foreground-service","--user","0","-n",COMPONENT,
                                            "-a",PACKAGE+".CHECK","--ez","force_check",Boolean.toString(force),
                                            "--es","checked_https_host",state.optString("host",""),
                                            "--el","checked_https_elapsed",Long.toString(last));
                                }
                            }
                        }
                    } catch(Exception ignored) { status("检测暂时失败，稍后重试；不会重发短信"); }
                    Thread.sleep(1000);
                }
                status("Root 守护已关闭");
            } finally { lock.release(); }
        }
    }
}
