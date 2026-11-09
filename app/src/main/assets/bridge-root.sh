#!/system/bin/sh
# sms-bridge-owned-v1
BASE=/data/adb/sms-bridge
[ -L "$BASE" ] && exit 1
[ -f "$BASE/enabled" ] || exit 0
umask 077
BB=/data/adb/magisk/busybox
# The supervisor has a kernel-owned lock: a stale PID file cannot block boot.
# Require a locked supervisor on every supported Root framework.
if [ ! -x "$BB" ]; then
  for candidate in /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox; do
    if [ -x "$candidate" ]; then BB="$candidate"; break; fi
  done
fi
if [ ! -x "$BB" ]; then
  echo '未找到 Root BusyBox，请检查 Magisk / KernelSU / APatch 安装' > "$BASE/status"
  exit 1
fi
# Android mksh closes numbered descriptors on exec. BusyBox ash preserves fd 9
# for the flock applet; workers explicitly close it so they cannot pin the lock.
if [ "$1" != --ash ]; then exec "$BB" ash "$BASE/run.sh" --ash; fi
exec 9> "$BASE/supervisor.lock"
attempts=0
locked=
while [ -f "$BASE/enabled" ] && [ "$attempts" -lt 15 ]; do
  if "$BB" flock -n 9; then locked=yes; break; fi
  attempts=$((attempts + 1))
  sleep 1 9>&-
done
[ "$locked" = yes ] || exit 1
echo $$ > "$BASE/supervisor.pid"
child=
sleeper=
pause() { sleep "$1" 9>&- & sleeper=$!; wait "$sleeper"; sleeper=; }
cleanup() {
  [ -n "$child" ] && kill "$child" 2>/dev/null
  [ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null
  rm -f "$BASE/supervisor.pid"
}
trap 'exit 0' INT TERM
trap cleanup EXIT
delay=0
while [ -f "$BASE/enabled" ]; do
  if [ "$(getprop sys.boot_completed 9>&-)" != 1 ]; then pause 1; continue; fi
  APK=$(exec 9>&-; "$BB" timeout -s KILL 15 /system/bin/cmd package path me.capcom.smsgateway.iphone 2>/dev/null | sed -n 's/^package://p' | head -n 1)
  if [ ! -f "$APK" ]; then pause 30; continue; fi
  ACTUAL=$(exec 9>&-; "$BB" timeout -s KILL 30 /system/bin/sha256sum "$APK" | cut -d ' ' -f 1)
  EXPECTED=$(cat "$BASE/apk.sha256" 2>/dev/null 9>&-)
  if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
    echo '等待应用刷新已授权的 Root 守护；首次解锁前不会读取私密配置' > "$BASE/status"
    pause 30
    continue
  fi
  started=$(date +%s 9>&-)
  CLASSPATH="$APK" app_process /system/bin me.capcom.smsgateway.modules.iphone.RootMonitorMain >/dev/null 2>&1 9>&- &
  child=$!
  wait "$child"
  child=
  [ -f "$BASE/enabled" ] || break
  ended=$(date +%s 9>&-)
  [ $((ended - started)) -ge 300 ] && delay=0
  echo "独立检查进程已退出，${delay} 秒后重试" > "$BASE/status"
  [ "$delay" -eq 0 ] || pause "$delay"
  if [ "$delay" -eq 0 ]; then delay=1; else delay=$((delay * 2)); fi
  [ "$delay" -gt 300 ] && delay=300
done
