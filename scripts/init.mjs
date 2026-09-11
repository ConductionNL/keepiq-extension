#!/usr/bin/env node
/**
 * One-shot template setup: fills every `__TOKEN__` placeholder in the tree,
 * strips the template-only block from README.md, then deletes itself and its
 * npm script. Run once, immediately after creating a repo from the template.
 *
 *   npm run init
 *
 * Non-interactive (CI, scripted scaffolding) — --name and --description are
 * required, the rest fall back to their derived defaults:
 *
 *   node scripts/init.mjs --yes --name="My Ext" --description="Does a thing" \
 *     [--package=@me/extension] [--gecko-id=my-ext@me] [--slug=my-ext]
 */

import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, rmdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = fileURLToPath(import.meta.url)
const SKIP_DIRS = new Set(['node_modules', '.git', '.output', '.wxt', 'dist'])

const README_BEGIN = '<!-- TEMPLATE:BEGIN -->'
const README_END = '<!-- TEMPLATE:END -->'

/**
 * Placeholders this script fills. Their names appear literally in the token map
 * below, which is exactly why `walk()` skips this file — otherwise the script
 * rewrites its own source and always looks un-initialised to the guard.
 */
const TOKEN_NAMES = [
	'__EXT_NAME__',
	'__EXT_DESCRIPTION__',
	'__EXT_SLUG__',
	'__PKG_NAME__',
	'__GECKO_ID__',
]

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const flags = {}
for (const arg of process.argv.slice(2)) {
	const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
	if (!match) fail(`unrecognised argument: ${arg}`)
	flags[match[1]] = match[2] ?? true
}
const nonInteractive = flags.yes === true || flags.y === true

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message) {
	console.error(`init: ${message}`)
	process.exit(1)
}

/** Lowercase, alphanumeric-and-dashes, no leading/trailing/doubled dashes. */
function slugify(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
}

/** A sensible author handle for the Firefox add-on id, from git if available. */
function gitHandle() {
	try {
		const name = execFileSync('git', ['config', 'user.name'], {
			cwd: ROOT,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
		return slugify(name) || 'local'
	} catch {
		return 'local'
	}
}

/** Every file under ROOT except this script, build output and VCS metadata. */
function* walk(dir) {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) continue
		const path = join(dir, entry)
		if (path === SELF) continue
		if (statSync(path).isDirectory()) yield* walk(path)
		else yield path
	}
}

/** File contents as text, or null for a binary file (icons, fonts). */
function readText(path) {
	const buffer = readFileSync(path)
	// Cheapest reliable binary check — skip those rather than corrupting them.
	return buffer.includes(0) ? null : buffer.toString('utf8')
}

// ---------------------------------------------------------------------------
// Prompting
// ---------------------------------------------------------------------------

/** Drain stdin. Only called when it isn't a terminal, so it always terminates. */
async function readAllStdin() {
	const chunks = []
	for await (const chunk of process.stdin) chunks.push(chunk)
	return Buffer.concat(chunks).toString('utf8')
}

async function collect() {
	// Only prompt at a real terminal. `readline` drains a *piped* stream on the
	// first question and discards the rest, so answers fed in from a script are
	// read here as plain lines instead — one per prompt, blank to take the default.
	const interactive = !nonInteractive && process.stdin.isTTY === true
	const piped = interactive || nonInteractive ? [] : (await readAllStdin()).split('\n')
	const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null

	// At a terminal, Ctrl-D closes stdin and `rl.question()` then never settles.
	// Race every prompt against `close` so that quits instead of hanging.
	let closed = false
	const onClosed = rl
		? new Promise((resolve) => rl.once('close', () => {
				closed = true
				resolve(null)
			}))
		: null

	/** Take the default, or fail if the value has neither default nor answer. */
	function orFail(flag, fallback) {
		if (fallback === undefined) {
			fail(`--${flag} is required when there is nothing to prompt (no terminal, or --yes)`)
		}
		return fallback
	}

	/** Prompt with a default; a flag of the same name skips the prompt entirely. */
	async function ask(flag, question, fallback) {
		if (typeof flags[flag] === 'string' && flags[flag].length > 0) return flags[flag]
		if (!interactive || closed) {
			const line = piped.shift()?.trim()
			return line ? line : orFail(flag, fallback)
		}
		const suffix = fallback === undefined ? '' : ` [${fallback}]`
		for (;;) {
			const answer = await Promise.race([rl.question(`${question}${suffix}: `), onClosed])
			if (answer === null) return orFail(flag, fallback)
			const trimmed = answer.trim()
			if (trimmed.length > 0) return trimmed
			if (fallback !== undefined) return fallback
		}
	}

	try {
		const name = await ask('name', 'Extension display name')
		const description = await ask('description', 'One-line description')
		// Reachable when the display name has no alphanumerics to slugify.
		const slug = slugify(await ask('slug', 'Short slug (log prefixes, CI artifacts)', slugify(name)))
		if (!slug) fail('slug is empty — pass --slug explicitly')

		const pkg = await ask('package', 'npm package name', `@${slug}/extension`)
		const geckoId = await ask('gecko-id', 'Firefox add-on id', `${slug}@${gitHandle()}`)
		return { name, description, slug, pkg, geckoId }
	} finally {
		rl?.close()
	}
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

function applyTokens(answers) {
	const tokens = {
		__EXT_NAME__: answers.name,
		__EXT_DESCRIPTION__: answers.description,
		__EXT_SLUG__: answers.slug,
		__PKG_NAME__: answers.pkg,
		__GECKO_ID__: answers.geckoId,
	}
	const pattern = new RegExp(TOKEN_NAMES.join('|'), 'g')
	const touched = []

	for (const path of walk(ROOT)) {
		const before = readText(path)
		if (before === null) continue
		const after = before.replace(pattern, (token) => tokens[token])
		if (after === before) continue
		writeFileSync(path, after)
		touched.push(path)
	}
	return touched
}

/** Drop the "you just cloned a template" section, keeping the project README. */
function stripReadmeBlock() {
	const path = join(ROOT, 'README.md')
	const before = readFileSync(path, 'utf8')
	const start = before.indexOf(README_BEGIN)
	const end = before.indexOf(README_END)
	if (start === -1 || end === -1) return false
	const after = before.slice(0, start) + before.slice(end + README_END.length).replace(/^\n+/, '')
	writeFileSync(path, after)
	return true
}

/** Remove the `init` script so the finished project has no dead entry. */
function dropInitScript() {
	const path = join(ROOT, 'package.json')
	const manifest = JSON.parse(readFileSync(path, 'utf8'))
	if (!manifest.scripts?.init) return false
	delete manifest.scripts.init
	// Tabs + trailing newline to match the file it replaces.
	writeFileSync(path, `${JSON.stringify(manifest, null, '\t')}\n`)
	return true
}

/** Delete this script, and scripts/ with it if nothing else lives there. */
function removeSelf() {
	rmSync(SELF, { force: true })
	try {
		rmdirSync(join(ROOT, 'scripts'))
	} catch {
		// Directory not empty — the project added its own scripts. Leave it.
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const hasPlaceholders = [...walk(ROOT)].some((path) => {
	const text = readText(path)
	return text !== null && TOKEN_NAMES.some((token) => text.includes(token))
})

if (!hasPlaceholders) {
	console.log('init: no placeholders left — this project is already initialised.')
	process.exit(0)
}

const answers = await collect()
const touched = applyTokens(answers)
stripReadmeBlock()
dropInitScript()

console.log(`\nRewrote ${touched.length} file${touched.length === 1 ? '' : 's'}:`)
console.log(`  name         ${answers.name}`)
console.log(`  description  ${answers.description}`)
console.log(`  slug         ${answers.slug}`)
console.log(`  package      ${answers.pkg}`)
console.log(`  gecko id     ${answers.geckoId}`)
console.log('\nNext:')
console.log('  1. Replace the placeholder icons in public/icon/ (see README).')
console.log("  2. Narrow `matches` in entrypoints/content.ts to the origins you need.")
console.log('  3. npm install && npm run dev')

removeSelf()
