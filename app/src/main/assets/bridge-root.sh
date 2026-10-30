#!/system/bin/sh
# sms-bridge-owned-v1
BASE=/data/adb/sms-bridge
[ -L "$BASE" ] && exit 1
[ -f "$BASE/enabled" ] || exit 0
while [ "$(getprop sys.boot_completed)" != 1 ]; do sleep 10; done
APK=$(pm path me.capcom.smsgateway.iphone | sed -n 's/^package://p' | head -n 1)
[ -f "$APK" ] || exit 1
ACTUAL=$(sha256sum "$APK" | cut -d ' ' -f 1)
EXPECTED=$(cat "$BASE/apk.sha256")
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo '安装包已更新，请在应用中重新启用 Root 守护' > "$BASE/status"
  exit 1
fi
export CLASSPATH="$APK"
exec app_process /system/bin me.capcom.smsgateway.modules.iphone.RootMonitorMain
