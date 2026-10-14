# Default to login screen on page refresh

Date: 2026-10-14 · Agent: Antigravity · Commit: Default to login screen on page refresh

## Why
When refreshing the browser while logged in, the game previously skipped the login screen directly into server selection (`fe-realm-screen`). Refreshing should consistently present the initial login screen (`fe-login-screen`) by default, allowing the user to click "Log in" to proceed.

## Decisions and evidence
- Retain `activeAccount` resolved from `/api/auth/me` on startup, but route default navigation into `loginScreen(serverDown)` instead of skipping directly to `realmScreen(account)`.
- If an active session matches the entered account name on `loginScreen`, password requirement is waived (`pass.required = false`), placeholder indicates active session, and submitting the form transitions immediately to `realmScreen(activeAccount)` without re-authenticating.
- Explicit in-game "Change character" reload (`CHARACTER_SCREEN_FLAG`) remains preserved to enter `characterScreen` when requested from inside the world.

## Deviations from the original
- MMO frontend flow adjustment.

## How to verify
- Log in to an account, reach the server selection or enter the world, then refresh the page (F5).
- Verify the game renders `<div class="fe-screen fe-login-screen">` with the account name populated.
- Press Enter or click "Log in" and verify it advances to server selection with the active session.
