package me.capcom.smsgateway.modules.iphone;

import java.net.Socket;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Hard deadline also covers repeated TLS handshake reads, not just a single read. */
final class SocketDeadline implements AutoCloseable {
    private static final ScheduledThreadPoolExecutor TIMER = new ScheduledThreadPoolExecutor(1, task -> {
        Thread thread = new Thread(task, "bridge-health-deadline");
        thread.setDaemon(true);
        return thread;
    });
    static { TIMER.setRemoveOnCancelPolicy(true); }
    private final ScheduledFuture<?> future;
    SocketDeadline(Socket socket, long milliseconds) {
        future = TIMER.schedule(() -> {
            try { socket.close(); } catch (Exception ignored) { }
        }, milliseconds, TimeUnit.MILLISECONDS);
    }
    @Override public void close() { future.cancel(false); }
}
