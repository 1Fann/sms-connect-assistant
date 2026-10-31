package me.capcom.smsgateway.modules.iphone;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Cache identity, not just PID: Linux can reuse a dead application's PID. */
final class ProcessIdentity {
    private final File directory;
    private final String startTime;
    private ProcessIdentity(File directory, String startTime) {
        this.directory=directory; this.startTime=startTime;
    }
    static ProcessIdentity capture(File proc, int pid, String packageName) throws IOException {
        File directory=new File(proc,Integer.toString(pid));
        String command=read(new File(directory,"cmdline"));
        int zero=command.indexOf('\0');
        if(!packageName.equals(zero<0?command:command.substring(0,zero))) return null;
        String start=startTime(read(new File(directory,"stat")));
        return start==null?null:new ProcessIdentity(directory,start);
    }
    boolean alive() throws IOException {
        if(!directory.exists()) return false;
        try { return startTime.equals(startTime(read(new File(directory,"stat")))); }
        catch(IOException e) { if(!directory.exists())return false; throw e; }
    }
    static String startTime(String stat) {
        int end=stat.lastIndexOf(')');
        if(end<0) return null;
        String[] fields=stat.substring(end+1).trim().split("\\s+");
        // Fields start at process state (3); starttime is field 22.
        if(fields.length<=19 || "Z".equals(fields[0]) || "X".equals(fields[0]) || !fields[19].matches("[0-9]+")) return null;
        return fields[19];
    }
    private static String read(File file) throws IOException {
        try(FileInputStream in=new FileInputStream(file)) {
            byte[] bytes=new byte[8192]; int n=in.read(bytes);
            return n<0?"":new String(bytes,0,n,StandardCharsets.UTF_8);
        }
    }
}
