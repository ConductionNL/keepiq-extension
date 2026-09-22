## 1. Field model and messages

- [ ] 1.1 Create `src/vault/fields.ts` with the reserved names (`key`, `login`, `url`, plus `notes` for custom rows), the 4096 and 65536 caps, per-type field schemas, card and identity serialize and parse, TOTP seed validation and URI rewrite, and `validateDraft`.
  - Card and identity member lists match `src/cardIdentity/cardIdentity.js` of the Keepiq app verbatim; unset members serialize as `''`.
  - A bare base32 seed is kept as typed; only a changed advanced field rewrites the seed into an `otpauth://totp/` URI.
- [ ] 1.2 Add `ItemDraft`, `ItemPatch`, `DecryptedItem`, `FolderDeletePlan`, `VaultWriteError`, `WriteResult` and the eight write arms from design.md to `src/messages.ts`, and add `online` and `defaultSecretType` to the vault state.

## 2. Background write path

- [ ] 2.1 Create `src/vault/write.ts` with `createItem`: encrypt `key`, `login` and the `additionalFields` JSON with the active suite certificate through `src/crypto/`, `POST /api/v1/secrets`, then trigger sync and return the new id.
  - Empty `additionalFields` encrypts `{}`; an empty `login` is omitted; an empty `url` is `null`.
- [ ] 2.2 Add `fetchItem` (fresh `GET /api/v1/secrets/{id}`, decrypt in the background, withhold `key` for `passkey`, map `blocked` rows) and `updateItem` (encrypt only the ciphertext members present in the patch, sparse `PUT`, trigger sync).
- [ ] 2.3 Add `deleteItem` (`DELETE /api/v1/secrets/{id}`, trigger sync) and the folder functions: `createFolder`, `renameFolder`, `folderChildren`, `deleteFolder` building the query or the resolution body from `FolderDeletePlan`.
- [ ] 2.4 Map responses to `VaultWriteError` (423, 403, 400, 409, 404, no response) in one place and set the `online` flag from every request outcome.
- [ ] 2.5 Fetch `GET /api/settings/user` during sync and cache `default_secret_type` in `storage.local` with the account; clear it with the account data.
- [ ] 2.6 Register the eight arms in `entrypoints/background.ts` as request/response arms returning the Promise, following the `get_state` pattern.

## 3. Popup views

- [ ] 3.1 Create `entrypoints/popup/views/item-form.ts`: Type select from cached `secret-types` with the default type, required Name, type-specific fields from `fields.ts`, Folder field opening the picker, Additional fields rows with per-row masking and the reserved, blank and duplicate refusals, Notes, and per-field cap messages.
  - Passkey items show only Name, Folder and Website URL plus the read-only notice.
- [ ] 3.2 Prefill Website URL from `browser.tabs.query({ active: true, currentWindow: true })` when adding from a tab, add Password reveal, and wire the generate button to ext-generator's pick mode returning the value into the draft; hide the button while that mode does not exist.
- [ ] 3.3 Add the "+" button to the Vault tab list and make Edit, Clone, Move and Delete live on item detail: Edit and Clone call `item.fetch` first, Clone suffixes " - Clone" and excludes passkeys, Delete uses an in-popup confirm dialog, Move opens the picker and sends a `folderId`-only patch.
- [ ] 3.4 Create `entrypoints/popup/views/folder-picker.ts`: "No folder", the indented tree, the current folder marked, and the inline "New folder" entry that calls `folder.create` and selects the result.
- [ ] 3.5 Create `entrypoints/popup/views/folder-manager.ts` at Settings → Vault → Folders: tree, "Add folder" per level, rename, the empty and non-empty leaf delete dialogs, the subfolder resolution dialog fed by `folder.children`, and the dismissible plaintext-names notice stored in `storage.local`.
  - A 409 "resolution required" re-fetches children and opens the resolution dialog instead of failing.
- [ ] 3.6 Add dirty tracking with the "You have unsaved changes. Discard them?" guard on in-popup navigation, the offline explanation that disables the write buttons, and the error banners with Retry that keep the typed values.

## 4. Verification

- [ ] 4.1 Walk every scenario of both specs against the dev backend in Chrome and Firefox, including a round-trip of a `card`, an `identity` and a `totp` item opened afterwards in the Keepiq web app.
  - No `chrome.*` in executable code, no decrypted value written to any storage, no encryption in popup code.
- [ ] 4.2 Run `npm run typecheck`, `npm run lint`, `npm run build` and `npm run build:firefox`, then load `.output/chrome-mv3/` and `.output/firefox-mv2/` in both browsers and confirm add, edit, delete and folder delete each work once.
