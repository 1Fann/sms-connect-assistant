"""Exercise the real supervisor with fake Android commands, without a phone or SMS.

Run with Python 3, passing --shell /path/to/sh when sh is not on PATH.
The lock command is mocked here; kernel flock exclusivity needs Magisk device QA.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SHELL = shutil.which("sh")
if "--shell" in sys.argv:
    index = sys.argv.index("--shell")
    SHELL = sys.argv[index + 1]
    del sys.argv[index:index + 2]
SOURCE = Path(__file__).resolve().parents[1] / "app/src/main/assets/bridge-root.sh"


@unittest.skipUnless(SHELL, "POSIX sh required")
class RootSupervisorTest(unittest.TestCase):
    def run_guard(self, scenario, expected="approved", enabled=True, framework="magisk"):
        with tempfile.TemporaryDirectory(prefix="sms-supervisor-") as directory:
            root = Path(directory)
            base, commands = root / "guard", root / "bin"
            base.mkdir()
            commands.mkdir()
            if enabled:
                (base / "enabled").touch()
            (base / "apk.sha256").write_text(expected)
            apk = root / "app.apk"
            apk.write_text("fake fixture, never executed")
            script = base / "run.sh"
            # Only the installation location is changed; the control flow is real.
            script.write_text(SOURCE.read_text(encoding="utf-8").replace(
                "BASE=/data/adb/sms-bridge", 'BASE="$TEST_BASE"').replace(
                "BB=/data/adb/magisk/busybox", 'BB="$TEST_BB"' if framework=="magisk" else 'BB="/missing/magisk/busybox"').replace(
                "/data/adb/ksu/bin/busybox", (commands / "busybox").as_posix() if framework=="kernelsu" else "/missing/ksu/busybox"), encoding="utf-8", newline="\n")
            mocks = {
                "getprop": 'if [ "$SCENARIO" = boot ] && [ ! -f "$TEST_BASE/paused" ]; then echo 0; else echo 1; fi',
                "cmd": 'printf "package:%s\\n" "$TEST_APK"',
                "sha256sum": 'echo "approved  fixture"',
                "date": '''count=0
                    [ ! -f "$TEST_BASE/time-count" ] || read -r count < "$TEST_BASE/time-count"
                    count=$((count+1)); echo "$count" > "$TEST_BASE/time-count"
                    if [ "$SCENARIO" = stable ] && [ "$count" -ge 4 ]; then echo 1400; else echo 1000; fi''',
                "busybox": '''if [ "$1" = ash ]; then shift; exec sh "$@"; fi
                    [ "$1" = flock ] && exit 0
                    [ "$1" = timeout ] || exit 2
                    if ( : >&9 ) 2>/dev/null; then echo leak > "$TEST_BASE/fd-leak"; fi
                    shift 4
                    command=${1##*/}; shift
                    exec "$command" "$@"''',
                "sleep": '''echo "$1" >> "$TEST_BASE/pauses"
                    if ( : >&9 ) 2>/dev/null; then echo leak > "$TEST_BASE/fd-leak"; fi
                    echo yes > "$TEST_BASE/paused"
                    if [ "$SCENARIO" = mismatch ]; then rm -f "$TEST_BASE/enabled"; fi''',
                "app_process": '''count=0
                    if ( : >&9 ) 2>/dev/null; then echo leak > "$TEST_BASE/fd-leak"; fi
                    if [ -f "$TEST_BASE/count" ]; then read -r count < "$TEST_BASE/count"; fi
                    count=$((count+1)); echo "$count" > "$TEST_BASE/count"
                    case "$SCENARIO" in
                        crash|stable) [ "$count" -lt 3 ] || rm -f "$TEST_BASE/enabled";;
                        many) [ "$count" -lt 12 ] || rm -f "$TEST_BASE/enabled";;
                        *) rm -f "$TEST_BASE/enabled";;
                    esac
                    exit 9''',
            }
            for name, content in mocks.items():
                target = commands / name
                target.write_text("#!/bin/sh\n" + content + "\n", encoding="utf-8", newline="\n")
                target.chmod(0o755)
            env = dict(os.environ, TEST_BASE=base.as_posix(), TEST_APK=apk.as_posix(), TEST_BB=(commands / "busybox").as_posix(), SCENARIO=scenario)
            env["PATH"] = str(commands) + os.pathsep + str(Path(SHELL).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run([SHELL, str(script)], env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(0, result.returncode, result.stderr)
            count = int((base / "count").read_text()) if (base / "count").exists() else 0
            pauses = (base / "pauses").read_text().splitlines() if (base / "pauses").exists() else []
            status = (base / "status").read_text(encoding="utf-8") if (base / "status").exists() else ""
            self.assertFalse((base / "supervisor.pid").exists(), "exit must clean its PID marker")
            self.assertFalse((base / "fd-leak").exists(), "children must not retain the supervisor lock")
            return count, pauses, status

    def test_kernelsu_busybox_without_magisk_runs_the_supervisor(self):
        count, pauses, _ = self.run_guard("crash", framework="kernelsu")
        self.assertEqual(3, count)
        self.assertEqual(["1"], pauses)

    def test_crash_restarts_with_backoff_and_stops_when_disabled(self):
        count, pauses, _ = self.run_guard("crash")
        self.assertEqual(3, count)
        self.assertEqual(["1"], pauses)

    def test_repeated_crashes_back_off_instead_of_spinning(self):
        count, pauses, _ = self.run_guard("many")
        self.assertEqual(12,count)
        self.assertEqual(["1","2","4","8","16","32","64","128","256","300"],pauses)

    def test_stable_worker_resets_first_failure_delay(self):
        count, pauses, _ = self.run_guard("stable")
        self.assertEqual(3,count)
        self.assertEqual([],pauses)

    def test_changed_apk_is_never_executed(self):
        count, pauses, status = self.run_guard("mismatch", expected="previous-build")
        self.assertEqual(0, count)
        self.assertEqual(["30"], pauses)
        self.assertIn("等待应用刷新", status)

    def test_empty_digest_is_never_executed(self):
        self.assertEqual(0, self.run_guard("mismatch", expected="")[0])

    def test_waits_for_boot_then_starts(self):
        count, pauses, _ = self.run_guard("boot")
        self.assertEqual(1, count)
        self.assertEqual(["1"], pauses)

    def test_disabled_guard_never_starts(self):
        self.assertEqual(0, self.run_guard("crash", enabled=False)[0])


if __name__ == "__main__":
    unittest.main()
