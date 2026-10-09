import { unzipSync } from 'fflate';
import { decodeTga, type DecodedImage } from './formats/tga.ts';
import { interpretDefaultCtx, parseCtxTable } from './formats/ctx.ts';

/** Read access to the user's original install. Paths are relative, forward-slash separated. */
export interface SourceFS {
  readFile(path: string): Promise<Uint8Array | null>;
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
  models: Record<string, string>;
  levels: Record<string, { render: string; collision: string }>;
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

const MANIFEST_VERSION = '1.0.0';

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, generated_at: '', inputs: {}, textures: {}, models: {}, levels: {}, rules: {}, audio: {} };
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
      report.skipped.push(zipPath);
      log(`textures: unchanged, ${Object.keys(prev.textures).length} cached`);
    } else {
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
        } catch (err) {
          report.warnings.push(`${name}: ${(err as Error).message}`);
        }
        if (++done % 250 === 0) log(`textures: ${done}/${names.length}`);
      });
      manifest.textures = Object.fromEntries(Object.entries(manifest.textures).sort(([a], [b]) => a.localeCompare(b)));
      report.converted.push(zipPath);
    }
  }

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

  manifest.generated_at = (opts.now ?? (() => new Date()))().toISOString();
  await sink.writeFile('manifest.json', JSON.stringify(manifest, null, 2));
  return report;
}
