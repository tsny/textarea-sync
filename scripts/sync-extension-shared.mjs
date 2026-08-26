import {readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sharedDirectory = path.join(root, 'extension-shared')
const targetDirectories = ['chrome-extension', 'firefox-extension']
const sharedFiles = [
  'background.js',
  'content.js',
  'document-storage.js',
  'pastebin.js',
  'popup.css',
  'popup-form.js',
  'popup.html',
  'popup.js',
]
const obsoleteFiles = ['sync-storage.js']
const mode = process.argv[2] || '--check'

if (!['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/sync-extension-shared.mjs [--check|--write]')
}

const stale = []
for (const file of sharedFiles) {
  const source = await readFile(path.join(sharedDirectory, file))
  for (const directory of targetDirectories) {
    const destination = path.join(root, directory, file)
    if (mode === '--write') {
      await writeFile(destination, source)
      continue
    }

    let current
    try {
      current = await readFile(destination)
    } catch {
      stale.push(path.relative(root, destination))
      continue
    }
    if (!source.equals(current)) stale.push(path.relative(root, destination))
  }
}

for (const file of obsoleteFiles) {
  for (const directory of targetDirectories) {
    const destination = path.join(root, directory, file)
    if (mode === '--write') {
      await rm(destination, {force: true})
      continue
    }
    try {
      await readFile(destination)
      stale.push(path.relative(root, destination))
    } catch {
      // Missing obsolete files are current.
    }
  }
}

if (stale.length) {
  throw new Error(
    `Generated extension files are stale:\n${stale.map(file => `- ${file}`).join('\n')}\n` +
    'Run: node scripts/sync-extension-shared.mjs --write'
  )
}

console.log(mode === '--write' ? 'Shared extension files updated' : 'Shared extension files are current')
