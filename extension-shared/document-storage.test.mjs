import assert from 'node:assert/strict'
import './document-storage.js'

const {MAX_PATH_LENGTH, getLatest, saveLatest} = globalThis.TextareaDocumentStorage

class MemoryStorage {
  values = {}

  async get(keys) {
    const requested = Array.isArray(keys) ? keys : [keys]
    return Object.fromEntries(
      requested.filter(key => key in this.values).map(key => [key, this.values[key]])
    )
  }

  async set(values) {
    Object.assign(this.values, values)
  }

  async remove(keys) {
    for (const key of keys) delete this.values[key]
  }
}

const storage = new MemoryStorage()
const longPath = '/#' + 'a'.repeat(20000)

assert.deepEqual(
  await saveLatest(storage, {path: longPath, title: 'Long note'}),
  {changed: true}
)
assert.deepEqual(await getLatest(storage), {
  path: longPath,
  title: 'Long note',
  savedAt: storage.values.latestDocument.savedAt,
})
assert.deepEqual(
  await saveLatest(storage, {path: longPath, title: 'Long note'}),
  {changed: false}
)

const shortPath = '/#abc'
await saveLatest(storage, {path: shortPath, title: 'Short note'})
assert.equal((await getLatest(storage)).path, shortPath)

await assert.rejects(
  saveLatest(storage, {path: '/#' + 'x'.repeat(MAX_PATH_LENGTH), title: 'Too large'}),
  /too large/
)

console.log('Shared document-storage tests passed')
