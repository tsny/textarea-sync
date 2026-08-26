import assert from 'node:assert/strict'
import './document-storage.js'
import './pastebin.js'

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

let messageListener
const createdTabs = []
const localStorage = new MemoryStorage()
// Exercise the Chrome fallback; Firefox takes the same path through
// globalThis.browser.
globalThis.chrome = {
  action: {
    setBadgeBackgroundColor() {},
    setBadgeText() {},
  },
  runtime: {
    getURL(path) { return `moz-extension://test/${path}` },
    onInstalled: {addListener() {}},
    onMessage: {addListener(listener) { messageListener = listener }},
  },
  storage: {
    local: localStorage,
  },
  tabs: {
    async create(options) { createdTabs.push(options) },
    onUpdated: {addListener() {}},
  },
}
let loginCount = 0
globalThis.fetch = async (_url, options) => {
  const values = Object.fromEntries(new URLSearchParams(options.body))
  if (values.api_user_name) {
    assert.equal(values.api_user_name, 'pastebin-user')
    assert.equal(values.api_user_password, 'pastebin-password')
    loginCount++
    return {
      ok: true,
      status: 200,
      text: async () => loginCount === 1 ? 'generated-user-key' : 'refreshed-user-key',
    }
  }
  assert.equal(values.api_option, 'list')
  if (values.api_user_key === 'generated-user-key') {
    return {ok: false, status: 422, text: async () => 'expired api_user_key'}
  }
  assert.equal(values.api_user_key, 'refreshed-user-key')
  return {ok: true, status: 200, text: async () => 'No pastes found.'}
}

await import('./background.js')
assert.equal(typeof messageListener, 'function')

function sendMessage(message, sender = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Message response timed out')), 1000)
    const keepChannelOpen = messageListener(message, sender, response => {
      clearTimeout(timeout)
      resolve({keepChannelOpen, response})
    })
    assert.equal(keepChannelOpen, true)
  })
}

const invalidResponse = await sendMessage(
  {type: 'save-current', url: 'https://example.com/#invalid'},
  {url: 'https://example.com/#invalid'}
)
assert.deepEqual(invalidResponse.response, {ok: false, error: 'Invalid textarea.my URL.'})

const saveResponse = await sendMessage(
  {type: 'save-current', url: 'https://textarea.my/#shared', title: 'Shared note'},
  {url: 'https://textarea.my/#shared'}
)
assert.deepEqual(saveResponse.response, {ok: true})
assert.equal((await globalThis.TextareaDocumentStorage.getLatest(localStorage)).path, '/#shared')

const disconnected = await sendMessage({type: 'get-pastebin-connection'})
assert.deepEqual(disconnected.response, {ok: true, connected: false})

const setupResponse = await sendMessage(
  {type: 'open-pastebin-setup'},
  {url: 'https://textarea.my/#shared'}
)
assert.deepEqual(setupResponse.response, {ok: true})
assert.deepEqual(createdTabs, [{url: 'moz-extension://test/popup.html'}])

const connectResponse = await sendMessage({
  type: 'connect-pastebin',
  developerKey: 'developer-key',
  username: 'pastebin-user',
  password: 'pastebin-password',
})
assert.deepEqual(connectResponse.response, {ok: true, username: 'pastebin-user'})
assert.deepEqual(localStorage.values.pastebinCredentials, {
  developerKey: 'developer-key',
  userKey: 'generated-user-key',
  username: 'pastebin-user',
  password: 'pastebin-password',
})
const connected = await sendMessage({type: 'get-pastebin-connection'})
assert.deepEqual(connected.response, {ok: true, connected: true})

const refreshedState = await sendMessage({type: 'get-pastebin-state'})
assert.equal(refreshedState.response.ok, true)
assert.equal(refreshedState.response.error, undefined)
assert.equal(loginCount, 2)
assert.equal(localStorage.values.pastebinCredentials.userKey, 'refreshed-user-key')
assert.equal(localStorage.values.pastebinCredentials.password, 'pastebin-password')

assert.equal(messageListener({type: 'unknown'}, {}, () => {}), false)

console.log('Shared background adapter tests passed')
