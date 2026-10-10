"""Summarises creature placements in the level `.cap` files of a local installation.

`.cap` layout (asset-format-discovery.md §6): 0x94-byte header (uncompressed size, magic
0xD00D0012, level name) followed by one PKWARE DCL stream holding the level's object records.
Creature records start with the marker 2D 00 00 00 CD CD CD CD; the type id sits at +0x1C and
the instance name at +0x40. Fields are located relative to the "XP block"
(02 00 00 00 | xp:int32 | 3 x 0 | disposition:int32 x 2):
  xp block - 0x1B8: max HP (float32), followed by 200.0
  xp block - 0x118: 11 float32 damage-taken multipliers (SLASH ... DARK)

Prints the most common (HP, XP, resists) per creature type. Reads files only; output stays local.
Usage: python -I tools/re/cap_creatures.py "<install>/Caps" [out.json]
"""
import collections
import glob
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pkware_dcl import DclError, explode  # noqa: E402

RECORD = re.compile(rb'\x2d\x00\x00\x00\xcd\xcd\xcd\xcd')
XP_BLOCK = re.compile(rb'\x02\x00\x00\x00(.{4})\x00{12}(.{4})(.{4})', re.S)
HEADER_BYTES = 0x94


def records(path):
    raw = open(path, 'rb').read()
    data, _ = explode(raw, HEADER_BYTES)
    for m in RECORD.finditer(data):
        a = m.start()
        type_id = struct.unpack_from('<I', data, a + 0x1C)[0]
        name = re.match(rb'[ -~]*', data[a + 0x40:a + 0x80]).group(0).decode('ascii')
        xb = XP_BLOCK.search(data, a + 0x200, a + 0x320)
        if not xb:
            continue
        x = xb.start()
        hp = struct.unpack_from('<f', data, x - 0x1B8)[0]
        resist = [round(v, 3) for v in struct.unpack_from('<11f', data, x - 0x118)]
        yield {
            'type': type_id,
            'name': name,
            'hp': hp,
            'xp': struct.unpack('<i', xb.group(1))[0],
            'disposition': struct.unpack('<i', xb.group(2))[0],
            'resist': resist,
        }


def main():
    caps = sys.argv[1]
    by_type = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(caps, '*.cap'))):
        try:
            for r in records(f):
                r['level'] = os.path.basename(f)
                by_type[r['type']].append(r)
        except DclError as e:
            print(f'{f}: {e}', file=sys.stderr)
    summary = {}
    for t in sorted(by_type):
        rs = by_type[t]
        common = collections.Counter((r['hp'], r['xp'], tuple(r['resist'])) for r in rs).most_common(1)[0]
        (hp, xp, resist), n = common
        base = re.sub(r'\d+$', '', rs[0]['name'])
        summary[t] = {'example': base, 'placements': len(rs), 'hp': hp, 'xp': xp, 'resist': list(resist), 'share': round(n / len(rs), 2)}
        print(f'{t:4} {base:28} n={len(rs):4} hp={hp:7.1f} xp={xp:5} resist={list(resist)} ({n}/{len(rs)})')
    if len(sys.argv) > 2:
        json.dump(summary, open(sys.argv[2], 'w'), indent=1)


if __name__ == '__main__':
    main()
