import { unzipSync } from 'fflate';
import { parseEffectsStg } from './formats/effects_stg.ts';
import { decodeTga, type DecodedImage } from './formats/tga.ts';
import { interpretDefaultCtx, parseCtxTable } from './formats/ctx.ts';
import { parseMdl } from './formats/mdl.ts';
import { parseAni, type AniClip } from './formats/ani.ts';
import { parseItemsCtx } from './formats/items_ctx.ts';
import { parseModelsCtx } from './formats/models_ctx.ts';
import { buildModelDocument, writeGlb } from './emit/gltf_model.ts';
import { parseMsh } from './formats/msh.ts';
import { parseCap } from './formats/cap.ts';
import type { CapArg, CapCameraPath, CapStory, CapTriggerVolume } from './formats/cap_story.ts';
import { parsePeStrings } from './formats/pe_strings.ts';
import { parseSoundCtx, parseTexturesNfo } from './formats/sound_ctx.ts';
import { emitLevel } from './emit/gltf_level.ts';

/** Read access to the user's original install. Paths are relative, forward-slash separated. */
export interface SourceFS {
  readFile(path: string): Promise<Uint8Array | null>;
  /** File names (not paths) directly inside `dir`; hosts without listing return null. */
  list?(dir: string): Promise<string[] | null>;
}

/** Destination for generated files (local/generated/ on Node, OPFS in the browser). */
export interface OutputSink {
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readText(path: string): Promise<string | null>;
}

export interface ImageEncoder {
  /** Extension of produced files, e.g. "webp". */
  readonly ext: string;
  encode(image: DecodedImage): Promise<Uint8Array>;
}

export interface Manifest {
  version: string;
  generated_at: string;
  /** SHA-256 of each consumed input, used to skip unchanged inputs on later runs. */
  inputs: Record<string, string>;
  textures: Record<string, string>;
  /** Pixel size per texture (level UVs are stored in texels). */
  textureSizes: Record<string, [number, number]>;
  models: Record<string, string>;
  levels: Record<string, { render: string; collision: string }>;
  /** Level acts (`Caps/*.cap`): lower-case cap name -> placements JSON (mesh + creatures). */
  placements: Record<string, string>;
  rules: Record<string, string>;
  audio: Record<string, string>;
}

export interface ConvertOptions {
  source: SourceFS;
  sink: OutputSink;
  encoder: ImageEncoder;
  log?: (msg: string) => void;
  /** Parallel image encodes. */
  concurrency?: number;
  now?: () => Date;
}

export interface ConvertReport {
  manifest: Manifest;
  converted: string[];
  skipped: string[];
  warnings: string[];
}

/**
 * A mover key in the mirrored frame (z -> -z). Segment types (dispatch 0x490210): low 3 bits a
 * move by (dx, dy, dz) (0x48F350); 0x08 a turn about X through (y, z) (0x48F630); 0x10 about Y
 * through (x, z) (0x48F960); 0x20 about Z through (x, y) (0x48FC90); keys are (degrees, centre)
 * for turns. Mirroring negates turns about X and Y and every z; turns about Z keep their angle.
 */
function mirrorMoverKey(type: number, [a, b, c]: [number, number, number]): [number, number, number] {
  if (type & 7) return [a, b, -c];
  if (type & 0x08) return [-a, b, -c];
  if (type & 0x10) return [-a, b, -c];
  if (type & 0x20) return [a, b, c];
  return [a, b, c];
}

const MANIFEST_VERSION = '1.25.0'; // 1.25: story.shops (type 0x1C shop triggers: volume, greeting, stock); 1.24: creatures' held items, inventory, talk line, gesture and idle path; story.soundTriggers (walk-in sound triggers); 1.23: relay ops decoded (exits, mover-trigger brushes, sounds, creature ops, flag ops); 1.22: relays' real op lists (targets, delay), message refs, story.deaths; 1.21: story.messages (sign and hint text from messages.ctx); 1.20: placed objects carry their own texture when it differs from the shared model file's; placements are rewritten on every run (exit entries / flags need no bump); 1.19: citadel portal geometry and triggers; 1.18: relays' brush targets; 1.17: level texture v from the picture's bottom; mover keys mirrored by segment type; 1.16: level textures one picture every 15 units; 1.15: level start points; 1.14: story (triggers, sequences, cameras), rules/strings.json; 1.2: extras.nodeTransform (held items); 1.3: death clips keep root motion; 1.4: level music; 1.5: brushes (doors); 1.6: brush faces; 1.7: portal volumes, door exits; 1.8: brush movers; 1.9: door sounds; 1.10: lightmap UVs at 16 bytes a vertex; 1.11: lightmap seams stitched; 1.12: prop model boxes, model names in lower case; 1.13: creature facing
/** Bump when level output changes so cached levels are rebuilt. */
const LEVEL_EMIT_VERSION = '2';

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, generated_at: '', inputs: {}, textures: {}, textureSizes: {}, models: {}, levels: {}, placements: {}, rules: {}, audio: {} };
}

async function loadPrevious(sink: OutputSink): Promise<Manifest> {
  const text = await sink.readText('manifest.json');
  if (!text) return emptyManifest();
  try {
    const m = JSON.parse(text) as Manifest;
    return m.version === MANIFEST_VERSION ? { ...emptyManifest(), ...m } : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

/** Converts the parts of the original install the converter currently understands. Never writes to the source. */
export async function convertInstall(opts: ConvertOptions): Promise<ConvertReport> {
  const { source, sink, encoder } = opts;
  const log = opts.log ?? (() => {});
  const prev = await loadPrevious(sink);
  const manifest = emptyManifest();
  const report: ConvertReport = { manifest, converted: [], skipped: [], warnings: [] };

  // --- Textures: Textures/textures.zip -> textures/<name>.<ext>
  const zipPath = 'Textures/textures.zip';
  const zip = await source.readFile(zipPath);
  if (!zip) {
    report.warnings.push(`${zipPath} not found`);
  } else {
    const hash = await sha256Hex(zip);
    manifest.inputs[zipPath] = hash;
    if (prev.inputs[zipPath] === hash && Object.keys(prev.textures).length > 0) {
      manifest.textures = prev.textures;
      manifest.textureSizes = prev.textureSizes;
      report.skipped.push(zipPath);
      log(`textures: unchanged, ${Object.keys(prev.textures).length} cached`);
    } else {
      const nfo = unzipSync(zip, { filter: (f) => f.name.toLowerCase().endsWith('textures.nfo') });
      const nfoText = Object.values(nfo)[0];
      if (nfoText) {
        await sink.writeFile('rules/materials.json', JSON.stringify({ materials: parseTexturesNfo(new TextDecoder('latin1').decode(nfoText)) }, null, 1));
        manifest.rules['materials'] = 'rules/materials.json';
      }
      const entries = unzipSync(zip, { filter: (f) => f.name.toLowerCase().endsWith('.tga') });
      const names = Object.keys(entries).sort();
      log(`textures: decoding ${names.length} TGA files`);
      let done = 0;
      await mapLimit(names, opts.concurrency ?? 8, async (name) => {
        const base = name.replace(/^.*\//, '').replace(/\.tga$/i, '').toLowerCase();
        try {
          const image = decodeTga(entries[name]!);
          const out = `textures/${base}.${encoder.ext}`;
          await sink.writeFile(out, await encoder.encode(image));
          manifest.textures[base] = out;
          manifest.textureSizes[base] = [image.width, image.height];
        } catch (err) {
          report.warnings.push(`${name}: ${(err as Error).message}`);
        }
        if (++done % 250 === 0) log(`textures: ${done}/${names.length}`);
      });
      manifest.textures = Object.fromEntries(Object.entries(manifest.textures).sort(([a], [b]) => a.localeCompare(b)));
      report.converted.push(zipPath);
    }
  }

  /** For level placements: item names (chest contents) and models.ctx id -> converted model. */
  const itemNames = new Set<string>(['Gold Pieces']);
  const modelById = new Map<number, string>();
  /** models.ctx id -> its `T` texture list (lower case); converted model -> the texture baked into it. */
  const texturesById = new Map<number, string[]>();
  const bakedTexture = new Map<string, string>();
  /** Item name -> items.ctx `Texture` (index into its model's `T` list). */
  const itemTexture = new Map<string, number>();
  /** Model bounding boxes (MDL header, original units) by converted model name, for prop colliders. */
  const modelBoxes = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();

  // --- Rules: script/default.ctx -> rules/default.json
  const ctxPath = 'script/default.ctx';
  const ctx = await source.readFile(ctxPath);
  if (!ctx) {
    report.warnings.push(`${ctxPath} not found`);
  } else {
    manifest.inputs[ctxPath] = await sha256Hex(ctx);
    const table = parseCtxTable(new TextDecoder('latin1').decode(ctx));
    report.warnings.push(...table.warnings.map((w) => `${ctxPath} ${w}`));
    const out = 'rules/default.json';
    await sink.writeFile(out, JSON.stringify({ drake: interpretDefaultCtx(table), raw: table.rows }, null, 2));
    manifest.rules['default'] = out;
    report.converted.push(ctxPath);
  }

  // --- Special effects: script/effects.stg -> rules/effects.json (shapes, flashes, named effects)
  const effectsPath = 'script/effects.stg';
  const effectsBytes = await source.readFile(effectsPath);
  if (!effectsBytes) {
    report.warnings.push(`${effectsPath} not found`);
  } else {
    manifest.inputs[effectsPath] = await sha256Hex(effectsBytes);
    const effects = parseEffectsStg(new TextDecoder('latin1').decode(effectsBytes));
    await sink.writeFile('rules/effects.json', JSON.stringify(effects));
    manifest.rules['effects'] = 'rules/effects.json';
    report.converted.push(effectsPath);
    log(`effects: ${Object.keys(effects.multis).length} effects, ${Object.keys(effects.flashes).length} flashes`);
  }

  // --- Items: script/items.ctx -> rules/items.json (inheritance resolved)
  const itemsPath = 'script/items.ctx';
  const itemsBytes = await source.readFile(itemsPath);
  if (!itemsBytes) {
    report.warnings.push(`${itemsPath} not found`);
  } else {
    manifest.inputs[itemsPath] = await sha256Hex(itemsBytes);
    try {
      const items = parseItemsCtx(new TextDecoder('latin1').decode(itemsBytes));
      for (const it of items) {
        itemNames.add(it.name);
        const t = Number(it.fields['Texture']);
        if (Number.isInteger(t) && t > 0) itemTexture.set(it.name, t);
      }
      await sink.writeFile('rules/items.json', JSON.stringify({ items }, null, 2));
      manifest.rules['items'] = 'rules/items.json';
      report.converted.push(itemsPath);
      log(`items: ${items.length} definitions`);
    } catch (err) {
      report.warnings.push(`${itemsPath}: ${(err as Error).message}`);
    }
  }

  // --- Models: script/models.ctx bindings -> models/<name>.glb (texture referenced, not embedded)
  const bindingsPath = 'script/models.ctx';
  const bindingsBytes = await source.readFile(bindingsPath);
  if (!bindingsBytes) {
    report.warnings.push(`${bindingsPath} not found`);
  } else {
    const bindings = parseModelsCtx(new TextDecoder('latin1').decode(bindingsBytes));
    // Converted models are keyed in lower case (models.ctx names mix cases: Drawers01, PineTrTrunkV1).
    for (const b of bindings) {
      if (modelById.has(b.id)) continue;
      modelById.set(b.id, b.file.replace(/\.mdl$/i, '').toLowerCase());
      texturesById.set(b.id, b.textures.map((t) => t.replace(/\.tga$/i, '').toLowerCase()));
    }
    const files = new Map<string, string | undefined>(); // lower-case file -> first texture
    const anims = new Map<string, Map<string, string>>(); // lower-case model file -> ani file -> label
    const states = new Map<string, Record<string, string>>(); // lower-case model file -> ASM state -> clip
    for (const b of bindings) {
      const key = b.file.toLowerCase();
      if (!files.has(key) || (!files.get(key) && b.textures[0])) files.set(key, b.textures[0]);
      let set = anims.get(key);
      if (!set) anims.set(key, (set = new Map()));
      for (const a of b.animations) if (!set.has(a.toLowerCase())) set.set(a.toLowerCase(), b.labels[a] ?? '');
      let st = states.get(key);
      if (!st) states.set(key, (st = {}));
      for (const [state, ani] of Object.entries(b.states)) if (!(state in st)) st[state] = ani.replace(/\.ani$/i, '').toLowerCase();
    }
    log(`models: ${files.size} model files referenced by ${bindingsPath}`);
    let converted = 0;
    let clips = 0;
    for (const [file, texture] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const bytes = await source.readFile(`Models/${file}`);
      if (!bytes) {
        report.warnings.push(`Models/${file}: referenced but missing`);
        continue;
      }
      const base = file.replace(/\.mdl$/i, '');
      try {
        const model = parseMdl(bytes);
        modelBoxes.set(base.toLowerCase(), { min: model.bboxMin, max: model.bboxMax });
        const tex = texture?.replace(/\.tga$/i, '').toLowerCase();
        const textureFile = tex ? manifest.textures[tex] : undefined;
        if (tex && !textureFile) report.warnings.push(`Models/${file}: texture "${texture}" not found`);
        if (tex) bakedTexture.set(base.toLowerCase(), tex);
        const animations: { name: string; label: string; clip: AniClip }[] = [];
        for (const [ani, label] of anims.get(file) ?? []) {
          const data = await source.readFile(`Models/${ani}`);
          if (!data) {
            report.warnings.push(`Models/${ani}: referenced by ${file} but missing`);
            continue;
          }
          try {
            animations.push({ name: ani.replace(/\.ani$/i, ''), label, clip: parseAni(data, model.nodes.length) });
          } catch (err) {
            report.warnings.push(`Models/${ani} on ${file}: ${(err as Error).message}`);
          }
        }
        clips += animations.length;
        const doc = buildModelDocument(model, {
          name: base,
          animations,
          states: states.get(file) ?? {},
          ...(textureFile ? { textureUri: `../${textureFile}` } : {}),
        });
        const out = `models/${base}.glb`;
        await sink.writeFile(out, await writeGlb(doc));
        manifest.models[base] = out;
        converted++;
      } catch (err) {
        report.warnings.push(`Models/${file}: ${(err as Error).message}`);
      }
    }
    log(`models: ${converted} converted with ${clips} animation clips`);
    manifest.inputs[bindingsPath] = await sha256Hex(bindingsBytes);
    report.converted.push(bindingsPath);
  }

  // --- Audio: script/data.czx (ZIP) Sound.ctx -> rules/sounds.json; Sound/*.wav|mp3 copied as-is
  // (browsers play PCM WAV and MP3 natively) to sounds/<lower-case name>.
  const czx = await source.readFile('script/data.czx');
  if (czx) {
    manifest.inputs['script/data.czx'] = await sha256Hex(czx);
    try {
      const files = unzipSync(czx, { filter: (f) => f.name.toLowerCase() === 'sound.ctx' });
      const text = Object.values(files)[0];
      if (text) {
        const sounds = parseSoundCtx(new TextDecoder('latin1').decode(text));
        await sink.writeFile('rules/sounds.json', JSON.stringify({ sounds }, null, 1));
        manifest.rules['sounds'] = 'rules/sounds.json';
        log(`audio: ${sounds.length} sound registry entries`);
      }
    } catch (err) {
      report.warnings.push(`script/data.czx: ${(err as Error).message}`);
    }
  }
  const soundFiles = (await source.list?.('Sound'))?.filter((f) => /\.(wav|mp3)$/i.test(f)) ?? [];
  let copied = 0;
  for (const file of soundFiles) {
    const out = `sounds/${file.toLowerCase()}`;
    if (prev.audio[file.toLowerCase()] === out) {
      manifest.audio[file.toLowerCase()] = out;
      continue;
    }
    const bytes = await source.readFile(`Sound/${file}`);
    if (!bytes) continue;
    await sink.writeFile(out, bytes);
    manifest.audio[file.toLowerCase()] = out;
    copied++;
  }
  if (soundFiles.length) log(`audio: ${soundFiles.length} sound files (${copied} copied)`);
  // Music: the GOG release's CD tracks, Music/<track>.mp3 -> music/<track>.mp3 (manifest.audio "music/<n>").
  const musicFiles = (await source.list?.('Music'))?.filter((f) => /^\d+\.mp3$/i.test(f)) ?? [];
  for (const file of musicFiles) {
    const out = `music/${file.toLowerCase()}`;
    const key = `music/${parseInt(file, 10)}`;
    if (prev.audio[key] === out) {
      manifest.audio[key] = out;
      continue;
    }
    const bytes = await source.readFile(`Music/${file}`);
    if (!bytes) continue;
    await sink.writeFile(out, bytes);
    manifest.audio[key] = out;
  }
  if (musicFiles.length) log(`music: ${musicFiles.length} tracks`);

  // --- Levels: Meshes/*.msh -> levels/<name>.glb + _lightmap atlas + .collision.bin
  manifest.inputs['levels:emit'] = LEVEL_EMIT_VERSION;
  const meshFiles = (await source.list?.('Meshes'))?.filter((f) => f.toLowerCase().endsWith('.msh')).sort() ?? [];
  if (meshFiles.length === 0) report.warnings.push('Meshes/*.msh: none found (or the host cannot list directories)');
  for (const file of meshFiles) {
    const path = `Meshes/${file}`;
    const bytes = await source.readFile(path);
    if (!bytes) continue;
    const name = file.replace(/\.msh$/i, '').toLowerCase();
    const hash = await sha256Hex(bytes);
    manifest.inputs[path] = hash;
    if (prev.inputs[path] === hash && prev.levels[name] && prev.inputs['levels:emit'] === LEVEL_EMIT_VERSION && prev.inputs['Textures/textures.zip'] === manifest.inputs['Textures/textures.zip']) {
      manifest.levels[name] = prev.levels[name]!;
      report.skipped.push(path);
      continue;
    }
    try {
      const level = parseMsh(bytes);
      const missing = new Set<string>();
      const out = emitLevel(level, {
        name,
        lightmapUri: `${name}_lightmap.${encoder.ext}`,
        texture: (m) => {
          const file = manifest.textures[m];
          const size = manifest.textureSizes[m];
          if (!file || !size) {
            missing.add(m);
            return null;
          }
          return { uri: `../${file}`, width: size[0], height: size[1] };
        },
        nonSolid: (m) => m.startsWith('wld_sy_sky'),
      });
      await sink.writeFile(`levels/${name}.glb`, out.glb);
      await sink.writeFile(`levels/${name}_lightmap.${encoder.ext}`, await encoder.encode(out.atlas));
      await sink.writeFile(`levels/${name}.collision.bin`, out.collision);
      manifest.levels[name] = { render: `levels/${name}.glb`, collision: `levels/${name}.collision.bin` };
      if (missing.size) report.warnings.push(`${path}: ${missing.size} material(s) without texture (${[...missing].slice(0, 5).join(', ')})`);
      log(`levels: ${name} ${level.polygons.length} polygons, ${level.materials.length} materials, ${out.triangles} collision triangles`);
      report.converted.push(path);
    } catch (err) {
      report.warnings.push(`${path}: ${(err as Error).message}`);
    }
  }

  // --- Text: crusaders.exe string table -> rules/strings.json (the quest book: quests, journal)
  const exe = await source.readFile('crusaders.exe');
  if (!exe) {
    report.warnings.push('crusaders.exe not found (quest book text)');
  } else {
    try {
      const strings = parsePeStrings(exe);
      await sink.writeFile('rules/strings.json', JSON.stringify({ strings: Object.fromEntries(strings) }));
      manifest.rules['strings'] = 'rules/strings.json';
      log(`text: ${strings.size} strings`);
    } catch (err) {
      report.warnings.push(`crusaders.exe: ${(err as Error).message}`);
    }
  }

  // --- Sign and hint text: script/messages.ctx, "#)Text" per line (loaded by 0x464FC0 into a
  // 64-entry table; entry 0 is the file's own header line, and the game shows it like any other).
  const messageText = new Map<number, string>();
  const messagesCtx = await source.readFile('script/messages.ctx');
  if (messagesCtx) {
    manifest.inputs['script/messages.ctx'] = await sha256Hex(messagesCtx);
    for (const line of new TextDecoder('latin1').decode(messagesCtx).split(/\r?\n/)) {
      const m = /^(\d+)\)(.*)$/.exec(line);
      if (m && Number(m[1]) < 64 && m[2]!.trim()) messageText.set(Number(m[1]), m[2]!.trim());
    }
  }

  // --- Placements: Caps/*.cap -> levels/<cap>.placements.json (positions mirrored like the meshes)
  const capFiles = (await source.list?.('Caps'))?.filter((f) => f.toLowerCase().endsWith('.cap')).sort() ?? [];
  let creatures = 0;
  // Each act's mesh name (header +0x34), to tell act changes within one level from exits.
  const capMesh = new Map<string, string>();
  for (const file of capFiles) {
    const bytes = await source.readFile(`Caps/${file}`);
    if (!bytes || bytes.length < 0x74) continue;
    let e = 0x34;
    while (e < 0x74 && bytes[e] !== 0) e++;
    capMesh.set(file.replace(/\.cap$/i, '').toLowerCase(), new TextDecoder('latin1').decode(bytes.subarray(0x34, e)).toLowerCase());
  }
  for (const file of capFiles) {
    const path = `Caps/${file}`;
    const bytes = await source.readFile(path);
    if (!bytes) continue;
    const name = file.replace(/\.cap$/i, '').toLowerCase();
    manifest.inputs[path] = await sha256Hex(bytes);
    try {
      const cap = parseCap(bytes, itemNames);
      const out = `levels/${name}.placements.json`;
      // Mirror Z like the meshes: positions (x, y, -z), rotations M R M with M = diag(1, 1, -1).
      const mirrorRot = (r: number[]) => r.map((v, i) => ([2, 5, 6, 7].includes(i) ? -v : v));
      await sink.writeFile(out, JSON.stringify({
        mesh: cap.mesh.toLowerCase(),
        ...(cap.music > 0 ? { music: cap.music + 1 } : {}),
        // Mover keys mirrored too, by segment type (see mirrorMoverKey).
        brushes: cap.brushes.map((b) => ({
          name: b.name,
          points: b.points.map((p) => [p[0], p[1], -p[2]]),
          faces: b.faces,
          ...(b.motion ? { motion: { ...b.motion, keys: b.motion.keys.map((k, i) => mirrorMoverKey(b.motion!.types[i] ?? 0, k)) } } : {}),
          ...(b.sounds ? { sounds: b.sounds } : {}),
        })),
        creatures: cap.creatures.map((c) => ({
          ...c,
          position: [c.position[0], c.position[1], -c.position[2]],
          facing: [c.facing[0], -c.facing[1]],
          ...(c.path ? { path: { ...c.path, points: c.path.points.map((p) => [p[0], p[1], -p[2]]) } } : {}),
        })),
        portals: cap.portals
          .filter((p) => capFiles.some((f) => f.toLowerCase() === `${p.target.toLowerCase()}.cap`))
          .map((p) => {
            const rawTrigger = p.trigger ? { polygon: p.trigger.polygon.map(([x, z]) => [x, -z] as [number, number]), yMin: p.trigger.yMin, yMax: p.trigger.yMax } : undefined;
            const { trigger, exit = p.exit, flags = p.flags } = resolveLevelPortalTrigger(name, p.target.toLowerCase(), rawTrigger);
            // No volume and the same mesh as the destination: an act change only a script makes.
            const scripted = !trigger && !p.use && capMesh.get(p.target.toLowerCase()) === cap.mesh.toLowerCase();
            return {
              exit,
              target: p.target.toLowerCase(),
              position: [p.position[0], p.position[1], -p.position[2]],
              entry: p.entry,
              flags,
              ...(scripted ? { scripted: true } : {}),
              ...(p.use ? { use: true } : {}),
              ...(trigger ? { trigger } : {}),
            };
          }),
        story: mirrorStory(cap.story, messageText),
        // Headings stay in the original's degrees (D3D, unmirrored); the arena converts them.
        starts: cap.starts.map((s) => ({ position: [s.position[0], s.position[1], -s.position[2]], heading: s.angles[1] })),
        objects: cap.objects.map((o) => {
          const model = o.kind === 'sprite' ? undefined : modelById.get(o.modelId);
          const glb = model ? manifest.models[model] : undefined;
          const box = model ? modelBoxes.get(model) : undefined;
          // A model file bound to several ids is converted once, with the first binding's texture:
          // the object's own id (and a ground item's Texture index) picks its texture.
          const list = texturesById.get(o.modelId) ?? [];
          const tex = list[(o.kind === 'item' && o.item && itemTexture.get(o.item.name)) || 0] ?? list[0];
          const texture = glb && tex && tex !== bakedTexture.get(model!) ? manifest.textures[tex] : undefined;
          return {
            ...o,
            position: [o.position[0], o.position[1], -o.position[2]],
            rotation: mirrorRot(o.rotation),
            ...(glb ? { model: glb } : {}),
            ...(texture ? { texture } : {}),
            // The model's box in its converted (Z mirrored) frame: [min x, y, z, max x, y, z].
            ...(box ? { box: [box.min[0], box.min[1], -box.max[2], box.max[0], box.max[1], -box.min[2]] } : {}),
          };
        }),
      }));
      manifest.placements[name] = out;
      creatures += cap.creatures.length;
    } catch (err) {
      report.warnings.push(`${path}: ${(err as Error).message}`);
    }
  }
  if (capFiles.length) log(`placements: ${Object.keys(manifest.placements).length} level acts, ${creatures} creatures`);

  manifest.generated_at = (opts.now ?? (() => new Date()))().toISOString();
  await sink.writeFile('manifest.json', JSON.stringify(manifest, null, 2));
  return report;
}

/**
 * The story layer in the converted (Z mirrored) frame: volumes, camera paths, step positions.
 * Message triggers carry their messages.ctx text (those without text are dropped).
 */
function mirrorStory(story: CapStory, messageText: ReadonlyMap<number, string>) {
  const vol = (v: CapTriggerVolume): CapTriggerVolume => ({ polygon: v.polygon.map(([x, z]) => [x, -z] as [number, number]), yMin: v.yMin, yMax: v.yMax });
  const path = (p: CapCameraPath): CapCameraPath => ({ ...p, points: p.points.map(([x, y, z]) => [x, y, -z] as [number, number, number]) });
  const arg = (a: CapArg): CapArg => (Array.isArray(a) ? [a[0], a[1], -a[2]] : a);
  return {
    triggers: story.triggers.map((t) => ({
      ...t,
      ...(t.volume ? { volume: vol(t.volume) } : {}),
      ...(t.sounds ? { sounds: t.sounds.map((u) => ({ ...u, positions: u.positions.map(([x, y, z]) => [x, y, -z] as [number, number, number]) })) } : {}),
    })),
    messages: story.messages
      .filter((m) => messageText.has(m.message))
      .map((m) => ({ ...m, ...(m.volume ? { volume: vol(m.volume) } : {}), text: messageText.get(m.message)! })),
    soundTriggers: story.soundTriggers.map((t) => ({
      ...t,
      volume: vol(t.volume),
      sound: { ...t.sound, positions: t.sound.positions.map(([x, y, z]) => [x, y, -z] as [number, number, number]) },
    })),
    shops: story.shops.map((t) => ({ ...t, volume: vol(t.volume) })),
    deaths: story.deaths,
    cameras: story.cameras.map((c) => ({ id: c.id, eye: path(c.eye), target: path(c.target) })),
    sequences: story.sequences.map((s) => ({
      ...s,
      steps: s.steps.map((st) => ({ ...st, args: Object.fromEntries(Object.entries(st.args).map(([k, v]) => [k, arg(v)])) })),
    })),
  };
}

interface LevelPortalTrigger {
  polygon: [number, number][];
  yMin: number;
  yMax: number;
}

/**
 * The Corantha <-> Citadel gates of acts 1-3 have no volume on their exit records: the original
 * enters the Citadel through Aerin's scene and does not walk back out. Walking through them is
 * kept (not original), with the volumes the same gates have in the other acts of the same meshes:
 * Cs4a -> Ci4a (Corantha side) and Ci9a -> Cs1a (Citadel side), and Ci1a -> Cs1a arriving as
 * Ci9a -> Cs1a does (flag 2: Cs1a's start point 0). Every other exit keeps its original volume.
 */
function resolveLevelPortalTrigger(act: string, target: string, raw?: LevelPortalTrigger): { trigger?: LevelPortalTrigger; exit?: number; flags?: number } {
  if (/^cs[1-3]a$/.test(act) && target === `ci${act[2]}a`) {
    return { trigger: { polygon: [[1992, -1680], [1992, -1692], [2104, -1692], [2104, -1680]], yMin: 1012, yMax: 1040 } };
  }
  if (/^ci[1-3]a$/.test(act) && target === `cs${act[2]}a`) {
    const trigger: LevelPortalTrigger = { polygon: [[1990, -1210], [1990, -1224], [2072, -1224], [2072, -1210]], yMin: 896, yMax: 916 };
    return act === 'ci1a' ? { trigger, exit: 0, flags: 2 } : { trigger };
  }
  return raw ? { trigger: raw } : {};
}

