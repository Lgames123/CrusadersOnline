#!/usr/bin/env python3
"""Read-only structural probe for the original game's .mdl files (research only).

Usage:
  python -I tools/re/mdl_probe.py <Models dir>            # validate layout over every file
  python -I tools/re/mdl_probe.py <file.mdl> [--nodes]    # dump one file

Never writes to the input directory. Findings are documented in
docs/reverse-engineering/asset-format-discovery.md (MDL section).
"""
import struct
import sys
from pathlib import Path

HEADER_SIZE = 0x74
NODE_SIZE = 56
VERT_SIZE = 12
FACE_SIZE = 50
SPHERE_SIZE = 20  # u32 node, f32 x, y, z, radius
LINE_DUMMY_SIZE = 44
XFRM_DUMMY_SIZE = 32


def u32(b, o):
    return struct.unpack_from('<I', b, o)[0]


def parse(b):
    h = {
        'nodes': u32(b, 0x00),
        'faces': u32(b, 0x08),
        'verts': u32(b, 0x14),
        'names_size': u32(b, 0x2C),
        'spheres': u32(b, 0x30),
        'line_dummies': u32(b, 0x34),
        'xfrm_dummies': u32(b, 0x38),
        'bbox_min': struct.unpack_from('<3f', b, 0x4C),
        'bbox_max': struct.unpack_from('<3f', b, 0x58),
        'sphere_center': struct.unpack_from('<3f', b, 0x64),
        'sphere_radius': struct.unpack_from('<f', b, 0x70)[0],
    }
    o = HEADER_SIZE
    nodes = []
    for _ in range(h['nodes']):
        idx, parent = struct.unpack_from('<Hh', b, o)
        nodes.append({
            'off': o,
            'id': idx,
            'parent': parent,
            'a': struct.unpack_from('<3f', b, o + 4),
            'b': struct.unpack_from('<4f', b, o + 16),
            'verts': u32(b, o + 32),
            'u16_52': struct.unpack_from('<H', b, o + 52)[0],
        })
        o += NODE_SIZE
    h['verts_off'] = o
    o += h['verts'] * VERT_SIZE
    h['faces_off'] = o
    o += h['faces'] * FACE_SIZE
    h['normals_off'] = o
    o += h['verts'] * VERT_SIZE
    h['names_off'] = o
    names = b[o:o + h['names_size']].split(b'\0')
    o += h['names_size']
    h['spheres_off'] = o
    o += h['spheres'] * SPHERE_SIZE
    h['line_dummies_off'] = o
    o += h['line_dummies'] * LINE_DUMMY_SIZE
    h['xfrm_dummies_off'] = o
    o += h['xfrm_dummies'] * XFRM_DUMMY_SIZE
    h['expected_size'] = o
    return h, nodes, [n.decode('latin-1') for n in names if n]


def validate(directory):
    files = sorted(Path(directory).glob('*.mdl'))
    bad = []
    for f in files:
        b = f.read_bytes()
        try:
            h, nodes, names = parse(b)
        except struct.error as e:
            bad.append((f.name, f'struct error {e}'))
            continue
        if h['expected_size'] != len(b):
            bad.append((f.name, f"size {len(b)} expected {h['expected_size']} (diff {len(b) - h['expected_size']})"))
        elif sum(n['verts'] for n in nodes) != h['verts']:
            bad.append((f.name, 'node vertex counts do not sum to header'))
    print(f'{len(files) - len(bad)}/{len(files)} files match the layout')
    for name, why in bad[:30]:
        print('  MISMATCH', name, why)


def dump(path, show_nodes):
    b = Path(path).read_bytes()
    h, nodes, names = parse(b)
    print(Path(path).name, len(b), 'bytes')
    for k, v in h.items():
        print(f'  {k}: {v}')
    print('  names:', names)
    if show_nodes:
        for i, n in enumerate(nodes):
            nm = names[i + 1] if i + 1 < len(names) else '?'
            print(f"  node[{i}] @{n['off']:#x} id={n['id']} parent={n['parent']} verts={n['verts']} "
                  f"a={[round(x, 3) for x in n['a']]} b={[round(x, 3) for x in n['b']]} u16_52={n['u16_52']} name={nm}")


if __name__ == '__main__':
    target = Path(sys.argv[1])
    if target.is_dir():
        validate(target)
    else:
        dump(target, '--nodes' in sys.argv)
