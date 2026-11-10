#!/system/bin/sh
# commlink-incoming-line-names-owned-v1
# Copies only a names-only export from the app. Never reads its database or secrets.
BASE=/data/adb/commlink-line-names
SOURCE=/data/user/0/me.capcom.smsgateway.iphone/no_backup/incoming-line-names.json
DEST=/data/adb/asterisk-app/rootfs/usr/local/lib/asterisk-callerid/incoming-line-names.json
mkdir -p "$BASE"
chmod 700 "$BASE"
BB=
for candidate in /data/adb/magisk/busybox /data/adb/ksu/bin/busybox /data/adb/ap/bin/busybox; do
  if [ -x "$candidate" ]; then BB="$candidate"; break; fi
done
[ -n "$BB" ] || BB=$(command -v busybox)
[ -x "$BB" ] || exit 1
if [ "$1" != --locked ]; then exec "$BB" ash "$0" --locked; fi
exec 9> "$BASE/lock"
"$BB" flock -n 9 || exit 0
while :; do
  if [ -f "$SOURCE" ] && [ ! -L "$SOURCE" ] && [ -d "${DEST%/*}" ] && ! cmp -s "$SOURCE" "$DEST"; then
    TMP="$DEST.new.$$"
    if cp "$SOURCE" "$TMP" && chmod 640 "$TMP" && chown 0:3003 "$TMP"; then
      mv "$TMP" "$DEST"
    else
      rm -f "$TMP"
    fi
  fi
  sleep 2 9>&-
done
