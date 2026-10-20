import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import {
  MOVIES,
  TgaError,
  convertInstall,
  decodeTga,
  interpretDefaultCtx,
  parseCtxTable,
  type MovieTranscoder,
  type OutputSink,
  type SourceFS,
} from '@crusaders/converter';

// All fixtures are synthetic; original game files never enter the test suite.

function tgaHeader(type: number, w: number, h: number, bpp: number, descriptor: number): number[] {
  return [0, 0, type, 0, 0, 0, 0, 0, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, bpp, descriptor];
}

describe('TGA decoder', () => {
  it('decodes 24-bit bottom-up BGR into top-down RGBA', () => {
    // 2x2: file order is bottom row first. Bottom: red, green. Top: blue, white.
    const px = [0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255];
    const img = decodeTga(new Uint8Array([...tgaHeader(2, 2, 2, 24, 0), ...px]));
    expect(img.width).toBe(2);
    expect(img.hasAlpha).toBe(false);
    expect(Array.from(img.data)).toEqual([
      0, 0, 255, 255, 255, 255, 255, 255, // top: blue, white
      255, 0, 0, 255, 0, 255, 0, 255, // bottom: red, green
    ]);
  });

  it('decodes 32-bit top-down with alpha', () => {
    const img = decodeTga(new Uint8Array([...tgaHeader(2, 1, 1, 32, 0x28), 10, 20, 30, 40]));
    expect(img.hasAlpha).toBe(true);
    expect(Array.from(img.data)).toEqual([30, 20, 10, 40]);
  });

  it('decodes RLE packets', () => {
    // 3x1 top-down: run of 2 red, then raw 1 blue
    const body = [0x81, 0, 0, 255, 0x00, 255, 0, 0];
    const img = decodeTga(new Uint8Array([...tgaHeader(10, 3, 1, 24, 0x20), ...body]));
    expect(Array.from(img.data)).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('rejects truncated and unsupported files', () => {
    expect(() => decodeTga(new Uint8Array([...tgaHeader(2, 4, 4, 24, 0), 1, 2, 3]))).toThrow(TgaError);
    expect(() => decodeTga(new Uint8Array(tgaHeader(1, 1, 1, 8, 0)))).toThrow(TgaError);
    expect(() => decodeTga(new Uint8Array(5))).toThrow(TgaError);
  });
});

const SAMPLE_CTX = `#
# attributes
#\tEasy\tMedium\tHard
DM\t10\t9\t8
DI\t7\t6\t5
DE\t4\t3\t2
DS\t1\t1\t1
DR0\t0.5\t1.0\t1.5
DD0\t0\t1\t2
# spells
S0\t1\t2\t3\t4\t0
S0\t2\t3\t4\t5\t0
BAD\tabc
`;

describe('.ctx table parser', () => {
  it('parses keyed numeric rows, repeated keys and warnings', () => {
    const t = parseCtxTable(SAMPLE_CTX);
    expect(t.rows['DM']).toEqual([[10, 9, 8]]);
    expect(t.rows['S0']).toHaveLength(2);
    expect(t.warnings).toHaveLength(1);
    const rules = interpretDefaultCtx(t);
    expect(rules.attributes.might).toEqual([10, 9, 8]);
    expect(rules.resists[0]).toEqual([0.5, 1.0, 1.5]);
    expect(rules.spells[0]?.[1]).toEqual([2, 3, 4, 5, 0]);
  });
});

describe('convertInstall pipeline', () => {
  function memory() {
    const files = new Map<string, Uint8Array | string>();
    const sink: OutputSink = {
      async writeFile(p, d) { files.set(p, d); },
      async readText(p) { const v = files.get(p); return typeof v === 'string' ? v : null; },
    };
    return { files, sink };
  }

  const tga = new Uint8Array([...tgaHeader(2, 1, 1, 24, 0), 1, 2, 3]);
  const install: Record<string, Uint8Array> = {
    'Textures/textures.zip': zipSync({ 'Wood.tga': tga, 'readme.nfo': new Uint8Array([65]) }),
    'script/default.ctx': new TextEncoder().encode(SAMPLE_CTX),
  };
  const source: SourceFS = { async readFile(p) { return install[p] ?? null; } };
  const encoder = { ext: 'raw', async encode(img: { data: Uint8Array }) { return img.data; } };

  it('converts textures and rules and writes a manifest', async () => {
    const { files, sink } = memory();
    const r = await convertInstall({ source, sink, encoder });
    expect(r.manifest.textures).toEqual({ wood: 'textures/wood.raw' });
    expect(files.get('textures/wood.raw')).toEqual(new Uint8Array([3, 2, 1, 255]));
    expect(JSON.parse(files.get('rules/default.json') as string).drake.attributes.might).toEqual([10, 9, 8]);
    expect(JSON.parse(files.get('manifest.json') as string).inputs['Textures/textures.zip']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skips unchanged inputs on the second run', async () => {
    const { sink } = memory();
    await convertInstall({ source, sink, encoder });
    const second = await convertInstall({ source, sink, encoder });
    expect(second.skipped).toEqual(['Textures/textures.zip']);
    expect(second.manifest.textures).toEqual({ wood: 'textures/wood.raw' });
  });

  describe('movies', () => {
    // Listed in the case the GOG install has (3do.bik lower case); a fake transcoder tags its input.
    const bik = { '3do.bik': new Uint8Array([1]), 'CMMIntro.bik': new Uint8Array([2]) };
    const withMovies: SourceFS = {
      async readFile(p) { return install[p] ?? bik[p.slice('Media/Movies/'.length) as keyof typeof bik] ?? null; },
      async list(dir) { return dir === 'Media/Movies' ? [...Object.keys(bik), 'binkw32.dll'] : null; },
    };
    function transcoder() {
      const calls: string[] = [];
      const movies: MovieTranscoder = { ext: 'webm', async transcode(name, data) { calls.push(name); return new Uint8Array([9, ...data]); } };
      return { calls, movies };
    }

    it('transcodes 3DO.bik and CMMIntro.bik into the manifest', async () => {
      const { files, sink } = memory();
      const { calls, movies } = transcoder();
      const r = await convertInstall({ source: withMovies, sink, encoder, movies });
      expect(MOVIES.map((m) => m.key)).toEqual(['3do', 'cmmintro']);
      expect(calls).toEqual(['3do', 'cmmintro']);
      expect(r.manifest.movies).toEqual({ '3do': 'movies/3do.webm', cmmintro: 'movies/cmmintro.webm' });
      expect(files.get('movies/cmmintro.webm')).toEqual(new Uint8Array([9, 2]));
      expect(r.manifest.inputs['Media/Movies/CMMIntro.bik']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('keeps unchanged movies, even without a transcoder', async () => {
      const { sink } = memory();
      await convertInstall({ source: withMovies, sink, encoder, movies: transcoder().movies });
      const again = transcoder();
      const second = await convertInstall({ source: withMovies, sink, encoder, movies: again.movies });
      expect(again.calls).toEqual([]);
      expect(second.skipped).toContain('Media/Movies/CMMIntro.bik');
      const third = await convertInstall({ source: withMovies, sink, encoder });
      expect(third.manifest.movies).toEqual({ '3do': 'movies/3do.webm', cmmintro: 'movies/cmmintro.webm' });
      expect(third.warnings.filter((w) => w.startsWith('Media/'))).toEqual([]);
    });

    it('transcodes again when the encode settings changed', async () => {
      const { files, sink } = memory();
      await convertInstall({ source: withMovies, sink, encoder, movies: transcoder().movies });
      const m = JSON.parse(files.get('manifest.json') as string);
      m.inputs['movies:encode'] = '-c:a libopus';
      files.set('manifest.json', JSON.stringify(m));
      const again = transcoder();
      await convertInstall({ source: withMovies, sink, encoder, movies: again.movies });
      expect(again.calls).toEqual(['3do', 'cmmintro']);
    });

    it('leaves movies out with a warning when nothing can transcode them', async () => {
      const { sink } = memory();
      const r = await convertInstall({ source: withMovies, sink, encoder });
      expect(r.manifest.movies).toEqual({});
      expect(r.warnings.filter((w) => w.startsWith('Media/Movies/'))).toHaveLength(2);
    });

    it('reports a failed transcode and goes on', async () => {
      const { sink } = memory();
      const movies: MovieTranscoder = { ext: 'webm', async transcode(name) { if (name === '3do') throw new Error('broken'); return new Uint8Array([1]); } };
      const r = await convertInstall({ source: withMovies, sink, encoder, movies });
      expect(r.manifest.movies).toEqual({ cmmintro: 'movies/cmmintro.webm' });
      expect(r.warnings).toContain('Media/Movies/3do.bik: broken');
    });

    it('needs no movies: installs without them convert as before', async () => {
      const { sink } = memory();
      const r = await convertInstall({ source, sink, encoder, movies: transcoder().movies });
      expect(r.manifest.movies).toEqual({});
      expect(r.warnings.filter((w) => w.startsWith('Media/'))).toEqual([]);
    });
  });
});
