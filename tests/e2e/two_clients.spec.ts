import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Two browser clients in one zone (M08 criterion 14 / testing-strategy.md §2.3):
 * player 1 moves and fights, player 2 sees the movement, the combat numbers and the despawn.
 * Input goes through the client's real keyboard/mouse handlers; pointer lock (unavailable to
 * headless browsers) is bypassed through the dev-only `window.__co` hook.
 */

interface Co {
  input: { locked: boolean; yaw: number };
  session: { entityId: number; connected: boolean; inventory: { items: { name: string }[] } | null };
  player: { character: { position: { x: number; z: number } } };
  remotes: { byId: Map<number, { avatar: { object: { position: { x: number; z: number } } } }> };
}

async function joinAsGuest(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (err) => {
    throw err;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play as guest' }).click();
  await page.waitForFunction(() => {
    const co = (window as unknown as { __co?: Co }).__co;
    return !!co?.session?.connected && co.session.entityId > 0;
  });
  // Pretend the pointer is locked so the input manager accepts keys and clicks.
  await page.evaluate(() => {
    const co = (window as unknown as { __co: Co }).__co;
    co.input.locked = true;
    co.input.yaw = 0; // face -Z, towards the skeleton
  });
  return page;
}

const entityId = (p: Page) => p.evaluate(() => (window as unknown as { __co: Co }).__co.session.entityId);
const selfPos = (p: Page) => p.evaluate(() => ({ ...(window as unknown as { __co: Co }).__co.player.character.position }));
const remotePos = (p: Page, id: number) =>
  p.evaluate((id) => {
    const r = (window as unknown as { __co: Co }).__co.remotes.byId.get(id);
    return r ? { x: r.avatar.object.position.x, z: r.avatar.object.position.z } : null;
  }, id);

test('player 2 sees player 1 move, fight and leave', async ({ browser }) => {
  const p1 = await joinAsGuest(browser);
  const p2 = await joinAsGuest(browser);
  const id1 = await entityId(p1);

  // Both start with the starting kit.
  expect(await p1.evaluate(() => (window as unknown as { __co: Co }).__co.session.inventory?.items.map((i) => i.name))).toEqual(['Axe', 'Wooden Shield']);

  // Player 2 has player 1 as a remote entity.
  await expect.poll(() => remotePos(p2, id1)).not.toBeNull();
  const before = (await remotePos(p2, id1))!;

  // Player 1 runs forward for ~1.3 s (about 6 m at the original run speed: into aggro range).
  await p1.keyboard.down('KeyW');
  await p1.waitForTimeout(1300);
  await p1.keyboard.up('KeyW');
  const moved = await selfPos(p1);
  expect(before.z - moved.z).toBeGreaterThan(3);

  // Player 2's interpolated view converges on player 1's predicted position.
  await expect
    .poll(async () => {
      const seen = (await remotePos(p2, id1))!;
      return Math.hypot(seen.x - moved.x, seen.z - moved.z);
    }, { timeout: 5000 })
    .toBeLessThan(0.1);

  // The skeleton aggroes; player 1 swings until player 2 sees a damage number.
  const floatersOn2 = () => p2.locator('#world-ui .floater').count();
  const start = await floatersOn2();
  let seenCombat = false;
  for (let i = 0; i < 80 && !seenCombat; i++) {
    await p1.mouse.down({ button: 'left' });
    await p1.mouse.up({ button: 'left' });
    await p1.waitForTimeout(250);
    seenCombat = (await floatersOn2()) > start;
  }
  expect(seenCombat).toBe(true);

  // Player 1 leaves; player 2 sees the despawn.
  await p1.context().close();
  await expect.poll(() => remotePos(p2, id1), { timeout: 5000 }).toBeNull();
  await p2.context().close();
});
