#!/usr/bin/env node
/**
 * CLI host: pnpm convert --input "<original install dir>" --out "./local/generated"
 * Reads the user's own installation (read-only) and writes browser-ready assets locally.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { MOVIE_ENCODE_ARGS, MOVIE_EXT, type MovieTranscoder } from '../movies.ts';
import { convertInstall, type ImageEncoder, type OutputSink, type SourceFS } from '../pipeline.ts';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string', default: 'local/generated' },
    concurrency: { type: 'string', default: '8' },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const input = path.resolve(repoRoot, values.input ?? process.env['GAME_INSTALL_DIR'] ?? 'Crusaders of Might and Magic');
const outDir = path.resolve(repoRoot, values.out!);

const source: SourceFS = {
  async readFile(rel) {
    try {
      return new Uint8Array(await readFile(path.join(input, rel)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  },
  async list(dir) {
    try {
      return (await readdir(path.join(input, dir), { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return null;
    }
  },
};

const sink: OutputSink = {
  async writeFile(rel, data) {
    const full = path.join(outDir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  },
  async readText(rel) {
    try {
      return await readFile(path.join(outDir, rel), 'utf-8');
    } catch {
      return null;
    }
  },
};

const { default: sharp } = await import('sharp');
const encoder: ImageEncoder = {
  ext: 'webp',
  async encode(img) {
    const buf = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
      .webp({ quality: 90, alphaQuality: 100, effort: 4 })
      .toBuffer();
    return new Uint8Array(buf);
  },
};

const run = promisify(execFile);

/**
 * The movies go through the player's own FFmpeg (`FFMPEG`, else `ffmpeg` on the PATH; not a
 * project dependency). Null when it is missing or lacks the Bink decoder / VP8 + Vorbis encoders.
 */
async function ffmpegTranscoder(): Promise<MovieTranscoder | null> {
  const bin = process.env['FFMPEG'] || 'ffmpeg';
  try {
    const [dec, enc] = await Promise.all([run(bin, ['-hide_banner', '-decoders'], { maxBuffer: 8 << 20 }), run(bin, ['-hide_banner', '-encoders'], { maxBuffer: 8 << 20 })]);
    if (!/binkvideo/.test(dec.stdout) || !/libvpx/.test(enc.stdout) || !/libvorbis/.test(enc.stdout)) {
      console.warn(`[convert] ${bin} lacks binkvideo / libvpx / libvorbis: movies not converted`);
      return null;
    }
  } catch {
    console.warn('[convert] ffmpeg not found (install it or set FFMPEG): movies not converted');
    return null;
  }
  return {
    ext: MOVIE_EXT,
    async transcode(name, bink) {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'crusaders-movie-'));
      try {
        const src = path.join(dir, `${name}.bik`);
        const dst = path.join(dir, `${name}.${MOVIE_EXT}`);
        await writeFile(src, bink);
        await run(bin, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', src, ...MOVIE_ENCODE_ARGS, dst], { maxBuffer: 8 << 20 });
        return new Uint8Array(await readFile(dst));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

console.log(`[convert] input:  ${input}`);
console.log(`[convert] output: ${outDir}`);
const started = performance.now();
const report = await convertInstall({
  source,
  sink,
  encoder,
  concurrency: Number(values.concurrency),
  movies: await ffmpegTranscoder(),
  log: (m) => console.log(`[convert] ${m}`),
});
console.log(
  `[convert] done in ${((performance.now() - started) / 1000).toFixed(1)}s: ` +
    `${Object.keys(report.manifest.textures).length} textures, ${Object.keys(report.manifest.rules).length} rule files, ` +
    `${report.skipped.length} unchanged input(s), ${report.warnings.length} warning(s)`,
);
for (const w of report.warnings.slice(0, 20)) console.warn(`[convert] warning: ${w}`);
