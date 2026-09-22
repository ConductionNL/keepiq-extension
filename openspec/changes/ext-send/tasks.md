## 1. Dependency and manifest

- [ ] 1.1 Add `hash-wasm` to `package.json` and set `content_security_policy` in `wxt.config.ts` per manifest version (object with `extension_pages` for MV3, string for MV2), both carrying `'wasm-unsafe-eval'`
  - `npm run build` and `npm run build:firefox` produce manifests with the CSP in the right shape for each target
  - No `manifestVersion` is set globally (WXT-AND-BROWSERS.md § 2)

## 2. Send module

- [ ] 2.1 Write `src/send/argon2.ts`: `isArgon2Available()` and `deriveSendKey(password, salt)` with the ADR-003 Argon2id parameters, lazy-importing `hash-wasm`
  - Returns a non-extractable AES-GCM `CryptoKey`
- [ ] 2.2 Write `src/send/crypto.ts`: content key generation, IV-prefixed AES-256-GCM blob, `wrapContentKey`, base64 and base64url helpers matching the web app's `ephemeralSend.js`
  - A blob produced here decrypts with the web app's `aesDecrypt` (verified in task 4.1)
- [ ] 2.3 Write `src/send/payload.ts` (credential two-line body, row label from type and `createdAt`) and `src/send/expiry.ts` (presets to `ttlSeconds`, custom hours 1 to 720, `MAX_VIEWS_CAP`, `TTL_CAP_SECONDS`)
- [ ] 2.4 Write `src/send/api.ts`: `listSends`, `createSend`, `deleteSend` over the API client, mapping HTTP errors to `SendError`
  - 401 goes through the API client's logout rule (ADR-002), 404 on delete maps to `not_found`, 400 keeps the server `message`
- [ ] 2.5 Write `src/send/link.ts`: `buildShareLink(baseUrl, token, rawKey | null)` producing `<base>/public/send/<token>` plus `#k=` base64url without padding when a raw key is given
- [ ] 2.6 Add the send types and the four `send.*` message kinds to `src/messages.ts` as sketched in design.md
- [ ] 2.7 Write `src/send/handlers.ts` and dispatch `send.*` kinds from `entrypoints/background.ts`
  - Handlers refuse with `locked` when no private key is present and with `offline` when the API client reports offline
  - No input, content key or link is referenced after the reply is returned

## 3. Popup

- [ ] 3.1 Write `entrypoints/popup/send/state.ts` and `entrypoints/popup/send/list.ts`: session list cache, session `Map` of links, rows with type icon, label, views counter, expiry, Password badge, Copy link or "Link no longer available", Remove with confirm, empty state, error state with Retry
  - Copy link uses the shared clipboard helper so auto-clear applies
- [ ] 3.2 Write `entrypoints/popup/send/new.ts`: type switch, content fields, Max views, Expiry presets and Custom, Password with show/hide, validation messages, offline and Argon2-unavailable disabled states, busy state during create
- [ ] 3.3 Write `entrypoints/popup/send/created.ts`: read-only link field, Copy, the shown-once note with the view count, Done back to the refreshed list
- [ ] 3.4 Mount the Send tab in `entrypoints/popup/index.html`, `main.ts` and `popup.css`, and add the Send entry to the item More menu from ext-vault-browse that calls `send.prefillFromItem` and opens the form prefilled
  - Entry is hidden for non-login and blocked items and disabled while offline

## 4. Verification

- [ ] 4.1 Manually verify against the dev backend: create a text send, a password send and a credential send from the extension, open each link in the web app's public page, confirm decryption, the view counter, the password prompt and burn at the last view; remove a send and confirm 404 on its link
  - Inspect `storage.local` and `storage.session` after the flow: no send content, key or link present
- [ ] 4.2 Run `npm run typecheck`, `npm run lint`, `npm run build` and `npm run build:firefox`, then load `.output/chrome-mv3/` in Chrome and `.output/firefox-mv2/manifest.json` in Firefox and exercise the Send tab in both
  - `grep -rn "chrome\." src/ entrypoints/` matches only prose
