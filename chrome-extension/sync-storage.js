const META_KEY = 'latestDocument'
const CHUNK_PREFIX = 'latestDocumentChunk'

// storage.sync allows 8 KiB per item and roughly 100 KiB in total.
const CHUNK_SIZE = 7000
export const MAX_PATH_LENGTH = 95000

function chunkKey(index) {
  return `${CHUNK_PREFIX}${index}`
}

function checksum(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function validatePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('Textarea URL path is invalid.')
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new Error('This document is too large for Chrome Sync.')
  }

  const url = new URL(path, 'https://textarea.my')
  if (url.origin !== 'https://textarea.my') {
    throw new Error('Only textarea.my URLs can be synced.')
  }
}

export async function saveLatest(storage, document) {
  validatePath(document.path)

  const digest = checksum(document.path)
  const existing = (await storage.get(META_KEY))[META_KEY]
  if (existing?.checksum === digest && existing?.length === document.path.length) {
    return {changed: false}
  }

  const chunks = []
  for (let offset = 0; offset < document.path.length; offset += CHUNK_SIZE) {
    chunks.push(document.path.slice(offset, offset + CHUNK_SIZE))
  }

  const values = Object.fromEntries(chunks.map((chunk, index) => [chunkKey(index), chunk]))
  await storage.set(values)
  await storage.set({
    [META_KEY]: {
      version: 1,
      chunks: chunks.length,
      length: document.path.length,
      checksum: digest,
      title: String(document.title || 'Textarea').slice(0, 200),
      savedAt: Date.now(),
    },
  })

  const previousChunks = Number(existing?.chunks) || 0
  if (previousChunks > chunks.length) {
    const staleKeys = []
    for (let i = chunks.length; i < previousChunks; i++) staleKeys.push(chunkKey(i))
    await storage.remove(staleKeys)
  }

  return {changed: true}
}

export async function getLatest(storage) {
  const meta = (await storage.get(META_KEY))[META_KEY]
  if (!meta || !Number.isInteger(meta.chunks) || meta.chunks < 1) return null

  const keys = Array.from({length: meta.chunks}, (_, index) => chunkKey(index))
  const values = await storage.get(keys)
  const chunks = keys.map(key => values[key])
  if (chunks.some(chunk => typeof chunk !== 'string')) return null

  const path = chunks.join('')
  if (path.length !== meta.length || checksum(path) !== meta.checksum) return null
  validatePath(path)

  return {path, title: meta.title || 'Textarea', savedAt: meta.savedAt}
}
