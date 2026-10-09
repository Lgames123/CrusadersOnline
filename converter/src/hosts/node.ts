#!/usr/bin/env node
/**
 * CLI host: pnpm convert --input "<original install dir>" --out "./local/generated"
 * Reads the user's own installation (read-only) and writes browser-ready assets locally.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
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

console.log(`[convert] input:  ${input}`);
console.log(`[convert] output: ${outDir}`);
const started = performance.now();
const report = await convertInstall({
  source,
  sink,
  encoder,
  concurrency: Number(values.concurrency),
  log: (m) => console.log(`[convert] ${m}`),
});
console.log(
  `[convert] done in ${((performance.now() - started) / 1000).toFixed(1)}s: ` +
    `${Object.keys(report.manifest.textures).length} textures, ${Object.keys(report.manifest.rules).length} rule files, ` +
    `${report.skipped.length} unchanged input(s), ${report.warnings.length} warning(s)`,
);
for (const w of report.warnings.slice(0, 20)) console.warn(`[convert] warning: ${w}`);
