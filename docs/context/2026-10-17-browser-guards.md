# Browser features kept out of the game's inputs

Date: 2026-10-17 · Agent: Claude Code · Commit: The browser's right-click menu, text selection and shortcuts stay out of the game

## Why
Right-click (block) opened the browser menu outside pointer lock, drags/double-clicks highlighted UI text, and browser shortcuts could fire mid-fight.

## Decisions and evidence
- One module, `client/src/input/browser_guards.ts`, installed at the top of `main()` so the title/front end is covered too; it replaces InputManager's locked-only contextmenu guard.
- Always: no context menu, selection or native drag (except in text fields), no middle-click autoscroll, no mouse back/forward (buttons 3/4 are bindable), no page zoom (Ctrl+wheel, Ctrl +/-/0).
- While the pointer is locked: every keydown's default is cancelled (Alt/F10 menu, F3/Ctrl+F, F5/Ctrl+R, Ctrl+S/P/D, Firefox quick find, Tab focus), except F11, F12, Ctrl+Shift+I/J.
- CSS: `user-select: none` on body, text again on input/textarea/contenteditable; no image drag, touch callout or tap flash.

## Not done / not decoded
- Ctrl+W/T/N and Esc cannot be taken by a page (Keyboard Lock API needs fullscreen); no beforeunload prompt added.

## Gotchas
- Listeners only cancel defaults, never stop propagation: the inventory's own contextmenu (sell/split) still runs. Do not check `defaultPrevented` in game key handlers — every locked keydown is now prevented.

## How to verify
- Title screen: right-click shows no menu, double-click/drag selects nothing, the login fields still select and offer copy/paste. In game: Ctrl+F / F5 do nothing while locked.
