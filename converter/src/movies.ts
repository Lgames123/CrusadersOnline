/**
 * The original's Bink movies (Media/Movies/*.bik). Browsers cannot play Bink, so each host
 * transcodes them with FFmpeg (whose `binkvideo` / `binkaudio_rdft` decoders read them): the CLI
 * with the ffmpeg on the player's PATH, the browser importer with ffmpeg.wasm fetched at import
 * time. Neither is bundled with the project.
 */

/** Transcodes one original movie into a format browsers play. */
export interface MovieTranscoder {
  /** Extension of produced files, e.g. "webm". */
  readonly ext: string;
  transcode(name: string, bink: Uint8Array): Promise<Uint8Array>;
}

/**
 * The movies the startup sequence plays, in order (0x00499760 / 0x00499950: cinematic 'c' =
 * "3DO.bik", then 0 = "CMMIntro.bik"). Key = manifest.movies key, file = name in Media/Movies.
 */
export const MOVIES: readonly { key: string; file: string }[] = [
  { key: '3do', file: '3DO.bik' },
  { key: 'cmmintro', file: 'CMMIntro.bik' },
];

export const MOVIE_EXT = 'webm';

/**
 * FFmpeg output options shared by both hosts: VP8 + Vorbis in WebM (every current browser plays
 * it). The intro is 640x480 at 15 fps, mono 44.1 kHz; realtime VP8 keeps the wasm encode short
 * and gives ~28 MB for its 2:20. Not Opus: ffmpeg.wasm 0.12.10's libopus crashes ("memory access
 * out of bounds") on every input.
 */
export const MOVIE_ENCODE_ARGS: readonly string[] = [
  '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', '16', '-b:v', '2M',
  '-c:a', 'libvorbis', '-q:a', '5',
];
