/**
 * Audio registry `Sound.ctx` (stored inside `script/data.czx`, a ZIP archive) and the texture
 * material table `textures.nfo` (inside `Textures/textures.zip`).
 *
 * Sound.ctx: tab-separated rows `index, resource, is_dialog, num_buffers, priority, length_ms,
 * quest_note, description`. The index is the sound id the executable uses (e.g. 417 =
 * UILevel.wav, played by Stats_LevelUp; 306 = SwStab02.WAV, the default impact).
 *
 * textures.nfo: blocks of `Key Value` lines per material category (Category, Ricochet,
 * FootstepL, FootstepR, Decal, Symbol); a texture's category is the symbol in its name, e.g.
 * "Cat_ST_025" -> ST (Stone).
 */
export interface SoundEntry {
  id: number;
  /** Original file name, e.g. "SW1_GEN_03.WAV". */
  file: string;
  dialog: boolean;
  buffers: number;
  priority: string;
  lengthMs: number;
  description: string;
}

export function parseSoundCtx(text: string): SoundEntry[] {
  const out: SoundEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = raw.split('\t').map((s) => s.trim()).filter((s) => s !== '');
    if (p.length < 2 || !/^\d+$/.test(p[0]!)) continue;
    out.push({
      id: Number(p[0]),
      file: p[1]!,
      dialog: p[2] === '1',
      buffers: Number(p[3] ?? 1) || 1,
      priority: p[4] ?? 'C',
      lengthMs: Number(p[5] ?? 0) || 0,
      description: p.slice(7).join(' '),
    });
  }
  return out;
}

export interface MaterialCategory {
  category: string;
  symbol: string;
  ricochet: string;
  footstepL: string;
  footstepR: string;
  decal: string;
}

export function parseTexturesNfo(text: string): MaterialCategory[] {
  const out: MaterialCategory[] = [];
  let cur: Partial<MaterialCategory> | null = null;
  const flush = () => {
    if (cur?.category && cur.symbol) out.push({ ricochet: '', footstepL: '', footstepR: '', decal: '', ...cur } as MaterialCategory);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*/, '').trim();
    const m = /^(\w+)\s+(\S+)/.exec(line);
    if (!m) continue;
    const [, key, value] = m as unknown as [string, string, string];
    if (key === 'Category') {
      flush();
      cur = { category: value };
    } else if (cur) {
      const k = ({ Ricochet: 'ricochet', FootstepL: 'footstepL', FootstepR: 'footstepR', Decal: 'decal', Symbol: 'symbol' } as const)[key as 'Ricochet'];
      if (k) cur[k] = value;
    }
  }
  flush();
  return out;
}
