/// <reference lib="webworker" />
/**
 * Converts the player's own installation in a worker so the page stays responsive. Receives the
 * picked folder's File objects, writes the converted assets to Cache Storage and reports progress.
 */
import { convertInBrowser } from '@crusaders/converter/hosts/browser';

export type ConvertWorkerMessage =
  | { t: 'log'; msg: string }
  | { t: 'done'; textures: number; models: number; levels: number; warnings: string[] }
  | { t: 'error'; message: string };

const post = (m: ConvertWorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<{ files: File[] }>) => {
  try {
    const report = await convertInBrowser(e.data.files, (msg) => post({ t: 'log', msg }));
    const m = report.manifest;
    post({ t: 'done', textures: Object.keys(m.textures).length, models: Object.keys(m.models).length, levels: Object.keys(m.levels).length, warnings: report.warnings });
  } catch (err) {
    post({ t: 'error', message: (err as Error).message ?? String(err) });
  }
};
