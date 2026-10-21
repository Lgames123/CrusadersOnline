import { hasGameFiles, hasImportedGameFiles, importGameFolder, removeImportedGameFiles } from '../assets/game_files.ts';

/**
 * "Original game files" panel (shown while not playing): status, import from the player's own
 * installation folder (converted locally, nothing is uploaded) and removal of the local copy.
 */
export class GameFilesPanel {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  async init(): Promise<void> {
    const available = await hasGameFiles();
    const imported = available && (await hasImportedGameFiles());
    this.root.innerHTML = `
      <div class="title">Original game files</div>
      <div class="status">${available ? (imported ? 'Imported in this browser.' : 'Provided by the development server.') : 'Not installed — the game uses placeholder graphics.'}</div>
      <p class="hint">CrusadersOnline uses your own copy of <i>Crusaders of Might and Magic</i>. Pick its installation folder; it is converted here, in your browser, and never uploaded.</p>
      <label class="button"><input type="file" id="gf-folder" webkitdirectory multiple hidden />${available ? 'Re-import…' : 'Import from your installation…'}</label>
      ${imported ? '<button type="button" class="secondary" id="gf-remove">Remove</button>' : ''}
      <pre class="log" id="gf-log" hidden></pre>`;
    const input = this.root.querySelector<HTMLInputElement>('#gf-folder')!;
    input.addEventListener('change', () => void this.run([...(input.files ?? [])]));
    this.root.querySelector('#gf-remove')?.addEventListener('click', async () => {
      await removeImportedGameFiles();
      location.reload();
    });
  }

  private async run(files: File[]): Promise<void> {
    const log = this.root.querySelector<HTMLElement>('#gf-log')!;
    log.hidden = false;
    const lock = (on: boolean) => this.root.querySelectorAll('label, button').forEach((el) => ((el as HTMLElement).style.pointerEvents = on ? 'none' : ''));
    await importInstallFolder(files, log, lock);
  }
}

/** Store page of the original game (the player needs their own copy). */
export const GOG_URL = 'https://www.gog.com/en/game/crusaders_of_might_and_magic';

/**
 * Converts a picked installation folder, writing progress into `log` (last six lines); reloads
 * the page when done. `lock` disables the picker while the conversion runs.
 */
export async function importInstallFolder(files: File[], log: HTMLElement, lock: (on: boolean) => void): Promise<void> {
  const lines: string[] = [];
  const show = (m: string) => {
    lines.push(m);
    log.textContent = lines.slice(-6).join('\n');
  };
  const names = files.map((f) => (f.webkitRelativePath || f.name).toLowerCase());
  if (!names.some((n) => n.endsWith('/textures/textures.zip')) || !names.some((n) => n.endsWith('/script/models.ctx'))) {
    show('That folder does not look like a Crusaders of Might and Magic installation (Textures/textures.zip and script/models.ctx are missing).');
    return;
  }
  lock(true);
  show(`Converting ${files.length} files… this takes a minute or two.`);
  try {
    const r = await importGameFolder(files, show);
    show(`Done: ${r.textures} textures, ${r.models} models, ${r.levels} levels${r.warnings.length ? ` (${r.warnings.length} warnings)` : ''}. Reloading…`);
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    show(`Import failed: ${(err as Error).message}`);
    lock(false);
  }
}
