import assert from 'node:assert/strict'
import './sync-storage.js'

const {MAX_PATH_LENGTH, getLatest, saveLatest} = globalThis.TextareaSyncStorage

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
assert.equal((await getLatest(storage)).path, longPath)
assert.equal(storage.values.latestDocument.chunks, 3)

await assert.rejects(
  saveLatest(storage, {path: '/#' + 'x'.repeat(MAX_PATH_LENGTH), title: 'Too large'}),
  /too large/
)

console.log('Firefox sync-storage tests passed')
