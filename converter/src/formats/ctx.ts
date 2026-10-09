/**
 * Parser for tabular `.ctx` scripts such as `script/default.ctx`:
 *
 *   # comment
 *   DM	25	20	20
 *   S0	1	1	80	15	0
 *   S0	2	2	120	30	0
 *
 * Each non-comment line is a key followed by numeric columns. Repeated keys produce
 * multiple rows (e.g. spell levels). Non-numeric lines are reported, not fatal.
 * Block-structured scripts (items.ctx, models.ctx) need dedicated parsers.
 */
export interface CtxTable {
  rows: Record<string, number[][]>;
  warnings: string[];
}

export function parseCtxTable(text: string): CtxTable {
  const rows: Record<string, number[][]> = {};
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, ...cols] = line.split(/\s+/);
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      warnings.push(`line ${n + 1}: unrecognised key`);
      continue;
    }
    const values = cols.map(Number);
    if (values.some((v) => !Number.isFinite(v))) {
      warnings.push(`line ${n + 1}: non-numeric value for ${key}`);
      continue;
    }
    (rows[key] ??= []).push(values);
  }
  return { rows, warnings };
}

/** Difficulty columns used by default.ctx. */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export interface DrakeRules {
  attributes: Record<'might' | 'intellect' | 'endurance' | 'speed', number[]>;
  /** Resist multipliers per damage type index, per difficulty. */
  resists: number[][];
  /** Unarmed damage per damage type index, per difficulty. */
  baseDamage: number[][];
  /** Spell index -> rows of [level, manaCost, duration, value1, value2]. */
  spells: Record<number, number[][]>;
}

function indexed(rows: Record<string, number[][]>, prefix: string): number[][] {
  const out: number[][] = [];
  for (const key of Object.keys(rows)) {
    const m = key.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) out[Number(m[1])] = rows[key]![0]!;
  }
  return out;
}

/** Interprets the known sections of default.ctx; unknown keys stay available in the raw table. */
export function interpretDefaultCtx(table: CtxTable): DrakeRules {
  const r = table.rows;
  const first = (k: string) => r[k]?.[0] ?? [];
  const spells: Record<number, number[][]> = {};
  for (const key of Object.keys(r)) {
    const m = key.match(/^S(\d+)$/);
    if (m) spells[Number(m[1])] = r[key]!;
  }
  return {
    attributes: { might: first('DM'), intellect: first('DI'), endurance: first('DE'), speed: first('DS') },
    resists: indexed(r, 'DR'),
    baseDamage: indexed(r, 'DD'),
    spells,
  };
}
