#!/usr/bin/env python3
"""Read-only structural check of .ani animation files against the models that use them.

Usage: python -I tools/re/ani_probe.py "<game dir>"

For every animation bound to a model in script/models.ctx, walks the keyframe stream with the
model's node count and checks that it consumes exactly the declared data size. Layout:
docs/reverse-engineering/asset-format-discovery.md (ANI section).
"""
import re
import struct
import sys
from pathlib import Path

HEADER = 0x38


def walk(blob, bones):
    """Returns bytes consumed, or raises ValueError."""
    words = len(blob) // 4
    u = lambda i: struct.unpack_from('<I', blob, i * 4)[0]
    i = 0
    flags = 0
    for b in range(bones):
        if flags == 0:
            flags = u(i); i += 1
        if flags & 2:
            if flags & 1:
                n = u(i)
                if n == 0 or n > 10000: raise ValueError(f'bone {b}: bad rotation key count {n}')
                i += 17 * n + 2
            else:
                i += 4
        if flags & 8:
            if flags & 4:
                n = u(i)
                if n == 0 or n > 10000: raise ValueError(f'bone {b}: bad translation key count {n}')
                i += 13 * n + 2
            else:
                i += 3
        if i > words: raise ValueError(f'bone {b}: ran past end')
        flags >>= 4
    return i * 4


def main(game):
    game = Path(game)
    text = (game / 'script' / 'models.ctx').read_text('latin-1')
    pairs = set()
    model = None
    for line in text.splitlines():
        line = line.split('#')[0].strip()
        if not line: continue
        parts = line.split()
        if parts[0] == 'N' and len(parts) >= 3: model = parts[2].lower()
        elif parts[0] in ('L', 'B') and model and parts[-1].lower().endswith('.ani'): pairs.add((model, parts[-1].lower()))
    files = {p.name.lower(): p for p in (game / 'Models').iterdir()}
    ok = bad = missing = 0
    for mdl, ani in sorted(pairs):
        if mdl not in files or ani not in files: missing += 1; continue
        nodes = struct.unpack_from('<I', files[mdl].read_bytes(), 0)[0]
        data = files[ani].read_bytes()
        size = struct.unpack_from('<I', data, 0x34)[0]
        blob = data[HEADER:HEADER + size]
        try:
            used = walk(blob, nodes)
            trailer_ok = len(data) >= HEADER + size + 8
            if used == size and trailer_ok: ok += 1
            else:
                bad += 1
                if bad <= 15: print(f'MISMATCH {mdl} {ani}: used {used} of {size} (bones {nodes})')
        except (ValueError, struct.error) as e:
            bad += 1
            if bad <= 15: print(f'ERROR {mdl} {ani}: {e}')
    print(f'{ok} model/animation pairs consume exactly their data, {bad} mismatches, {missing} missing files')


if __name__ == '__main__':
    main(sys.argv[1])
