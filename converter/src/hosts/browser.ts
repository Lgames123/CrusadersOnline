/**
 * Browser host: converts the player's own installation inside their browser. The player picks
 * the game folder (`<input webkitdirectory>`); files are read lazily from the File objects, never
 * uploaded anywhere. Output goes to Cache Storage under `/generated/<path>`, where the client's
 * service worker serves it with the same URLs as the development server. Runs in a Web Worker.
 */
import { MOVIE_ENCODE_ARGS, MOVIE_EXT, type MovieTranscoder } from '../movies.ts';
import { convertInstall, sha256Hex, type ConvertReport, type ImageEncoder, type OutputSink, type SourceFS } from '../pipeline.ts';
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
  webm: 'video/webm',
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

/**
 * ffmpeg.wasm's single-thread core (GPL-2.0-or-later, https://github.com/ffmpegwasm/ffmpeg.wasm),
 * fetched from the public CDN only when the folder has movies to convert and checked against the
 * npm package's hashes. It is not bundled or hosted by the project.
 */
export const FFMPEG_CORE = {
  js: { url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js', sha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3' },
  wasm: { url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm', sha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7' },
} as const;

/** The parts of the ffmpeg.wasm core module used here. */
interface FFmpegCore {
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
  exec(...args: string[]): number;
  reset(): void;
  setLogger(logger: (m: { type: string; message: string }) => void): void;
  setProgress(handler: (p: { progress: number; time: number }) => void): void;
}

async function fetchChecked(file: { url: string; sha256: string }): Promise<Uint8Array> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if ((await sha256Hex(bytes)) !== file.sha256) throw new Error(`${file.url}: unexpected contents`);
  return bytes;
}

/** Transcodes the movies with ffmpeg.wasm, loaded on the first movie (~32 MB download). */
export function wasmMovieTranscoder(log: (msg: string) => void): MovieTranscoder {
  let core: Promise<FFmpegCore> | null = null;
  const load = async (): Promise<FFmpegCore> => {
    log('movies: downloading the FFmpeg decoder (ffmpeg.wasm, ~32 MB)');
    const [js, wasm] = await Promise.all([fetchChecked(FFMPEG_CORE.js), fetchChecked(FFMPEG_CORE.wasm)]);
    const url = URL.createObjectURL(new Blob([js as Uint8Array<ArrayBuffer>], { type: 'text/javascript' }));
    try {
      const mod = (await import(/* @vite-ignore */ url)) as { default: (opts: object) => Promise<FFmpegCore> };
      return await mod.default({ wasmBinary: wasm.buffer });
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return {
    ext: MOVIE_EXT,
    async transcode(name, bink) {
      core ??= load();
      const ff = await core.catch((err) => {
        core = null;
        throw err;
      });
      const src = `${name}.bik`;
      const dst = `${name}.${MOVIE_EXT}`;
      const lines: string[] = [];
      let shown = -1;
      ff.setLogger((m) => {
        if (m.type === 'stderr' && lines.push(m.message) > 4) lines.shift();
      });
      ff.setProgress(({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct > shown && pct >= 0 && pct <= 100) log(`movies: ${name} ${(shown = pct)}%`);
      });
      ff.FS.writeFile(src, bink);
      try {
        const code = ff.exec('-hide_banner', '-i', src, ...MOVIE_ENCODE_ARGS, dst);
        ff.reset();
        if (code !== 0) throw new Error(`ffmpeg exited with ${code}${lines.length ? `: ${lines.join(' / ')}` : ''}`);
        return ff.FS.readFile(dst);
      } finally {
        for (const f of [src, dst]) {
          try {
            ff.FS.unlink(f);
          } catch {
            // Not written.
          }
        }
      }
    },
  };
}

export async function convertInBrowser(files: Iterable<File>, log: (msg: string) => void): Promise<ConvertReport> {
  return convertInstall({ source: fileListSource(files), sink: await cacheSink(), encoder: await canvasEncoder(), movies: wasmMovieTranscoder(log), log, concurrency: 4 });
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
