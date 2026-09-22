## Context

Keepiq's ephemeral send API is the server side of a Bitwarden-Send-like feature (ADR-003 "Ephemeral send payload"). The web app already implements the client side; the extension must produce byte-compatible ciphertext so the web app's public recipient page can decrypt it. Facts verified in the Keepiq app source (branch `development`):

- Create payload fields: `encryptedPayload`, `payloadType`, `maxViews`, `ttlSeconds`, `hasPassword`, `wrappedKey`, `argon2idSalt` (`lib/Service/EphemeralSendService.php:91` and `:99-131`). Response is 201 with the row (`lib/Controller/EphemeralSendController.php:84`).
- Expiry parameter is `ttlSeconds` in seconds, 0 or absent means no expiry, cap `TTL_CAP_SECONDS = 2592000` (30 days) (`EphemeralSendService.php:59`, `:182-193`).
- `maxViews` defaults to 1, cap `MAX_VIEWS_CAP = 100`, unlimited refused (`EphemeralSendService.php:52`, `:161-170`). The cap is not exposed by any endpoint, so the extension mirrors the constant.
- `payloadType` is `text` or `credential` (`EphemeralSendService.php:142-149`).
- Row shape: `id`, `token`, `payloadType`, `hasPassword`, `maxViews`, `viewCount`, `remainingViews`, `expiresAt`, `createdAt` (`lib/Db/EphemeralSend.php:199-211`). Token is 32 random bytes hex (`EphemeralSendService.php:73`, `:120`).
- Client crypto (`src/store/modules/ephemeralSend.js`): fresh AES-256-GCM key (`:132-136`), blob is base64 of `[12-byte IV][ciphertext || tag]` (`:80-89`), `wrappedKey` is the same blob layout encrypting the raw 32-byte content key under the Argon2id key (`:155`), `argon2idSalt` is base64 of 16 random bytes (`:153`, `:156`). Argon2id parameters 64 MiB, 3 iterations, parallelism 1, 32-byte output (`src/crypto/argon2.js:19-34`), which ADR-003 also records.
- Share link: `<origin><app base>/public/send/<token>`, plus `#k=<base64url(raw key)>` without padding when there is no password (`ephemeralSend.js:170-179`, `:58-60`). The `/public/send/:token` route is the web app's `EphemeralSendAccess` page (`src/manifest.json:554-559`, `appinfo/routes.php:168-190`).
- The web app's credential type is free text: one textarea regardless of type (`src/modals/NewSendDialog.vue:24-35`) and the recipient renders the decrypted string in a `<pre>` (`src/views/EphemeralSendAccess.vue`). There is no structured credential format to mirror.

## Goals / Non-Goals

**Goals:**
- Send tab with list, create, copy link once, remove, and Send from item, following Bitwarden's Send tab layout.
- Ciphertext, wrapped key and link format identical to the web app so the recipient page just works.
- No send secret ever touches extension storage.

**Non-Goals:**
- Rendering or decrypting a received send (the web app's public page does that).
- File sends, editing a send, removing a password, disabling a send (no API).
- Syncing sends into the vault cache.

## Decisions

- **Argon2id via `hash-wasm`, not `argon2-browser`.** `hash-wasm` 4.x ships an `argon2` entry with the WASM inlined as base64 (`dist/argon2.umd.min.js`, about 29 KB) and TypeScript types, so the background needs no separate `.wasm` asset URL and no loader shim like the web app's `loadArgon2WasmBinary`. Output is standard Argon2id, so the recipient page decrypts it. Alternative: `argon2-browser` 1.18 (46 KB glue plus 26 KB `.wasm`, needs a binary loader in a worker).
- **Argon2id and AES-GCM run in the background.** The popup posts plaintext and the send password over `runtime.sendMessage`; the background generates the content key, encrypts, derives, posts, and returns the row plus link. Only the background holds the API client and app password. Alternative: encrypt in the popup; rejected because the popup would then need the API client too.
- **`wasm-unsafe-eval` in the CSP.** MV3 blocks WASM compilation without it. `wxt.config.ts` sets `content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" }` when `manifestVersion === 3` and the string `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` for MV2. Firefox recognises the keyword since 102 and the minimum is 109. Alternative: run Argon2 in an offscreen document; rejected, Firefox MV2 has none.
- **Link and list live in popup memory.** The popup is stateless by convention, but the required lifetime of both is exactly the popup document's lifetime, so a module-level `Map<sendId, link>` and a list array in the popup script need no clearing logic. The background drops the content key and link the moment `send.create` returns. Alternative: hold them in background memory and clear on popup disconnect; more code for a state that must not outlive the popup anyway.
- **Credential body is two plain lines.** `Username: <u>` newline `Password: <p>`, because the recipient page shows plain text and the web app has no structured format. JSON would render raw braces to the recipient.
- **Expiry presets are Bitwarden's, mapped to `ttlSeconds`.** 1 h, 1 d, 2 d, 3 d, 7 d (default), 30 d, Custom in hours (1 to 720). Keepiq's "no time limit" (0) is not offered, matching Bitwarden's mandatory deletion date. Alternative: mirror the web app's 24 h default and 0 option; rejected under ADR-001.
- **Max views cap is a mirrored constant.** `MAX_VIEWS_CAP = 100` in `src/send/expiry.ts` with a comment naming the server constant; a server 400 message is shown verbatim when the two disagree. Alternative: probe the server; there is no endpoint for it.
- **List is fetched per popup session, not synced.** `GET /api/v1/sends` on first Send tab visit, re-fetched after create and remove. Alternative: include in the vault sync; the manifest has no sends and remaining views would go stale.
- **Copy link uses the shared clipboard helper.** Same helper as copy username/password in ext-vault-browse, so the clipboard auto-clear setting (ADR-002) applies to links carrying a `#k=` fragment.
- **Send from item is a popup route change with data.** The item More menu (ext-vault-browse) calls `send.prefillFromItem` and navigates the popup to the New send form; the background decrypts `login` and `key` and returns them. The values never leave popup memory.

## Module layout

Added:
- `src/send/argon2.ts`: `deriveSendKey(password, salt)` wrapping `hash-wasm` `argon2id` with the fixed parameters, plus `isArgon2Available()`; lazy `import()` so the WASM is compiled on first password send only.
- `src/send/crypto.ts`: content key generation, `aesGcmBlob` (IV-prefixed base64), `wrapContentKey`, base64 and base64url helpers.
- `src/send/payload.ts`: `serializeCredential(username, password)` and the type-to-label derivation.
- `src/send/expiry.ts`: presets to `ttlSeconds`, custom-hours validation, `MAX_VIEWS_CAP`, `TTL_CAP_SECONDS`.
- `src/send/api.ts`: `listSends`, `createSend`, `deleteSend` over the API client, mapping `{message}` errors to `SendError`.
- `src/send/link.ts`: `buildShareLink(baseUrl, token, rawKey | null)`.
- `src/send/handlers.ts`: background handlers for the four messages, registered from `entrypoints/background.ts`.
- `entrypoints/popup/send/list.ts`, `entrypoints/popup/send/new.ts`, `entrypoints/popup/send/created.ts`: the three Send tab views, plus `entrypoints/popup/send/state.ts` for the session `Map` and list.

Edited:
- `src/messages.ts`: send message and result types.
- `entrypoints/background.ts`: dispatch `send.*` kinds to `src/send/handlers.ts`.
- `entrypoints/popup/index.html`, `entrypoints/popup/main.ts`, `entrypoints/popup/popup.css`: Send tab mount point and styles.
- The item More menu module from ext-vault-browse: add the Send entry.
- `wxt.config.ts`: CSP per manifest version.
- `package.json`: `hash-wasm` dependency.

## Message contract

```ts
export type SendPayloadType = 'text' | 'credential'

export interface SendRow {
	id: string
	payloadType: SendPayloadType
	hasPassword: boolean
	maxViews: number
	remainingViews: number
	expiresAt: string | null
	createdAt: string
}

export interface SendCreateInput {
	payloadType: SendPayloadType
	/** Text body, or the two-line credential body from src/send/payload.ts. */
	body: string
	maxViews: number
	ttlSeconds: number
	/** Empty string means no password. */
	sendPassword: string
}

export type SendError =
	| { code: 'locked' }
	| { code: 'offline' }
	| { code: 'unauthorized' }
	| { code: 'not_found' }
	| { code: 'argon2_unavailable' }
	| { code: 'invalid' | 'server'; message: string }

export type SendResult<T> = { ok: true; value: T } | { ok: false; error: SendError }

// Additions to PopupToBackground (request/response)
| { kind: 'send.list' }                                   // SendResult<SendRow[]>
| { kind: 'send.create'; input: SendCreateInput }         // SendResult<{ row: SendRow; link: string }>
| { kind: 'send.delete'; id: string }                     // SendResult<null>
| { kind: 'send.prefillFromItem'; itemId: string }        // SendResult<{ username: string; password: string }>
```

The background never keeps `input`, the content key or `link` after replying.

## Risks / Trade-offs

- [Argon2id at 64 MiB in an MV3 service worker takes about one second and a large allocation] → Show the "Protecting with password..." state; the worker stays alive while the popup awaits the reply. Memory is released when the derivation returns.
- [`wasm-unsafe-eval` widens the extension CSP] → It only permits WebAssembly compilation, not `eval`; no other CSP source is added and the WASM is a pinned npm dependency.
- [A link with a `#k=` fragment is the only copy of the key] → The result screen says so, Copy is one click, and the row keeps Copy link while the popup is open.
- [Server cap constants drift from the mirrored ones] → The server's 400 message is shown verbatim, and ADR-003 is the place to update the values.
- [The recipient sees a credential as two text lines, not fields] → Matches what the web app produces today; a structured format is a web app change first.
- [Copying a link auto-clears the clipboard when the user enabled that setting] → Same behaviour as Bitwarden; the result screen still shows the link until Done.

## Open Questions

- Offer Keepiq's "no time limit" expiry as an extra preset, deviating from Bitwarden, or keep the 30-day maximum.
- Whether the web app should adopt a structured credential body so the recipient page can show fields and a copy button per field; the extension would then switch `serializeCredential`.
- Keep created links in background memory across popup closes until lock, so a user who closed the popup too early can still copy.
