/**
 * Parser for `script/models.ctx`, which binds model ids to files, textures and animations:
 *
 *   N 0 drake.mdl          # model id + file
 *   T drake                # texture (first T is the model texture)
 *   L PA01_ru_f.ani        # animation without ASM state
 *   B <ASM_STATE> <file>   # player animation bound to a state
 *   SHADOWLESS / PERSPECTIVE flags
 */
export interface ModelBinding {
  id: number;
  file: string;
  textures: string[];
  animations: string[];
  /** Designer comment per animation file, e.g. "run forward". */
  labels: Record<string, string>;
  flags: string[];
}

export function parseModelsCtx(text: string): ModelBinding[] {
  const out: ModelBinding[] = [];
  let cur: ModelBinding | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const hash = raw.indexOf('#');
    const comment = hash >= 0 ? raw.slice(hash + 1).trim() : '';
    const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0]!;
    if (tag === 'N' && parts.length >= 3) {
      cur = { id: Number(parts[1]), file: parts[2]!, textures: [], animations: [], labels: {}, flags: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (tag === 'T' && parts[1]) {
      cur.textures.push(parts[1]);
    } else if (tag === 'L' || tag === 'B') {
      // L <file.ani>   |   B <ASM_STATE> <file.ani>  (some B lines name a state without a file)
      const file = parts.slice(1).find((p) => /\.ani$/i.test(p));
      if (!file) continue;
      cur.animations.push(file);
      const state = tag === 'B' ? parts[1]! : '';
      const label = [state, comment].filter(Boolean).join(' — ');
      if (label) cur.labels[file] = label;
    } else if (/^[A-Z]{4,}$/.test(tag) && parts.length === 1) {
      cur.flags.push(tag);
    }
  }
  return out;
}
