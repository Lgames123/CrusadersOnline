import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * In-browser conversion of the player's own installation (local only: skipped when the
 * installation folder is absent, e.g. in CI). Picks the folder through the real
 * `<input webkitdirectory>`, waits for the worker to finish and checks Cache Storage.
 */
const INSTALL = path.resolve(import.meta.dirname, '../..', process.env['GAME_INSTALL_DIR'] ?? 'Crusaders of Might and Magic');

test.skip(!existsSync(path.join(INSTALL, 'Textures', 'textures.zip')), 'original installation not available');

test('imports the original game files in the browser', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  page.on('console', (m) => console.log(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log(`[navigated] ${f.url()}`));
  page.on('crash', () => console.log('[crash]'));
  await page.goto('/');
  await page.evaluate(() => caches.delete('crusaders-generated'));
  await page.reload();
  const panel = page.locator('#game-files');
  await expect(panel).toBeVisible();
  await page.locator('#gf-folder').setInputFiles(INSTALL);
  await expect(page.locator('#gf-log')).toContainText('Done:', { timeout: Number(process.env['IMPORT_TIMEOUT'] ?? 9 * 60_000) });

  const stored = await page.evaluate(async () => {
    const cache = await caches.open('crusaders-generated');
    const manifest = await (await cache.match('/generated/manifest.json'))!.json();
    const level = await cache.match(`/generated/${manifest.levels['ca_a'].render}`);
    const model = await cache.match(`/generated/${manifest.models['drake']}`);
    return {
      textures: Object.keys(manifest.textures).length,
      models: Object.keys(manifest.models).length,
      levels: Object.keys(manifest.levels).length,
      placements: Object.keys(manifest.placements).length,
      sounds: Object.keys(manifest.audio).length,
      levelBytes: (await level!.arrayBuffer()).byteLength,
      modelType: model!.headers.get('content-type'),
    };
  });
  expect(stored.textures).toBeGreaterThan(2000);
  expect(stored.models).toBeGreaterThan(200);
  expect(stored.levels).toBeGreaterThanOrEqual(24);
  expect(stored.placements).toBeGreaterThanOrEqual(84);
  expect(stored.sounds).toBeGreaterThan(1000);
  expect(stored.levelBytes).toBeGreaterThan(100_000);
  expect(stored.modelType).toBe('model/gltf-binary');

  // After the reload the page is controlled by the service worker, which answers /generated/*
  // from Cache Storage (dev-server responses carry cache-control: no-store, cached ones do not).
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const served = await page.evaluate(async () => {
    const res = await fetch('/generated/manifest.json');
    return { ok: res.ok, cacheControl: res.headers.get('cache-control') };
  });
  expect(served).toEqual({ ok: true, cacheControl: null });
  await expect(page.locator('#game-files .status')).toHaveText('Imported in this browser.');
});
