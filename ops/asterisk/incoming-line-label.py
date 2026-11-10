#!/usr/bin/python3
"""Display an authenticated gateway and actual incoming SIM without changing caller number."""
import re
import json
from pathlib import Path
import signal
import sys

DEVICES = {'2001': '主设备', '2002': '从设备'}
PREFIXES = {'2001': {'1': '*81*', '2': '*82*'}, '2002': {'1': '*83*', '2': '*84*'}}


def configured_names(endpoint, slot):
    path = Path('/usr/local/lib/asterisk-callerid/incoming-line-names.json')
    try:
        if path.stat().st_size > 65536:
            return None
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            return None
        value = data.get(PREFIXES.get(endpoint, {}).get(slot))
        if not isinstance(value, dict):
            return None
        names = [value.get(key) for key in ('phone', 'sim')]
        if all(isinstance(s, str) and 0 < len(s) <= 60 and s.isprintable() for s in names):
            return names
    except (OSError, ValueError, TypeError):
        pass
    return None


def label(endpoint, slot, number, name, presentation):
    device = DEVICES.get(endpoint)
    if not device:
        return None
    line = 'SIM ' + slot if slot in ('1', '2') else 'SIM 未识别'
    names = configured_names(endpoint, slot)
    if names:
        device, line = names
    device = device.replace('"', '').replace('\\', '')
    line = line.replace('"', '').replace('\\', '')
    # Never disclose restricted identity, even if Android supplied a hidden number/name.
    if not re.fullmatch(r'allowed(?:_[a-z_]+)?', presentation):
        identity = '匿名来电'
    else:
        identity = name.strip() if name and name != 'unknown' else number.strip()
        identity = identity or '未知来电'
    identity = ''.join(c for c in identity if c.isprintable()).replace('"', '').replace('\\', '')[:96]
    return device + ' · ' + line + '｜' + identity


def query(expression):
    print('GET FULL VARIABLE ${' + expression + '}', flush=True)
    reply = sys.stdin.readline(4096).rstrip('\r\n')
    match = re.fullmatch(r'200 result=1 \((.*)\)', reply)
    if match:
        return match.group(1)
    if reply == '200 result=0':
        return ''
    raise RuntimeError('AGI query failed')


def main():
    for _ in range(128):
        if not sys.stdin.readline(4096).strip():
            break
    endpoint = query('CHANNEL(endpoint)')
    if endpoint not in DEVICES:
        return
    slot = query('PJSIP_HEADER(read,X-VSA-SIM)')
    # More than one slot header is ambiguous, so never attribute a guessed SIM.
    if query('PJSIP_HEADER(read,X-VSA-SIM,2)'):
        slot = ''
    presentation = query('CALLERID(num-pres)')
    number, name = '', ''
    if re.fullmatch(r'allowed(?:_[a-z_]+)?', presentation):
        number = query('CALLERID(num)')
        name = query('CALLERID(name)')
    result = label(endpoint, slot, number, name, presentation)
    if result:
        print('SET VARIABLE CALLERID(name) "' + result + '"', flush=True)
        sys.stdin.readline(4096)


if __name__ == '__main__':
    try:
        signal.signal(signal.SIGALRM, lambda *_: sys.exit(0))
        signal.alarm(2)
        main()
    except Exception:
        pass  # Fail open and never log caller identity or the AGI environment.
