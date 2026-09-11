<!-- TEMPLATE:BEGIN -->
# WXT extension template

A starting point for a browser extension built with [WXT](https://wxt.dev) that
ships to **Chrome (MV3) and Firefox (MV2) from one source**.

## Use it

Click **Use this template** → **Create a new repository**, then:

```sh
npm install
npm run init      # fills in the placeholders, then deletes itself
npm run dev
```

`npm run init` prompts for five values, rewrites every `__TOKEN__` in the tree,
strips this section from the README, and removes itself and its npm script. It is
a one-shot — running it twice is a no-op.

| Prompt | Goes into | Default |
|--------|-----------|---------|
| Display name | manifest `name`, popup title, `CLAUDE.md` | — |
| Description | manifest `description`, `package.json` | — |
| Short slug | log prefixes, CI artifact name | slugified display name |
| npm package name | `package.json` `name` | `@<slug>/extension` |
| Firefox add-on id | `browser_specific_settings.gecko.id` | `<slug>@<git user.name>` |

Non-interactive, for scripted scaffolding:

```sh
node scripts/init.mjs --yes --name="My Ext" --description="Does a thing"
```

GitHub has no built-in substitution wizard for template repositories, and no event
fires when a repo is created from one — so this is a script you run, not a form
you fill in. Don't try to make it a workflow that self-triggers; workflows do not
run on the template-creation commit.

## What you get

```
entrypoints/
  background.ts     MV3 worker / MV2 background page — owns state, badge, messaging
  content.ts        content script with the context-invalidation latch
  popup/            vanilla-TS popup: index.html + main.ts + popup.css
src/
  messages.ts       every cross-boundary envelope, in one tagged union
  browser-action.ts the `browser.action ?? browser.browserAction` MV shim
.github/workflows/
  ci.yml            typecheck + lint + build BOTH targets, on push and PR
  release.yml       zip both targets, attach to a published GitHub Release
```

The scaffold is a working extension, not a stub: the popup toggles a flag stored
in `storage.local`, the background mirrors it onto the toolbar badge and pushes it
to live content scripts, and the content script announces itself back. Every piece
exists to demonstrate one rule from
[WXT-AND-BROWSERS.md](WXT-AND-BROWSERS.md) — delete what you don't need.

Also here: `.npmrc` with a 7-day supply-chain cooldown on new dependency versions,
`web-ext.config.example.ts` for non-standard browser installs, and a `CLAUDE.md`
skeleton.

**Not** included, by design: a licence (pick your own), a test runner, and real
icons — `public/icon/*.png` is placeholder art.

## First edits after `init`

1. **Replace the icons.** `assets/icon.svg` is the placeholder source; regenerate
   the PNGs with
   `for s in 16 32 48 96 128; do rsvg-convert -w $s -h $s assets/icon.svg -o public/icon/$s.png; done`
   (WXT picks up `public/icon/<size>.png` automatically — there is no `icons` key
   in `wxt.config.ts`).
2. **Narrow `matches`** in `entrypoints/content.ts`. It ships as `*://*/*` so the
   scaffold visibly runs; a content script on every page is a permission prompt
   users read and a review flag on both stores.
3. **Add a licence** if the repo is public.
4. **Fill in `CLAUDE.md`** — the *What is* and *Core constraints* sections are
   deliberately left as prompts.

## Adding a UI framework

The template is vanilla TS on purpose — it's the smaller starting point, and WXT
makes either framework a two-minute addition.

**React:**

```sh
npm i react react-dom
npm i -D @wxt-dev/module-react @types/react @types/react-dom
```

- add `modules: ['@wxt-dev/module-react']` to `wxt.config.ts`
- add `"compilerOptions": { "jsx": "react-jsx" }` to `tsconfig.json` — the
  WXT-generated `.wxt/tsconfig.json` does **not** set it, so `tsc` fails on JSX
  without this override
- rename `entrypoints/popup/main.ts` → `main.tsx`, add `<div id="root">` to
  `index.html`, and mount with `createRoot`
- for UI injected into a page, use WXT's `createShadowRootUi` from a content
  script with `cssInjectionMode: 'ui'`

**Vue:**

```sh
npm i vue
npm i -D @wxt-dev/module-vue
```

- add `modules: ['@wxt-dev/module-vue']` to `wxt.config.ts`
- switch `compile` to `vue-tsc --noEmit` (install `vue-tsc`) — plain `tsc` cannot
  typecheck `.vue` single-file components

Svelte and Solid work the same way via `@wxt-dev/module-svelte` /
`@wxt-dev/module-solid`.

If you'd rather not re-do this each time, keep framework variants on branches of
this template (`react`, `vue`) — GitHub's *Use this template* dialog has an
**Include all branches** checkbox, so a generated repo can carry them all.

<!-- TEMPLATE:END -->
# __EXT_NAME__

__EXT_DESCRIPTION__

A browser extension built with [WXT](https://wxt.dev), shipping to **Chrome (MV3)
and Firefox (MV2)** from one source.

## Development

```sh
npm install            # postinstall runs `wxt prepare`
npm run dev            # Chromium dev + HMR, auto-launches a browser
npm run dev:firefox    # Firefox dev (MV2) + HMR
```

Non-standard browser install? Copy `web-ext.config.example.ts` to
`web-ext.config.ts` (gitignored) and point it at your binary.

## Checks & builds

```sh
npm run compile        # tsc --noEmit — typecheck only, does NOT build
npm run lint           # eslint .  (lint:fix to autofix)
npm run build          # Chrome production → .output/chrome-mv3/
npm run build:firefox  # Firefox production → .output/firefox-mv2/
npm run zip            # store-submission zip (zip:firefox for MV2)
```

Build **both** targets before calling a browser-facing change done — manifest
version and runtime API differences surface at build or runtime, not at typecheck.

## Loading a build

- **Chrome** — `chrome://extensions` → *Developer mode* → *Load unpacked* →
  `.output/chrome-mv3/`
- **Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…*
  → `.output/firefox-mv2/manifest.json`

## Layout

```
entrypoints/     one file (or directory) per extension entrypoint
  background.ts  MV3 service worker / MV2 background page
  content.ts     injected into matching pages
  popup/         toolbar popup
src/             shared modules, imported as `@/src/…`
public/          copied verbatim into the build (icons live here)
```

## Releasing

Bump `version` in `package.json` — WXT derives the manifest version from it — then
publish a GitHub Release. The `Release` workflow builds and attaches both zips.

## Reading

[WXT-AND-BROWSERS.md](WXT-AND-BROWSERS.md) — the cross-browser rules: `browser.*`
vs `chrome.*`, the MV3/MV2 split, message-passing gotchas. Read it before touching
`entrypoints/`.
