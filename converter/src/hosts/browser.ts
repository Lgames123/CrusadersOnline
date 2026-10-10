/**
 * Browser host: converts the player's own installation inside their browser. The player picks
 * the game folder (`<input webkitdirectory>`); files are read lazily from the File objects, never
 * uploaded anywhere. Output goes to Cache Storage under `/generated/<path>`, where the client's
 * service worker serves it with the same URLs as the development server. Runs in a Web Worker.
 */
import { convertInstall, type ConvertReport, type ImageEncoder, type OutputSink, type SourceFS } from '../pipeline.ts';
import type { DecodedImage } from '../formats/tga.ts';

export const GENERATED_CACHE = 'crusaders-generated';
export const GENERATED_PREFIX = '/generated/';

const TYPES: Record<string, string> = {
  glb: 'model/gltf-binary',
  json: 'application/json',
  webp: 'image/webp',
  png: 'image/png',
  bin: 'application/octet-stream',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};

/**
 * Source over the files of a picked directory. `webkitRelativePath` starts with the picked
 * folder's own name, which is stripped; lookups are case-insensitive like the original Windows
 * file system.
 */
export function fileListSource(files: Iterable<File>): SourceFS {
  const byPath = new Map<string, File>();
  const dirs = new Map<string, string[]>();
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/').split('/').slice(1).join('/') || f.name;
    const key = rel.toLowerCase();
    byPath.set(key, f);
    const slash = key.lastIndexOf('/');
    const dir = slash < 0 ? '' : key.slice(0, slash);
    const name = rel.slice(slash + 1);
    (dirs.get(dir) ?? dirs.set(dir, []).get(dir)!).push(name);
  }
  return {
    async readFile(path) {
      const f = byPath.get(path.toLowerCase());
      return f ? new Uint8Array(await f.arrayBuffer()) : null;
    },
    async list(dir) {
      return dirs.get(dir.toLowerCase().replace(/\/$/, '')) ?? null;
    },
  };
}

export async function cacheSink(): Promise<OutputSink> {
  const cache = await caches.open(GENERATED_CACHE);
  return {
    async writeFile(path, data) {
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      const body = typeof data === 'string' ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
      await cache.put(new Request(GENERATED_PREFIX + path), new Response(body, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } }));
    },
    async readText(path) {
      const res = await cache.match(new Request(GENERATED_PREFIX + path));
      return res ? res.text() : null;
    },
  };
}

/** WebP via OffscreenCanvas where the browser can encode it, PNG otherwise. */
export async function canvasEncoder(): Promise<ImageEncoder> {
  const probeCanvas = new OffscreenCanvas(1, 1);
  probeCanvas.getContext('2d'); // convertToBlob needs a rendering context
  const probe = await probeCanvas.convertToBlob({ type: 'image/webp' });
  const webp = probe.type === 'image/webp';
  return {
    ext: webp ? 'webp' : 'png',
    async encode(img: DecodedImage) {
      const canvas = new OffscreenCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.data.byteLength), img.width, img.height), 0, 0);
      const blob = await canvas.convertToBlob({ type: webp ? 'image/webp' : 'image/png', quality: 0.9 });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

export async function convertInBrowser(files: Iterable<File>, log: (msg: string) => void): Promise<ConvertReport> {
  return convertInstall({ source: fileListSource(files), sink: await cacheSink(), encoder: await canvasEncoder(), log, concurrency: 4 });
}

/** True when the picked folder looks like a Crusaders of Might and Magic installation. */
export function looksLikeInstall(files: Iterable<File>): boolean {
  let ok = 0;
  for (const f of files) {
    const p = (f.webkitRelativePath || f.name).toLowerCase();
    if (p.endsWith('/crusaders.exe') || p.endsWith('/textures/textures.zip') || p.endsWith('/script/models.ctx')) ok++;
  }
  return ok >= 2;
}
