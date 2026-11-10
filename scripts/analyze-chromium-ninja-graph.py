#!/usr/bin/env python3
"""Analyze Chromium's generated Ninja graph for chrome and bounded shard targets."""

import argparse
from collections import Counter
import json
import os
import re
import subprocess
import sys

FO_RE = re.compile(r'(?:^|\s)/Fo(\S+)')
SRC_RE = re.compile(r'(\.\./\.\./[^\s"]+\.(?:cc|cpp|cxx|c|mm|m)|gen/[^\s"]+\.(?:cc|cpp|cxx|c))')
SUBSYSTEM_PREFIXES = (
    'third_party/blink',
    'third_party/dawn',
    'third_party/angle',
    'third_party/webrtc',
    'third_party/protobuf',
    'third_party/perfetto',
    'third_party/abseil-cpp',
    'third_party/boringssl',
    'third_party/icu',
    'third_party/sqlite',
    'third_party/skia',
    'third_party/swiftshader',
    'third_party/pdfium',
    'third_party/tflite',
    'third_party/devtools-frontend',
    'third_party/',
    'v8/',
    'chrome/',
    'content/',
    'components/',
    'services/',
    'net/',
    'gpu/',
    'media/',
    'skia/',
    'ui/',
    'base/',
    'mojo/',
    'ipc/',
    'sql/',
    'url/',
    'crypto/',
    'cc/',
    'viz/',
    'sandbox/',
    'gin/',
    'gen/',
)


def classify_command(line: str):
    low = line.lower()
    if 'clang-cl' in low:
        fo = FO_RE.search(line)
        obj = fo.group(1).strip('"').replace('\\', '/') if fo else None
        src_m = SRC_RE.search(line)
        src = src_m.group(1) if src_m else None
        wrapped = 'sccache' in low
        return ('cxx', obj or src or line, src, wrapped)
    if 'rustc.exe' in low or 'rustc ' in low or 'rustc_wrapper' in low:
        return ('rust', line, None, False)
    if 'lld-link' in low or 'llvm-lib' in low or 'link_wrapper' in low or '/out:' in low:
        return ('link', line, None, False)
    return ('action', line, None, False)


def subsystem_bucket(src_or_obj: str) -> str:
    s = (src_or_obj or '').replace('\\', '/')
    if s.startswith('../../'):
        s = s[6:]
    elif s.startswith('obj/'):
        s = s[4:]
    for prefix in SUBSYSTEM_PREFIXES:
        if s.startswith(prefix):
            return prefix.rstrip('/')
    top = s.split('/', 1)[0] if '/' in s else s
    return top or 'other'


def inspect_targets(ninja_exe: str, out_dir: str, targets: list[str]):
    cmd = [ninja_exe, '-C', out_dir, '-t', 'commands', *targets]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if proc.returncode != 0:
        raise RuntimeError(f'ninja -t commands failed for {targets}: {proc.stderr[-1000:]}')
    counts = Counter()
    cxx_wrapped = 0
    cxx_unwrapped = 0
    cxx_keys = set()
    subsystems = Counter()
    for raw in proc.stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        kind, key, src, wrapped = classify_command(line)
        counts[kind] += 1
        if kind == 'cxx':
            cxx_keys.add(key)
            subsystems[subsystem_bucket(src or key)] += 1
            if wrapped:
                cxx_wrapped += 1
            else:
                cxx_unwrapped += 1
    return {
        'targets': targets,
        'total_commands': sum(counts.values()),
        'counts': dict(counts),
        'cxx_wrapped_with_sccache': cxx_wrapped,
        'cxx_unwrapped': cxx_unwrapped,
        'unique_cxx_objects': len(cxx_keys),
        'top_subsystems': dict(subsystems.most_common(25)),
        '_cxx_keys': cxx_keys,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ninja', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--json-out', required=True)
    parser.add_argument('--shard', action='append', default=[],
                        help='name=target1,target2')
    args = parser.parse_args()

    chrome_info = inspect_targets(args.ninja, args.out, ['chrome'])
    chrome_keys = chrome_info.pop('_cxx_keys')

    shard_results = {}
    shard_key_sets = {}
    union_keys = set()
    for spec in args.shard:
        name, raw_targets = spec.split('=', 1)
        tlist = [t.strip() for t in raw_targets.split(',') if t.strip()]
        info = inspect_targets(args.ninja, args.out, tlist)
        keys = info.pop('_cxx_keys')
        shard_key_sets[name] = keys
        union_keys |= keys
        info['pct_of_chrome_cxx'] = round(100.0 * len(keys) / max(1, len(chrome_keys)), 2)
        shard_results[name] = info

    overlaps = {}
    names = list(shard_key_sets.keys())
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            overlaps[f'{a}__x__{b}'] = len(shard_key_sets[a] & shard_key_sets[b])

    report = {
        'chrome': chrome_info,
        'shards': shard_results,
        'shard_pairwise_cxx_overlap': overlaps,
        'shard_union_unique_cxx': len(union_keys),
        'shard_sum_cxx': sum(len(v) for v in shard_key_sets.values()),
        'shard_union_pct_of_chrome_cxx': round(100.0 * len(union_keys) / max(1, len(chrome_keys)), 2),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
    with open(args.json_out, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
