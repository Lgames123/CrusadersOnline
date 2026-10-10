/**
 * Parser for `script/items.ctx`, the original item definitions:
 *
 *   item "Battle Axe": Axe        // optional quoted name, optional parent
 *   {
 *       Model = 72;               // key = value;
 *       SetDamage(SLASH,8);       // call(args);
 *       Use = BLOCK;
 *   };
 *
 * C and C++ comments are allowed. Children inherit every field of their parent; calls such as
 * SetDamage/SetProtection override per damage type. Pure: no Node or DOM APIs.
 */
export type ItemValue = string | number;

export interface ItemDef {
  name: string;
  parent: string | null;
  fields: Record<string, ItemValue>;
  /** Damage per type (SetDamage), e.g. { SLASH: 8, BASH: 5 }. */
  damage: Record<string, number>;
  /** Damage-taken multiplier per type (SetProtection), e.g. { SLASH: 0.9 }. */
  protection: Record<string, number>;
  /** Other calls in order, e.g. EquipParameters(-1,MIGHT,5). */
  calls: { name: string; args: ItemValue[] }[];
}

export class ItemsCtxError extends Error {}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function parseValue(raw: string): ItemValue {
  const v = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^"(.*)"$/, '$1');
}

/** Parses all items and resolves inheritance. Unknown parents are reported as errors. */
export function parseItemsCtx(text: string): ItemDef[] {
  const src = stripComments(text);
  const header = /item\s+("([^"]+)"|[A-Za-z0-9_]+)\s*(?::\s*("([^"]+)"|[A-Za-z0-9_]+))?\s*\{/g;
  const raw: ItemDef[] = [];
  let m: RegExpExecArray | null;
  while ((m = header.exec(src))) {
    const name = m[2] ?? m[1]!;
    const parent = m[3] ? (m[4] ?? m[3]) : null;
    const close = src.indexOf('}', header.lastIndex);
    if (close < 0) throw new ItemsCtxError(`unterminated item ${name}`);
    const body = src.slice(header.lastIndex, close);
    header.lastIndex = close + 1;
    const item: ItemDef = { name, parent, fields: {}, damage: {}, protection: {}, calls: [] };
    for (const stmt of body.split(';')) {
      const s = stmt.trim();
      if (!s) continue;
      const call = s.match(/^([A-Za-z_]\w*)\s*\(([^)]*)\)$/);
      if (call) {
        const args = call[2]!.split(',').map(parseValue).filter((a) => a !== '');
        const fn = call[1]!;
        if ((fn === 'SetDamage' || fn === 'SetProtection') && typeof args[0] === 'string' && typeof args[1] === 'number') {
          (fn === 'SetDamage' ? item.damage : item.protection)[args[0].toUpperCase()] = args[1];
        } else {
          item.calls.push({ name: fn, args });
        }
        continue;
      }
      const kv = s.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (kv) item.fields[kv[1]!] = parseValue(kv[2]!);
    }
    raw.push(item);
  }

  const byName = new Map(raw.map((i) => [i.name.toLowerCase(), i]));
  const resolved = new Map<string, ItemDef>();
  const resolve = (item: ItemDef, depth: number): ItemDef => {
    const key = item.name.toLowerCase();
    const done = resolved.get(key);
    if (done) return done;
    if (depth > 32) throw new ItemsCtxError(`inheritance cycle at ${item.name}`);
    let out: ItemDef = { ...item, fields: { ...item.fields }, damage: { ...item.damage }, protection: { ...item.protection }, calls: [...item.calls] };
    if (item.parent) {
      const p = byName.get(item.parent.toLowerCase());
      if (!p) throw new ItemsCtxError(`${item.name}: unknown parent ${item.parent}`);
      const base = resolve(p, depth + 1);
      out = {
        ...out,
        fields: { ...base.fields, ...item.fields },
        damage: { ...base.damage, ...item.damage },
        protection: { ...base.protection, ...item.protection },
        calls: item.calls.length > 0 ? [...item.calls] : [...base.calls],
      };
    }
    resolved.set(key, out);
    return out;
  };
  return raw.map((i) => resolve(i, 0));
}
