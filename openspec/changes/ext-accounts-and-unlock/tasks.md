## 1. Manifest and message contract

- [ ] 1.1 Edit `wxt.config.ts`: add `alarms` and `idle` to `permissions`; add `optional_host_permissions: ['https://*/*', 'http://*/*']` for Chrome and the same patterns under `optional_permissions` for Firefox by branching on the `browser` argument; leave `strict_min_version` at `109.0` and `manifestVersion` unset.
  - Both generated manifests contain the two permissions and the optional origin patterns in the right key.
- [ ] 1.2 Rewrite `src/messages.ts` to the contract in design.md (`AccountSummary`, `PopupState`, `ErrorCode`, `Result`, the new `PopupToBackground` arms) and remove `get_state`, `set_enabled`, `enabled_changed` and the old `PopupState`; keep `ContentToBackground` with `page_ready`.
  - `npm run typecheck` fails only in `background.ts` and `popup/main.ts`, which later tasks rewrite.

## 2. Crypto module

- [ ] 2.1 Create `src/crypto/base64.ts`, `src/crypto/envelope.ts` (decode the `[version][salt][iv][ciphertext||tag]` layout, reject version not 1) and `src/crypto/kdf.ts` (PBKDF2-SHA256, 600 000 iterations, non-extractable AES-GCM key) per ADR-003.
  - The derived key is used for one `decrypt` call and never stored.
- [ ] 2.2 Create `src/crypto/rsa.ts`: PEM to PKCS#8 import (`RSA-OAEP`, `SHA-256`, `extractable: false`, `['decrypt']`), X.509 DER walk to the SPKI and public key import (`['encrypt']`), chunked decrypt (read big-endian count, decrypt 512-byte blocks, concatenate, decode UTF-8 once) and chunked encrypt (446-byte chunks, empty string as one zero-length chunk); export from `src/crypto/index.ts`.
  - Compare the DER walk against the web app's handling of the optional `[0]` version tag.
- [ ] 2.3 Add `vitest` as a dev dependency with a `test` script and write `src/crypto/*.test.ts`: envelope encode and decode round trip, wrong-version rejection, PBKDF2 plus AES-GCM round trip with a wrong password failing on the tag, RSA chunked round trip for empty, one-chunk, multi-chunk and multi-byte UTF-8 straddling a chunk boundary.
  - Tests run under Node's WebCrypto; no browser needed.

## 3. API client

- [ ] 3.1 Create `src/api/types.ts` with the shapes from ADR-003: suite row, secret row as a union of the normal and `blocked: true` shapes, folder, secret type, `{items, total, page, limit}`, offline manifest, user settings, OCS user envelope.
- [ ] 3.2 Create `src/api/client.ts`: `createClient(account)` with base URL, Basic auth, `OCS-APIRequest: true`, `Accept: application/json`, `credentials: 'omit'`, JSON body on writes; error classes `ApiError`, `SessionRevoked`, `VaultWriteLocked`, `Offline`, `KeepiqNotInstalled`; `onUnauthorized` hook; refuse calls when `appPassword` is `null`; `fetchIdentity` (unwrap `ocs.data`) and `fetchAvatarDataUrl` (`/index.php/avatar/{uid}/64` to a data URL, `null` on non-2xx).
  - 401 calls the hook exactly once before rejecting; 423 and network failures never call it.

## 4. Account store

- [ ] 4.1 Create `src/accounts/normalize-origin.ts`: accept bare host, origin or any `/index.php/apps/keepiq` URL, return the origin, default to `https`, allow `http` only for `localhost`, `127.0.0.1`, `*.test` and `*.local`; return `invalid_url` or `insecure_url` codes.
- [ ] 4.2 Create `src/accounts/store.ts`: `storage.local` schema (`accounts`, `activeAccountId`, `settings.<id>` with defaults 15 minutes and `lock`), `add`, `reauthenticate`, `remove` (purges `accounts[id]`, `settings.<id>`, `suite.<id>`, `vaultCache.<id>`, `neverLockKey.<id>` and the key, then picks the next active account), `removeAll`, `setActive`, `markLoggedOut` (app password, key, suite row and vault cache only), the 5-account limit and the origin plus uid duplicate check; register `markLoggedOut` as the client's `onUnauthorized` hook.
  - Status is derived from `appPassword` and the key store, never stored.
- [ ] 4.3 Create `src/accounts/verify.ts`: identity then suites through the client, map failures to `unreachable`, `not_nextcloud`, `unauthorized`, `keepiq_missing`, `no_active_suite`; on success cache the active suite row under `suite.<id>`, fetch the avatar and return the record fields taken from the identity response.

## 5. Unlock and lock engine

- [ ] 5.1 Create `src/vault/key-store.ts`: `storage.session` backend when present, module `Map` backend otherwise; `put`, `get` (re-import bytes to a non-extractable `CryptoKey` once per worker generation), `clear`, `clearAll`; read `neverLockKey.<id>` from `storage.local` after a restart when the account's timeout is `never`, and delete it on every clear.
- [ ] 5.2 Create `src/vault/unlock.ts`: `unlock(accountId, method)` that fetches and caches the suite when `suite.<id>` is absent (`offline_no_cache` on network failure), decodes the envelope, derives, decrypts (`invalid_master_password` on GCM failure), imports and stores the key with `unlockedAt.<id>`; `lock`, `lockAll`, `logoutForTimeout`; `checkSuite(row)` that purges the cache and key when `id` or `unlockKeyEpoch` changed.
  - The master password string is not retained after `unlock` returns.
- [ ] 5.3 Create `src/vault/timeout.ts`: option and action types, `TIMEOUT_POLICY`, `touch()` writing `lastInteractionAt`, `enforce()` locking or logging out every account past its timeout, `vault-timeout` alarm with `periodInMinutes: 1` created while any account is unlocked and cleared otherwise, `browser.idle.onStateChanged` handling `locked` for the `onSystemLock` option, and popup port `onDisconnect` handling `immediately`.
- [ ] 5.4 Rewrite `entrypoints/background.ts`: remove the flag and badge code; route every `PopupToBackground` arm to the store, unlock and timeout modules and return `Result`; call `enforce()` before answering `vault.status`; register the alarm, idle and `runtime.onConnect` listeners at top level so an MV3 wake-up re-registers them.
  - Request/response arms return the promise; nothing returns `true`.

## 6. Popup

- [ ] 6.1 Rewrite `entrypoints/popup/index.html` and `main.ts`: header with title and avatar slot, a view root, `request.ts` with the typed `send()` wrapper and the `popup` port, `main.ts` requesting `vault.status` and rendering the view for `state.screen`; create `views/add-account.ts` covering both the add and "Log in again" modes, with the security settings link, `browser.permissions.request` in the click handler, code to message mapping and preserved field values on error.
- [ ] 6.2 Create `views/unlock.ts` (identity, masked field with show/hide, busy state on Unlock, "Log out" link that calls `accounts.remove`, "Invalid master password" and offline errors) and `views/unlocked.ts` (identity, Lock button, note that ext-vault-browse replaces this view).
- [ ] 6.3 Create `views/account-switcher.ts`: panel opened from the header avatar listing accounts with avatar or initials, display name, host, status label, active marker, per-account Lock and Log out, Lock all, Log out all with confirmation, Add account disabled at 5 with the limit hint.
- [ ] 6.4 Extend `entrypoints/popup/popup.css` for form fields, the avatar disc, list rows, the switcher panel and error text; keep `color-scheme: light dark` and the 280 px width or widen to 320 px if the switcher rows need it.

## 7. Verification

- [ ] 7.1 Run `grep -rn "chrome\." src/ entrypoints/` (only comments may match), `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run build:firefox`; load `.output/chrome-mv3/` and `.output/firefox-mv2/manifest.json` and walk through: add account against the dev backend, each verification error, unlock, wrong master password, manual lock, Immediately, 1 minute timeout with the popup closed, timeout action Log out, 401 after revoking the app password in Nextcloud, switch between two accounts, Log out all.
  - Confirm on Firefox that the account stays unlocked across a popup close and locks after a browser restart.
