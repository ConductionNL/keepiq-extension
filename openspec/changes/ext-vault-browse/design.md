## Context

ext-accounts-and-unlock leaves the extension able to authenticate (`src/api/client.ts`), derive and hold the private key per ADR-002, and decrypt fields (`src/crypto/`). This change adds the first thing a user sees after unlocking: a cached, browsable, read-only vault inside a Bitwarden-style popup. The template's split is kept: the background owns state and every `browser.*` API the popup cannot reach, the popup is a fresh stateless document each time it opens, and every envelope crossing a runtime boundary is typed in `src/messages.ts` and asserted from `unknown` at the listener (WXT-AND-BROWSERS.md § 3).

Server facts come from ADR-003; the caching rules from ADR-002. Keepiq's own `offline-readonly-cache` spec (in the Keepiq app repo) is the model for stale-data and read-only-offline behaviour.

## Goals / Non-Goals

**Goals:**
- One sync pipeline (`src/vault/sync.ts`) with a manifest fast path and a paginated fallback, replacing the snapshot atomically.
- A popup shell that later changes extend by adding a tab view, without touching the frame.
- List and detail views that render from plaintext metadata first and decrypt lazily in the background.
- A shared base-domain matcher (`src/vault/match.ts`) that ext-autofill reuses.
- A TOTP module (`src/totp/totp.ts`) that matches the web app's parsing rules.

**Non-Goals:**
- Any write to the vault (ext-vault-edit), filling (ext-autofill), generator, send, settings UI.
- Website icons, favourites, collections, organisations.
- Virtualised lists.
- Decrypting rows for search.

## Decisions

- **Sync schedule uses `browser.alarms`, not `setInterval`.** An MV3 service worker dies after about 30 seconds idle and takes timers with it; alarms survive and wake the worker on both MV3 and MV2. `SYNC_INTERVAL_MINUTES = 15` is exported from `src/vault/sync.ts` and used for the alarm period and the popup-open staleness test. Alternative: `setInterval` in the background, which silently stops on Chrome.
- **Probe before pulling.** Scheduled and popup-open syncs first call `GET /api/v1/secrets?sort=updated_at&direction=desc&limit=1` and compare `updatedAt` of the first row and `total` with the last snapshot; unchanged means one request and no rewrite (ADR-002). Unlock, local writes and "Sync now" skip the probe. Alternative: always pull the manifest, which re-downloads the whole vault every 15 minutes for nothing.
- **Manifest first, then paginated fallback.** `GET /api/v1/offline/manifest` (`OfflineController::manifest`) returns the whole vault in one round trip; 403 (admin disabled) and 404 (no active suite) switch to `GET /api/v1/secrets?limit=100&page=N` (`SecretController::index`) plus `GET /api/v1/folders`, `GET /api/v1/secret-types`, `GET /api/v1/suites`. Both paths produce the same `VaultSnapshot`. Alternative: always paginate, which costs several requests for nothing on the default configuration.
- **One `storage.local` key per account holds the whole snapshot.** `storage.local.set({ ['vault:' + accountId]: snapshot })` is a single write, so it is atomic for readers and trivially cleared. Plaintext metadata is stored as the server returns it, per ADR-002 (the web app encrypts metadata at rest under a key the extension deliberately never persists). `unlimitedStorage` is requested because Firefox caps `storage.local` at 5 MB without it and a few thousand RSA blobs approach that. Alternative: per-row keys, which need a transaction the API does not offer.
- **Decryption stays in the background.** `item.decrypt` takes a list of ids and the fields wanted and returns plaintext; the popup never sees ciphertext or the key. Batched ids keep list rendering to one message per visible page of rows. Alternative: send the key to the popup, which widens the exposure surface for no gain.
- **Copy is done by the popup, clear by the background.** `navigator.clipboard.writeText` works in the popup under a user gesture on both browsers. The popup then sends `clipboard.copied`; the background reads `settings.clearClipboardMs` (absent until ext-settings, meaning never) and schedules a `clipboard-clear` alarm. Clearing needs a document: on Chrome MV3 an offscreen document (`entrypoints/offscreen/`, `offscreen` permission, reason `CLIPBOARD`), on Firefox MV2 the persistent background page with `clipboardWrite`. `src/clipboard.ts` hides the split behind `clearClipboard()`. Alternative: a popup-side timer, which dies when the popup closes, which is always.
- **Base domain via `tldts`.** Bitwarden's default match is base domain using the public suffix list; a two-label heuristic breaks on `co.uk`. `tldts` bundles the list, runs offline and is about 40 KB. `src/vault/match.ts` exposes `baseDomain(url)` and `matchesBaseDomain(itemUrl, tabUrl)`; the other Bitwarden match modes belong to ext-autofill. Matching runs in the background so the popup receives ids only (ADR-002).
- **TOTP is a TypeScript port of the web app's `src/totp/totp.js`.** Same acceptance rules (otpauth URI or bare base32, SHA1/6/30 defaults, HOTP rejected) so a seed that works in Keepiq works here. Computed in the popup with WebCrypto HMAC since the popup already holds the decrypted seed for display. Alternative: a third-party OTP library, which adds a dependency for 80 lines.
- **Search is plaintext only.** `name` and `url` are the only searchable plaintext fields (ADR-003). Decrypting every row per keystroke is a no-go at RSA-4096 cost. Recorded as a deviation.
- **Type icons, no favicons.** The web app's `src/utils/favicon.js` fetches `<favicon_service_url>/{domain}` only when an admin configured that template, which is not exposed on any API route. A third-party icon service would also send every vault domain to that service. Type icons follow the web app's `typeIconName` mapping. Alternative: Bitwarden's icon server, which is a third party to Keepiq users.
- **Vanilla TypeScript views, one module per view.** The template has no framework and the popup is small; `entrypoints/popup/views/*.ts` export `mount(container, ctx): () => void` (the return tears the view down and drops decrypted state). A simple in-memory view stack in `shell.ts` handles list to detail and back. Alternative: adopt Vue as the web app does, a larger decision that should be taken once, by ext-accounts-and-unlock or not at all.
- **Last tab in `storage.session`, guarded.** Bitwarden reopens on the vault but restores the last route in some flows; keeping just the tab id is the useful part. `storage.session` is absent below Firefox 115, so the background falls back to a memory variable, exactly as ADR-002 does for the key.
- **Pop out via `browser.windows.create`.** Identical on MV3 and MV2. The tab that was active is passed as `?tabId=` because `tabs.query({ active: true })` in a popout window returns the popout itself. Bitwarden's `uilocation=popout` is the model.
- **Active tab read with `tabs` permission.** `activeTab` would cover the toolbar popup but not the popout window or later autofill work; Bitwarden requests `tabs`. `browser.tabs.query({ active: true, lastFocusedWindow: true })` works on both browsers.
- **No tab bar while locked.** Bitwarden shows only the unlock screen while locked. Adopted for the tab bar; the unlock view's "Generate a password" link (ext-generator) is the one deliberate exception, since generation needs no key material.
- **Theme via tokens and `data-theme`.** The existing `popup.css` tokens gain `:root[data-theme="light"]` and `:root[data-theme="dark"]` blocks so ext-settings can set one attribute. Component CSS only references tokens.

## Module layout

Added:

- `src/vault/types.ts`: `SecretRow`, `BlockedRow`, `FolderRow`, `TypeRow`, `SuiteRow`, `VaultSnapshot`, `SyncStatus`, `ItemMeta` (the metadata projection sent to the popup).
- `src/vault/store.ts`: `readSnapshot(accountId)`, `writeSnapshot(accountId, snapshot)`, `clearSnapshot(accountId)`, `toItemMeta(row)`.
- `src/vault/sync.ts`: `SYNC_INTERVAL_MINUTES`, `sync(accountId)` with the in-flight promise, manifest and fallback fetchers, suite-change check, `scheduleSyncAlarm()`, `cancelSyncAlarm()`.
- `src/vault/match.ts`: `baseDomain(url)`, `matchesBaseDomain(itemUrl, tabUrl)`, `suggestionIds(rows, tabUrl)`.
- `src/vault/icons.ts`: type name to icon id, mirroring the web app's mapping.
- `src/totp/totp.ts`: `parseTotpSeed(value)`, `generateCode(params, now)`, `secondsRemaining(period, now)`.
- `src/clipboard.ts`: `copyText(text)` for the popup, `clearClipboard()` for the background with the Chrome offscreen and Firefox page paths.
- `entrypoints/offscreen/index.html`, `entrypoints/offscreen/main.ts`: Chrome-only clipboard-clear document (`include: ['chrome']`).
- `entrypoints/popup/views/shell.ts`: header, tab bar, view stack, locked and logged-out gating, popout detection.
- `entrypoints/popup/views/vault-list.ts`, `item-card.ts`, `filters.ts`, `suggestions.ts`, `item-detail.ts`, `placeholder.ts`, `toast.ts`.

Edited:

- `entrypoints/background.ts`: message arms for `vault.sync`, `vault.snapshot`, `item.decrypt`, `clipboard.copied`, `popup.popout`; alarm listener for `vault-sync` and `clipboard-clear`; hooks on unlock, lock and logout from ext-accounts-and-unlock.
- `entrypoints/popup/index.html`, `main.ts`, `popup.css`: shell markup, bootstrap, tokens and layout.
- `src/messages.ts`: the types below.
- `wxt.config.ts`: `permissions` gain `alarms`, `tabs`, `unlimitedStorage`; `offscreen` added when `browser === 'chrome'`; `clipboardWrite` when `browser === 'firefox'`.
- `package.json`: `tldts` dependency; `vitest` dev dependency if task 5.1 is taken.

## Message contract

Additions to `src/messages.ts`. Kinds use `<area>.<verb>`; every listener still asserts from `unknown`.

```ts
export type PopupToBackground =
	| { kind: 'vault.sync' }
	| { kind: 'vault.snapshot'; tabUrl?: string }
	| { kind: 'item.decrypt'; ids: string[]; fields: Array<'login' | 'key' | 'additionalFields'> }
	| { kind: 'clipboard.copied' }
	| { kind: 'popup.popout'; tabId?: number }
	| { kind: 'popup.lastTab.get' }
	| { kind: 'popup.lastTab.set'; tab: PopupTab }

export type PopupTab = 'vault' | 'generator' | 'send' | 'settings'

export interface SyncStatus {
	syncing: boolean
	syncedAt: string | null
	offline: boolean
	lastError: 'network' | 'server' | 'busy' | null
}

export interface ItemMeta {
	id: string
	name: string
	url: string | null
	typeId: string
	folderId: string | null
	hasLogin: boolean
	blocked: boolean
	blockedReason?: string
	migrationError?: string | null
	createdAt: string
	updatedAt: string
	expiresAt: string | null
}

export type VaultSnapshotReply =
	| { state: 'logged_out' }
	| { state: 'locked' }
	| {
		state: 'unlocked'
		items: ItemMeta[]
		folders: Array<{ id: string; name: string; parentId: string | null }>
		types: Array<{ id: string; name: string; label: string }>
		suggestionIds: string[]
		sync: SyncStatus
	}

export type DecryptReply =
	| { ok: true; items: Record<string, { login?: string; key?: string; additionalFields?: string }> }
	| { ok: false; error: 'locked' | 'blocked' | 'decrypt_failed' }

export type BackgroundToPopup =
	| { kind: 'vault.changed'; sync: SyncStatus }
	| { kind: 'vault.locked' }
```

`vault.sync` replies with `SyncStatus` when the sync settles. `vault.changed` and `vault.locked` are broadcast with `browser.runtime.sendMessage` and ignored when no popup is open (the promise rejects, caught).

## Risks / Trade-offs

- [RSA-4096 decrypt per row is 5 to 10 ms; a 500 row vault would take seconds to subtitle] → Decrypt only rendered rows, in batches of 20 as they scroll into view with `IntersectionObserver`; cache in popup memory for the popup's lifetime.
- [No list virtualisation] → Fine below about 2000 rows; if a vault exceeds it, the list truncates with "Showing first 2000, refine your search" until a later change adds virtualisation.
- [MV3 worker restarts mid-sync] → Sync is idempotent and the snapshot write is atomic; the alarm refires; the in-flight promise is per worker generation and a restart simply retries.
- [`storage.local` quota] → `unlimitedStorage` requested; snapshot size logged at debug level.
- [Clipboard clear silently fails when the offscreen document cannot be created] → The copy still succeeds; failure to clear is logged, never surfaced as a copy error. ext-settings shows the delay only when the mechanism reports available.
- [`tldts` list ages] → Bundled list updated with normal dependency updates; matching errs toward not suggesting, never toward filling elsewhere.
- [Client clock skew breaks TOTP] → Same trade-off as every authenticator app; no server time is available. Noted in the detail view help.
- [Manifest rows never use the blocked shape, fallback rows do] → `toItemMeta` handles both shapes from one row type; blocked-only detection runs on the stored rows regardless of source.
- [`tabs.query` in a popout returns the popout window] → `tabId` passed in the popout URL and used instead.

## Open Questions

- Sync interval value: 15 minutes proposed; confirm against the reviewer's Bitwarden reference.
- Whether "Sync now" also belongs in the Vault tab header when not offline, or only in ext-settings.
- Whether to add an "also match username when unlocked" search option that decrypts lazily as the user types, accepting the cost.
- Where the "Show website icons" setting gets its icon URL template if Keepiq's API later exposes `favicon_service_url`.
- Whether `storage.session` is the right home for `popup:lastTab` or Bitwarden's plain "always open on Vault" is preferable.
- Vue versus vanilla TypeScript for popup views, if ext-accounts-and-unlock has not already decided.
