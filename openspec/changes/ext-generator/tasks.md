## 1. Randomness and data

- [ ] 1.1 Add `src/crypto/random.ts` with `randomInt(maxExclusive)` by rejection sampling over `crypto.getRandomValues`, plus `randomPick`, `shuffle` (Fisher-Yates) and `randomString(alphabet, length)`.
  - No `Math.random` under `src/`.
  - `randomInt` throws on `maxExclusive <= 0` or above 2^32.
- [ ] 1.2 Add `public/wordlist/eff-large.txt` (7776 words, one per line, no dice numbers) and `public/wordlist/LICENSE.txt` with the EFF CC BY 3.0 attribution; add `src/generator/wordlist.ts` that fetches it via `browser.runtime.getURL` once and caches the promise.
  - Loader rejects with a typed error the popup maps to "Wordlist unavailable".
- [ ] 1.3 Add `src/generator/options.ts` with the option types, Bitwarden defaults (length 14, A-Z, a-z, 0-9 on, special off, min numbers 1, min special 1, avoid ambiguous on, 3 words, `-`, word username capitalised with number) and `sanitize(options, policy)` applying spec ranges, then policy, then the sum-of-minimums rule.
  - Turning off the last enabled class is rejected by `sanitize`.

## 2. Generators

- [ ] 2.1 Implement `src/generator/password.ts` with Bitwarden's slot algorithm: per-class minimums (at least 1 for every enabled class), shuffled slots, ambiguous set `I O l 0 1`, special set `!@#$%^&*`.
- [ ] 2.2 Implement `src/generator/passphrase.ts`: uniform word draws, separator, capitalize, one digit appended to one random word.
- [ ] 2.3 Implement `src/generator/username.ts`: random word (capitalize, four-digit number), plus addressed email (random 8 lowercase alphanumerics or website host before `@`), catch-all (random or website host as local part).
  - Returns a typed "needs input" result when the email or domain is empty.
- [ ] 2.4 Add `vitest` as a dev dependency with an `npm test` script and property tests in `src/generator/*.test.ts` and `src/crypto/random.test.ts`.
  - 1000 passwords per option set: exact length, minimum counts met, no disabled class, no ambiguous character when avoided.
  - Passphrase word count, separator and single-digit rule.
  - `randomInt` distribution over 7776 buckets has no empty bucket after 1 000 000 draws and no bucket above twice the mean.

## 3. Background state

- [ ] 3.1 Extend `src/messages.ts` with `GeneratorOptions`, `GeneratorPolicy`, `GeneratorHistoryEntry`, `GeneratorContext` and the five `generator.*` request arms from design.md.
- [ ] 3.2 In `entrypoints/background.ts` add `generator.getContext` and `generator.saveOptions`: read and write the options under the active account's settings record in `storage.local`, return the cached email from the account record, and derive `websiteHost` from `browser.tabs.query({ active: true, lastFocusedWindow: true })`; add `tabs` to `wxt.config.ts` permissions if `ext-vault-browse` did not.
  - Saved options pass through `sanitize` before storage and before reply.
- [ ] 3.3 Add `src/generator/policy.ts` and a policy fetch of `GET /api/settings/policy` after unlock and after each sync, cached per account in `storage.local`, replaced only on a 2xx response and cleared on logout and account removal.
  - `policy_enabled` false maps to `null`; the other non-generator fields are ignored.
- [ ] 3.4 Add `src/generator/history.ts` over `storage.session` (background memory below Firefox 115), capped at 50 newest-first per account, with the `generator.history.*` arms, and purge it on lock, logout and account removal.
  - Never touches `storage.local`.

## 4. Popup

- [ ] 4.1 Add `entrypoints/popup/views/generator.ts` with the Password, Passphrase and Username sub-tabs, the monospace output box with colour-coded digits and specials, Regenerate and Copy (through `src/clipboard.ts`), generation on open and on every option change, and options saved on change.
  - Styles in `entrypoints/popup/popup.css`; no webfonts.
- [ ] 4.2 Build the Password controls: slider paired with number input, four class toggles, minimum numbers and minimum special inputs, avoid ambiguous toggle, and the policy clamp with disabled controls labelled "Set by your organisation".
- [ ] 4.3 Build the Passphrase controls (number of words, separator, capitalize, include number) and the Username controls (type select, word toggles, email and domain inputs, Random or Website name sub-mode disabled with "No website detected" when `websiteHost` is null), including the "Enter an email address" and "Wordlist unavailable" output states.
- [ ] 4.4 Add `entrypoints/popup/views/generator-history.ts`: newest first, colour-coded value, relative time, Copy per entry, Clear with confirmation, empty state "No generated values yet"; record history on Regenerate, Copy, "Use this password" and sub-tab blur.
- [ ] 4.5 Wire pick mode: accept `{ pick: { field } }` from the shell navigation state, show "Use this password", return `{ picked: { field, value } }` and navigate back; hook the item form's Generate buttons if `ext-vault-edit` has landed, otherwise leave the entry point documented in `design.md`.
- [ ] 4.6 Register the Generator tab in the shell and add the "Generate a password" link on the lock screen that opens the view with the tab bar hidden and pick mode unavailable.

## 5. Verification

- [ ] 5.1 Manually verify in Chrome and Firefox: defaults match Bitwarden, last class cannot be disabled, minimums raise the length, history caps at 50 and clears on lock, options survive popup close and account switch, policy clamp appears with a test policy and persists offline, generator works while locked with the network disabled.
- [ ] 5.2 Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run build:firefox`, then load `.output/chrome-mv3/` and `.output/firefox-mv2/manifest.json` in both browsers and open the Generator tab.
  - `grep -rn "chrome\." src/ entrypoints/` matches only comments.
