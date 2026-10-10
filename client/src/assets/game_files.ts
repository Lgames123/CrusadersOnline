import type { ConvertWorkerMessage } from './convert_worker.ts';

/**
 * The player's own game files, converted in their browser (production) or by `pnpm convert`
 * (development). The service worker serves Cache Storage contents at /generated/*; the dev
 * server serves local/generated at the same URLs. Nothing from the original game is hosted.
 */
export const GENERATED_CACHE = 'crusaders-generated';

/** Registers the /generated/* service worker and waits until it controls the page. */
export async function registerAssetServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/assets-sw.js', { scope: '/' });
    if (navigator.serviceWorker.controller) return;
    await Promise.race([
      new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (err) {
    console.warn('[assets] service worker unavailable:', err);
  }
}

/** True when converted assets are available (imported in this browser, or the dev server). */
export async function hasGameFiles(): Promise<boolean> {
  try {
    const res = await fetch('/generated/manifest.json', { cache: 'no-store' });
    return res.ok && (res.headers.get('content-type') ?? '').includes('json');
  } catch {
    return false;
  }
}

/** True when this browser holds its own conversion (as opposed to the dev server's). */
export async function hasImportedGameFiles(): Promise<boolean> {
  try {
    return !!(await (await caches.open(GENERATED_CACHE)).match('/generated/manifest.json'));
  } catch {
    return false;
  }
}

export async function removeImportedGameFiles(): Promise<void> {
  await caches.delete(GENERATED_CACHE);
}

/**
 * Converts the picked installation folder in a worker. Resolves with a summary; `onLog`
 * receives the converter's progress lines.
 */
export function importGameFolder(files: File[], onLog: (msg: string) => void): Promise<Extract<ConvertWorkerMessage, { t: 'done' }>> {
  return new Promise((resolve, reject) => {
    void navigator.storage?.persist?.(); // ask the browser not to evict ~200 MB of converted assets
    const worker = new Worker(new URL('./convert_worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ConvertWorkerMessage>) => {
      const m = e.data;
      if (m.t === 'log') onLog(m.msg);
      else {
        worker.terminate();
        if (m.t === 'done') resolve(m);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'conversion worker failed'));
    };
    worker.postMessage({ files });
  });
}
