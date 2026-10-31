package me.capcom.smsgateway.modules.iphone;

/** Light process polling is independent of the expensive HTTPS schedule. */
final class RootMonitorPolicy {
    static int missingSamples(boolean running, boolean observedDeath, int previous) {
        // A cached identity died AND a fresh exact-package lookup found no replacement.
        // That is stronger evidence than the first empty discovery after monitor startup.
        return running ? 0 : observedDeath ? 2 : Math.min(2,previous+1);
    }
    static boolean probeDue(long elapsed, long last, int minutes, boolean force,
                            boolean firstMissing, int failures, boolean recovering) {
        if(force || last==0 || elapsed<last || elapsed-last>=minutes*60000L) return true;
        if(firstMissing) return true;
        return (recovering && elapsed-last>=2000) || (failures>0 && elapsed-last>=10000);
    }
    static boolean recoveryNeeded(boolean healthy, int failures, int missingSamples) {
        return !healthy && (failures>=2 || missingSamples>=2);
    }
    static long waitForState(long started, long elapsed) {
        return elapsed-started<120000 ? 1000 : 5000;
    }
}
