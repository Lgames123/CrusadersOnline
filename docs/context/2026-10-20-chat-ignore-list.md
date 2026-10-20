# Chat ignore list (client-side)

Date: 2026-10-20 · Agent: Claude Code · Commit: Chat ignore list kept in the browser: /ignore, /unignore, /ignored and right-click a name

## Why
User decision (2026-10-19): an ignore list is worth having, as a client feature with a local list
filtered on display.

## Decisions and evidence
- The list lives in `localStorage` `crusaders.chat.ignored` (lower-cased names, 200 at most).
- Lines from an ignored name are dropped on arrival, on every tab including whispers. Staff
  lines (kind admin) are never dropped.
- `/ignore <name>` (`/block`), `/unignore <name>` (`/unblock`), `/ignored`, or right-click a name
  in the log to toggle it.

## Deviations from the original
- Not original (the original has no chat).

## Not done / not decoded
- The server still sends the lines: no server-side block, and the list is per browser, not per
  account.

## How to verify
- In a client page:
  - `new (await import('/src/ui/chat.ts')).ChatWindow(div)`;
  - add a line from Bob, `setIgnored('Bob', true)`, add another;
  - only the first shows; after `setIgnored('bob', false)`, Bob's lines show again (checked).
