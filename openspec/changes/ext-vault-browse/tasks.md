## 1. Vault data layer

- [ ] 1.1 Add `src/vault/types.ts` and `src/vault/store.ts` with `readSnapshot`, `writeSnapshot`, `clearSnapshot` and `toItemMeta` on one `storage.local` key per account
  - Handles both the full row and the blocked row shape from ADR-003
  - `clearSnapshot` is called from the logout and account-removal paths of ext-accounts-and-unlock
- [ ] 1.2 Add `src/vault/sync.ts`: change probe (`updated_at` desc, limit 1, compare `updatedAt` and `total`), manifest fetch, 403/404 fallback to paginated secrets plus folders, types and suites, suite-change check, single in-flight promise, `SyncStatus`
  - Uses `src/api/client.ts`; 401 is delegated to the account layer, 423 sets `lastError: 'busy'`
  - A failed fallback leaves the previous snapshot untouched
- [ ] 1.3 Wire sync triggers in `entrypoints/background.ts`: `vault-sync` alarm with `SYNC_INTERVAL_MINUTES`, unlock and lock hooks, popup-open staleness check, `vault.sync` arm; add `alarms` and `unlimitedStorage` to `wxt.config.ts`
  - Alarm cleared on lock and logout; build both targets
- [ ] 1.4 Add `src/vault/match.ts` on `tldts` with `baseDomain`, `matchesBaseDomain`, `suggestionIds`; add the `tldts` dependency
- [ ] 1.5 Add the `vault.snapshot` and `item.decrypt` arms in `entrypoints/background.ts` and their types in `src/messages.ts`
  - `vault.snapshot` returns metadata only plus `suggestionIds` for `tabUrl`; refuses with `locked` or `logged_out`
  - `item.decrypt` batches ids, refuses blocked rows, never writes plaintext to storage

## 2. Popup shell

- [ ] 2.1 Rework `entrypoints/popup/index.html` and `popup.css`: 380 px width, 600 px max height with scrolling content, fixed header and tab bar regions, `data-theme` token overrides, popout fluid width
- [ ] 2.2 Add `entrypoints/popup/views/shell.ts` and `placeholder.ts`; rewrite `entrypoints/popup/main.ts` to bootstrap the shell: header with title, host and avatar slot, tab bar Vault/Generator/Send/Settings, view stack, locked and logged-out gating, `popup.lastTab` round trip
  - Tab bar hidden while locked or logged out; placeholders on Generator, Send, Settings
- [ ] 2.3 Add pop out: `popup.popout` arm in the background using `browser.windows.create` with `?popout=1&tabId=`, popup closes itself, button hidden in popout; add `tabs` permission
  - Verified on Chrome and Firefox builds

## 3. Vault list

- [ ] 3.1 Add `entrypoints/popup/views/filters.ts`: search input, folder dropdown (All items, flattened tree, No folder), type chips with More menu built from snapshot types; filters compose
- [ ] 3.2 Add `entrypoints/popup/views/vault-list.ts` and `item-card.ts` with `src/vault/icons.ts`: locale sort by name with id tiebreak, type icon, name, lazy login subtitle via batched `item.decrypt` for rows in view, blocked badge
- [ ] 3.3 Add `entrypoints/popup/views/suggestions.ts`: "Autofill suggestions" section from `suggestionIds`, host heading, hidden without an http(s) tab, "No items for <host>" when empty
- [ ] 3.4 Add card actions: Launch via `browser.tabs.create` (https prefix), Copy menu (username, password, verification code) through `src/clipboard.ts` and a toast, More menu with View enabled and Edit/Clone/Move/Delete disabled with tooltip
- [ ] 3.5 Add `clipboard.copied` arm, `clipboard-clear` alarm and `clearClipboard()` with the Chrome offscreen document (`entrypoints/offscreen/`, `offscreen` permission) and the Firefox page path (`clipboardWrite`)
  - Delay read from `settings.clearClipboardMs`, absent means never; build both targets
- [ ] 3.6 Add list states: syncing on first sync, empty vault, no matches with Clear filters, blocked-only, offline banner with "Last synced <relative>" and "Sync now", first-sync error with retry

## 4. Item detail

- [ ] 4.1 Add `src/totp/totp.ts` ported from the web app's `src/totp/totp.js`: otpauth and bare base32 parsing, SHA1/SHA256/SHA512, 6 or 8 digits, period, RFC 6238 code with WebCrypto, `secondsRemaining`
- [ ] 4.2 Add `entrypoints/popup/views/item-detail.ts`: back control restoring list state, header with type label and folder path, Login credentials (masked password, reveal, copy), TOTP code with countdown and invalid-seed state, Website, Additional fields (masked, `notes` routed to Notes), Notes, Metadata
- [ ] 4.3 Add card, identity, passkey, generic and blocked renderers to the detail view: card brand and last four derived in memory, BSN masked, passkey not-yet-supported note and no private key in the DOM, blocked reason with web app link
- [ ] 4.4 Add disabled Edit and Delete with tooltip; teardown stops TOTP timers and drops decrypted values on back, popup close and `vault.locked`

## 5. Verification

- [ ] 5.1 Add `vitest` with unit tests for `src/totp/totp.ts` (RFC 6238 test vectors), `src/vault/match.ts` (`co.uk` cases), folder flattening and search filtering
- [ ] 5.2 Run `npm run typecheck`, `npm run lint`, `npm run build` and `npm run build:firefox`; load `.output/chrome-mv3/` and `.output/firefox-mv2/` and walk the scenarios in the four specs
  - `grep -rn "chrome\." src/ entrypoints/` matches only comments
  - Offline check: stop the dev server, reopen the popup, confirm the banner and that Sync now recovers
