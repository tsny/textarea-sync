import assert from 'node:assert/strict'
import './document-storage.js'
import './gist.js'

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
  storage: {local: localStorage},
  tabs: {
    async create(options) { createdTabs.push(options) },
    onUpdated: {addListener() {}},
  },
}

let remoteDocuments = []
function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  }
}

globalThis.fetch = async (url, options) => {
  assert.equal(options.headers.Authorization, 'Bearer github-token')
  if (url.endsWith('/user')) return jsonResponse({login: 'octocat'})
  if (url.includes('/gists?')) return jsonResponse([])
  if (url.endsWith('/gists') && options.method === 'POST') {
    const body = JSON.parse(options.body)
    remoteDocuments = JSON.parse(body.files['textarea-sync.json'].content).documents
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {'textarea-sync.json': {}},
    }, 201)
  }
  if (url.endsWith('/gists/gist-1') && options.method === 'GET') {
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {
        'textarea-sync.json': {
          content: JSON.stringify({version: 2, documents: remoteDocuments}),
        },
      },
    })
  }
  if (url.endsWith('/gists/gist-1') && options.method === 'PATCH') {
    const body = JSON.parse(options.body)
    remoteDocuments = JSON.parse(body.files['textarea-sync.json'].content).documents
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {'textarea-sync.json': {}},
    })
  }
  assert.fail(`Unexpected GitHub request: ${options.method} ${url}`)
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

const disconnected = await sendMessage({type: 'get-github-connection'})
assert.deepEqual(disconnected.response, {ok: true, connected: false})

const setupResponse = await sendMessage(
  {type: 'open-sync-setup'},
  {url: 'https://textarea.my/#shared'}
)
assert.deepEqual(setupResponse.response, {ok: true})
assert.deepEqual(createdTabs, [{url: 'moz-extension://test/popup.html'}])

await localStorage.set({
  pastebinDeviceId: '0464E599',
  pastebinDocumentName: 'Work notes',
  pastebinDocuments: [{
    name: 'Work notes',
    url: 'https://textarea.my/#legacy',
    title: 'Textarea',
    updatedAt: 50,
  }],
})
const connectResponse = await sendMessage({type: 'connect-github', token: ' github-token '})
assert.deepEqual(connectResponse.response, {
  ok: true,
  username: 'octocat',
  gistUrl: 'https://gist.github.com/octocat/gist-1',
})
assert.deepEqual(localStorage.values.githubCredentials, {
  token: 'github-token',
  username: 'octocat',
  gistId: 'gist-1',
})
assert.equal(localStorage.values.syncDeviceId, '0464E599')
assert.equal(localStorage.values.pastebinCredentials, undefined)
assert.equal(localStorage.values.pastebinDocuments, undefined)

const connected = await sendMessage({type: 'get-github-connection'})
assert.deepEqual(connected.response, {ok: true, connected: true})
const gistState = await sendMessage({type: 'get-gist-state'})
assert.equal(gistState.response.ok, true)
assert.equal(gistState.response.documentName, 'Work notes')
assert.equal(gistState.response.documents[0].name, 'Work notes')

await localStorage.set({
  gistDocuments: [{
    name: 'Cached only',
    url: 'https://textarea.my/#cached',
    title: 'Textarea',
    updatedAt: 60,
  }],
})
const cachedGistState = await sendMessage({type: 'get-gist-state', cached: true})
assert.equal(cachedGistState.response.ok, true)
assert.equal(cachedGistState.response.documents[0].name, 'Cached only')

await localStorage.set({
  gistDocuments: [
    {
      name: 'Shared note',
      url: 'https://textarea.my/#shared',
      title: 'Textarea',
      updatedAt: 100,
    },
    {
      name: 'Work notes',
      url: 'https://textarea.my/#shared',
      title: 'Textarea',
      updatedAt: 100,
    },
  ],
})
const documentTitle = await sendMessage(
  {type: 'get-gist-document-title', url: 'https://textarea.my/#shared'},
  {url: 'https://textarea.my/#shared'}
)
assert.deepEqual(documentTitle.response, {ok: true, name: 'Work notes'})

await localStorage.set({
  gistDocuments: Array.from({length: 6}, (_, index) => ({
    name: `Recent ${index + 1}`,
    url: `https://textarea.my/#recent-${index + 1}`,
    title: 'Textarea',
    updatedAt: index + 1,
  })),
})
const recentDocuments = await sendMessage(
  {type: 'get-recent-gist-documents'},
  {url: 'https://textarea.my/#new'}
)
assert.deepEqual(
  recentDocuments.response.documents.map(document => document.name),
  ['Recent 6', 'Recent 5', 'Recent 4', 'Recent 3', 'Recent 2']
)

const selectDocument = await sendMessage({
  type: 'select-gist-document',
  documentName: ' Personal notes ',
})
assert.deepEqual(selectDocument.response, {ok: true, documentName: 'Personal notes'})
assert.equal(localStorage.values.gistDocumentName, 'Personal notes')

const startNewDocument = await sendMessage({type: 'start-new-gist-document'})
assert.deepEqual(startNewDocument.response, {ok: true})
assert.equal(localStorage.values.gistDocumentName, '')
const newDocumentState = await sendMessage({type: 'get-gist-state'})
assert.equal(newDocumentState.response.documentName, '')

const autoNamedSave = await sendMessage({type: 'sync-gist', documentName: ''})
assert.equal(autoNamedSave.response.ok, true)
assert.match(autoNamedSave.response.documentName, /^Document \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
assert.equal(localStorage.values.gistDocumentName, autoNamedSave.response.documentName)
assert.equal(localStorage.values.gistDocuments[0].name, autoNamedSave.response.documentName)
assert.deepEqual(
  {
    name: localStorage.values.gistLastSavedDocument.name,
    url: localStorage.values.gistLastSavedDocument.url,
  },
  {
    name: autoNamedSave.response.documentName,
    url: 'https://textarea.my/#shared',
  }
)

const refreshed = await sendMessage(
  {type: 'refresh-gist-document', documentName: autoNamedSave.response.documentName},
  {url: 'https://textarea.my/#shared'}
)
assert.equal(refreshed.response.ok, true)
assert.equal(refreshed.response.deviceId, '0464E599')
assert.deepEqual(
  {
    name: refreshed.response.document.name,
    url: refreshed.response.document.url,
    updatedByDeviceId: refreshed.response.document.updatedByDeviceId,
  },
  {
    name: autoNamedSave.response.documentName,
    url: 'https://textarea.my/#shared',
    updatedByDeviceId: '0464E599',
  }
)

const refreshedMissing = await sendMessage(
  {type: 'refresh-gist-document', documentName: 'Not a document'},
  {url: 'https://textarea.my/#shared'}
)
assert.deepEqual(refreshedMissing.response, {ok: true, connected: true, document: null})

const refreshedElsewhere = await sendMessage({type: 'refresh-gist-document', documentName: 'Any'})
assert.deepEqual(refreshedElsewhere.response, {
  ok: false,
  error: 'Document updates are available only on textarea.my.',
})

const deletedName = autoNamedSave.response.documentName
const deleted = await sendMessage({type: 'delete-gist-document', documentName: deletedName})
assert.equal(deleted.response.ok, true)
assert.equal(deleted.response.documents.some(value => value.name === deletedName), false)
assert.equal(remoteDocuments.some(value => value.name === deletedName), false)
assert.equal(localStorage.values.gistDocumentName, '')
assert.equal(localStorage.values.gistLastSavedDocument, undefined)

const deletedMissing = await sendMessage({type: 'delete-gist-document', documentName: ''})
assert.deepEqual(deletedMissing.response, {ok: false, error: 'Document name is invalid.'})

assert.equal(messageListener({type: 'unknown'}, {}, () => {}), false)
console.log('Shared background adapter tests passed')
