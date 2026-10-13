/**
 * Windows string-table resources (RT_STRING) of a PE file: the quest book's text lives in
 * crusaders.exe's string table (LoadStringA from the quest book page 0x456240), ids 3000+.
 * Strings come in blocks of 16 (block id = (string id >> 4) + 1), each a UTF-16 length-prefixed
 * string.
 */
export class PeError extends Error {}

const RT_STRING = 6;

export function parsePeStrings(bytes: Uint8Array): Map<number, string> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x40 || dv.getUint16(0, true) !== 0x5a4d) throw new PeError('not a PE file');
  const pe = dv.getUint32(0x3c, true);
  if (pe + 0x18 > bytes.length || dv.getUint32(pe, true) !== 0x4550) throw new PeError('bad PE header');
  const sections = dv.getUint16(pe + 6, true);
  const optSize = dv.getUint16(pe + 20, true);
  const opt = pe + 24;
  // Data directory 2 (resources); PE32 optional header: directories start at +96.
  const rsrcRva = dv.getUint32(opt + 96 + 2 * 8, true);
  const secs: { va: number; size: number; raw: number }[] = [];
  for (let i = 0; i < sections; i++) {
    const o = opt + optSize + 40 * i;
    secs.push({ va: dv.getUint32(o + 12, true), size: Math.max(dv.getUint32(o + 8, true), dv.getUint32(o + 16, true)), raw: dv.getUint32(o + 20, true) });
  }
  const off = (rva: number): number => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.size);
    if (!s) throw new PeError(`rva ${rva.toString(16)} outside the sections`);
    return s.raw + rva - s.va;
  };
  const out = new Map<number, string>();
  if (!rsrcRva) return out;
  const base = off(rsrcRva);
  const entries = (dir: number): [number, number][] => {
    const n = dv.getUint16(dir + 12, true) + dv.getUint16(dir + 14, true);
    return Array.from({ length: n }, (_, i) => [dv.getUint32(dir + 16 + 8 * i, true), dv.getUint32(dir + 20 + 8 * i, true)] as [number, number]);
  };
  const utf16 = new TextDecoder('utf-16le');
  for (const [type, typeDir] of entries(base)) {
    if (type !== RT_STRING || !(typeDir & 0x80000000)) continue;
    for (const [block, blockDir] of entries(base + (typeDir & 0x7fffffff))) {
      if (!(blockDir & 0x80000000)) continue;
      for (const [, leaf] of entries(base + (blockDir & 0x7fffffff))) {
        if (leaf & 0x80000000) continue;
        let p = off(dv.getUint32(base + leaf, true));
        for (let k = 0; k < 16; k++) {
          const n = dv.getUint16(p, true);
          p += 2;
          if (n) out.set((block - 1) * 16 + k, utf16.decode(bytes.subarray(p, p + 2 * n)));
          p += 2 * n;
        }
      }
    }
  }
  return out;
}
