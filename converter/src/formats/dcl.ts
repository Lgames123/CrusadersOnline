/**
 * PKWARE Data Compression Library "explode" decoder, written from the published format
 * description (the format zlib's contrib/blast decodes). The original level files (`.msh`,
 * `.cap`) store their memory images in this format. Pure; safe on untrusted input (bounded
 * output, every read checked).
 */
export class DclError extends Error {}

interface Huffman {
  count: Int16Array;
  symbol: Int16Array;
}

function construct(rep: readonly number[]): Huffman {
  const lengths: number[] = [];
  for (const b of rep) for (let i = 0; i <= b >> 4; i++) lengths.push(b & 15);
  const count = new Int16Array(14);
  for (const len of lengths) count[len]!++;
  const offs = new Int16Array(14);
  for (let i = 1; i < 13; i++) offs[i + 1] = offs[i]! + count[i]!;
  const symbol = new Int16Array(lengths.length);
  lengths.forEach((len, sym) => {
    if (len) symbol[offs[len]!++] = sym;
  });
  return { count, symbol };
}

// Code-length tables of the format (count << 4 | length, run-length encoded).
const LITLEN = [11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173];
const LENLEN = [2, 35, 36, 53, 38, 23];
const DISTLEN = [2, 20, 53, 230, 247, 151, 248];
const BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

let tables: { lit: Huffman; len: Huffman; dist: Huffman } | null = null;

/**
 * Decodes one DCL stream starting at `offset`. Returns the output and the offset just past the
 * stream. `expectedSize`, when known, preallocates and bounds the output.
 */
export function explode(input: Uint8Array, offset = 0, expectedSize?: number, maxSize = 64 << 20): { data: Uint8Array; end: number } {
  tables ??= { lit: construct(LITLEN), len: construct(LENLEN), dist: construct(DISTLEN) };
  const { lit: LIT, len: LEN, dist: DIST } = tables;
  let pos = offset;
  let buf = 0;
  let cnt = 0;
  const bits = (need: number): number => {
    while (cnt < need) {
      if (pos >= input.length) throw new DclError('unexpected end of input');
      buf |= input[pos++]! << cnt;
      cnt += 8;
    }
    const v = buf & ((1 << need) - 1);
    buf >>>= need;
    cnt -= need;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 14; len++) {
      code |= bits(1) ^ 1; // codes are stored bit-inverted
      const c = h.count[len]!;
      if (code < first + c) return h.symbol[index + (code - first)]!;
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw new DclError('bad code');
  };

  const literalCoded = bits(8);
  if (literalCoded > 1) throw new DclError('bad literal flag');
  const dictBits = bits(8);
  if (dictBits < 4 || dictBits > 6) throw new DclError('bad dictionary size');

  let out = new Uint8Array(expectedSize ?? 1 << 16);
  let n = 0;
  const grow = (need: number) => {
    if (need <= out.length) return;
    if (need > maxSize) throw new DclError('output too large');
    const next = new Uint8Array(Math.min(maxSize, Math.max(need, out.length * 2)));
    next.set(out.subarray(0, n));
    out = next;
  };
  for (;;) {
    if (bits(1)) {
      const sym = decode(LEN);
      const len = BASE[sym]! + bits(EXTRA[sym]!);
      if (len === 519) break; // end of stream
      const s = len === 2 ? 2 : dictBits;
      const dist = (decode(DIST) << s) + bits(s) + 1;
      if (dist > n) throw new DclError('distance too far back');
      grow(n + len);
      for (let i = 0; i < len; i++, n++) out[n] = out[n - dist]!;
    } else {
      grow(n + 1);
      out[n++] = literalCoded ? decode(LIT) : bits(8);
    }
  }
  return { data: out.subarray(0, n), end: pos };
}
