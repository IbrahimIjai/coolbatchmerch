/**
 * Exports every piece in design/artwork.html as a transparent PNG in public/merch.
 *
 *   bun run render:artwork            # all pieces
 *   bun run render:artwork sixty-six  # one piece
 *
 * Needs a local Chrome/Chromium. Set CHROME_PATH if it is not on PATH as `google-chrome`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'design/artwork.html')
const outDir = resolve(root, 'public/merch')
const chrome = process.env.CHROME_PATH || 'google-chrome'

const html = readFileSync(source, 'utf8')
const pieces = [...html.matchAll(/<section id="([^"]+)" data-w="(\d+)" data-h="(\d+)"/g)]
  .map(([, id, w, h]) => ({ id: id!, w: Number(w), h: Number(h) }))

const only = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })

for (const piece of pieces) {
  if (only.length && !only.includes(piece.id)) continue
  const out = resolve(outDir, `${piece.id}.png`)
  const url = `${pathToFileURL(source).href}#${piece.id}`
  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${piece.w},${piece.h}`,
    '--virtual-time-budget=10000',
    `--screenshot=${out}`,
    url
  ], { stdio: 'pipe' })
  if (result.status !== 0) {
    console.error(`✗ ${piece.id}\n${result.stderr.toString()}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${piece.id} → public/merch/${piece.id}.png`)
  }
}
