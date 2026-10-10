"""PKWARE Data Compression Library "explode" decoder (the format zlib's contrib/blast.c
decodes), written from the published format description. Used to unpack the level `.msh` files
for reverse engineering; reads untrusted input defensively and never executes anything.

Usage: python -I tools/re/pkware_dcl.py <file> [offset] [out]
"""
import sys


class DclError(Exception):
    pass


def _construct(lengths):
    """Canonical Huffman table from code lengths (blast.c style): returns (count, symbol)."""
    count = [0] * 14
    for ln in lengths:
        count[ln] += 1
    offs = [0] * 14
    for i in range(1, 13):
        offs[i + 1] = offs[i] + count[i]
    symbol = [0] * len(lengths)
    for sym, ln in enumerate(lengths):
        if ln:
            symbol[offs[ln]] = sym
            offs[ln] += 1
    return count, symbol


def _expand(rep):
    """Code lengths are stored as (count << 4 | length) bytes."""
    out = []
    for b in rep:
        out.extend([b & 15] * ((b >> 4) + 1))
    return out


LITLEN = [11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173]
LENLEN = [2, 35, 36, 53, 38, 23]
DISTLEN = [2, 20, 53, 230, 247, 151, 248]
BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264]
EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]

LIT = _construct(_expand(LITLEN))
LEN = _construct(_expand(LENLEN))
DIST = _construct(_expand(DISTLEN))


class _Bits:
    def __init__(self, data, pos):
        self.data, self.pos, self.buf, self.cnt = data, pos, 0, 0

    def bits(self, need):
        while self.cnt < need:
            if self.pos >= len(self.data):
                raise DclError('unexpected end of input')
            self.buf |= self.data[self.pos] << self.cnt
            self.pos += 1
            self.cnt += 8
        v = self.buf & ((1 << need) - 1)
        self.buf >>= need
        self.cnt -= need
        return v

    def decode(self, table):
        """Codes are stored bit-inverted, MSB first within the code."""
        count, symbol = table
        code = first = index = 0
        for ln in range(1, 14):
            code |= self.bits(1) ^ 1
            c = count[ln]
            if code < first + c:
                return symbol[index + (code - first)]
            index += c
            first = (first + c) << 1
            code <<= 1
        raise DclError('bad code')


def explode(data, pos=0, limit=1 << 28):
    """Decodes one DCL stream starting at `pos`. Returns (output bytes, end position)."""
    s = _Bits(data, pos)
    lit = s.bits(8)
    if lit > 1:
        raise DclError('bad literal flag')
    dictbits = s.bits(8)
    if dictbits < 4 or dictbits > 6:
        raise DclError('bad dictionary size')
    out = bytearray()
    while True:
        if s.bits(1):
            sym = s.decode(LEN)
            ln = BASE[sym] + s.bits(EXTRA[sym])
            if ln == 519:
                break  # end code
            sym = 2 if ln == 2 else dictbits
            dist = (s.decode(DIST) << sym) + s.bits(sym) + 1
            if dist > len(out):
                raise DclError('distance too far back')
            for _ in range(ln):
                out.append(out[-dist])
        else:
            out.append(s.decode(LIT) if lit else s.bits(8))
        if len(out) > limit:
            raise DclError('output too large')
    return bytes(out), s.pos


if __name__ == '__main__':
    raw = open(sys.argv[1], 'rb').read()
    off = int(sys.argv[2], 0) if len(sys.argv) > 2 else 0
    data, end = explode(raw, off)
    print(f'{len(data)} bytes from {off:#x}..{end:#x} of {len(raw)}')
    if len(sys.argv) > 3:
        open(sys.argv[3], 'wb').write(data)
