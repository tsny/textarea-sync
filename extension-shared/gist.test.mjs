import assert from 'node:assert/strict'
import './gist.js'

const {
  connect,
  mergeDocuments,
  normalizeDocumentName,
  parseSyncFile,
  remove,
  replace,
} = globalThis.TextareaGist

assert.deepEqual(parseSyncFile('{"version":1,"documents":[]}'), [])
assert.equal(parseSyncFile('not json'), null)
assert.equal(normalizeDocumentName('  Work notes  '), 'Work notes')
assert.equal(normalizeDocumentName(''), '')

const oldDocument = {
  name: 'Draft',
  url: 'https://textarea.my/#old',
  title: 'Old',
  updatedAt: 100,
  updatedByDeviceId: 'DEVICE-A',
}
const newDocument = {...oldDocument, url: 'https://textarea.my/#newer', updatedAt: 200}
assert.deepEqual(mergeDocuments([[oldDocument], [newDocument]]), [newDocument])
assert.equal(
  mergeDocuments([[{
    deviceId: 'DEVICE-A',
    deviceName: 'Work laptop',
    url: 'https://textarea.my/#legacy',
    title: 'Textarea',
    updatedAt: 50,
  }]])[0].name,
  'Work laptop'
)

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  }
}

const createCalls = []
const created = await connect(' github-token ', [newDocument], async (url, options) => {
  createCalls.push({url, options})
  if (url.endsWith('/user')) return jsonResponse({login: 'octocat'})
  if (url.includes('/gists?')) return jsonResponse([])
  if (url.endsWith('/gists') && options.method === 'POST') {
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {'textarea-sync.json': {}},
    }, 201)
  }
  assert.fail(`Unexpected GitHub request: ${options.method} ${url}`)
})

assert.equal(created.token, 'github-token')
assert.equal(created.username, 'octocat')
assert.equal(created.gistId, 'gist-1')
assert.deepEqual(created.documents, [newDocument])
const createCall = createCalls.find(call => call.options.method === 'POST')
const createBody = JSON.parse(createCall.options.body)
assert.equal(createBody.description, 'textarea.my sync')
assert.equal(createBody.public, false)
const createdPayload = JSON.parse(createBody.files['textarea-sync.json'].content)
assert.equal(createdPayload.app, 'textarea-sync')
assert.equal(createdPayload.version, 2)
assert.deepEqual(createdPayload.documents, [newDocument])

const remoteDocument = {
  name: 'Shopping list',
  url: 'https://textarea.my/#remote',
  title: 'Remote',
  updatedAt: 150,
  updatedByDeviceId: 'DEVICE-B',
}

const existingCalls = []
const existing = await connect('github-token', [newDocument], async (url, options) => {
  existingCalls.push({url, options})
  if (url.endsWith('/user')) return jsonResponse({login: 'octocat'})
  if (url.includes('/gists?')) {
    return jsonResponse([{
      id: 'gist-1',
      description: 'textarea.my sync',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {'textarea-sync.json': {}},
    }])
  }
  if (url.endsWith('/gists/gist-1') && options.method === 'GET') {
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {
        'textarea-sync.json': {
          content: JSON.stringify({version: 2, documents: [remoteDocument]}),
        },
      },
    })
  }
  if (url.endsWith('/gists/gist-1') && options.method === 'PATCH') {
    return jsonResponse({
      id: 'gist-1',
      html_url: 'https://gist.github.com/octocat/gist-1',
      files: {'textarea-sync.json': {}},
    })
  }
  assert.fail(`Unexpected GitHub request: ${options.method} ${url}`)
})
assert.equal(existing.gistId, 'gist-1')
assert.deepEqual(existing.documents, [newDocument, remoteDocument])
assert.equal(existingCalls.filter(call => call.options.method === 'POST').length, 0)
assert.equal(existingCalls.filter(call => call.options.method === 'PATCH').length, 1)

const replaceCalls = []
const replaced = await replace(
  {token: 'github-token', gistId: 'gist-1'},
  newDocument,
  async (url, options) => {
    replaceCalls.push({url, options})
    if (options.method === 'GET') {
      return jsonResponse({
        id: 'gist-1',
        html_url: 'https://gist.github.com/octocat/gist-1',
        files: {
          'textarea-sync.json': {
            content: JSON.stringify({version: 2, documents: [remoteDocument]}),
          },
        },
      })
    }
    if (options.method === 'PATCH') {
      return jsonResponse({
        id: 'gist-1',
        html_url: 'https://gist.github.com/octocat/gist-1',
        files: {'textarea-sync.json': {}},
      })
    }
    assert.fail(`Unexpected GitHub request: ${options.method} ${url}`)
  }
)

assert.equal(replaced.gistUrl, 'https://gist.github.com/octocat/gist-1')
assert.deepEqual(replaced.documents, [newDocument, remoteDocument])
const updateCall = replaceCalls.find(call => call.options.method === 'PATCH')
assert.match(updateCall.url, /\/gists\/gist-1$/)
const updatePayload = JSON.parse(JSON.parse(updateCall.options.body).files['textarea-sync.json'].content)
assert.deepEqual(updatePayload.documents, [newDocument, remoteDocument])

const removeCalls = []
const removed = await remove(
  {token: 'github-token', gistId: 'gist-1'},
  'shopping LIST',
  async (url, options) => {
    removeCalls.push({url, options})
    if (options.method === 'GET') {
      return jsonResponse({
        id: 'gist-1',
        html_url: 'https://gist.github.com/octocat/gist-1',
        files: {
          'textarea-sync.json': {
            content: JSON.stringify({version: 2, documents: [remoteDocument, newDocument]}),
          },
        },
      })
    }
    if (options.method === 'PATCH') {
      return jsonResponse({
        id: 'gist-1',
        html_url: 'https://gist.github.com/octocat/gist-1',
        files: {'textarea-sync.json': {}},
      })
    }
    assert.fail(`Unexpected GitHub request: ${options.method} ${url}`)
  }
)
assert.equal(removed.removed, true)
assert.deepEqual(removed.documents.map(value => value.name), [newDocument.name])
const removePayload = JSON.parse(
  JSON.parse(removeCalls.find(call => call.options.method === 'PATCH').options.body)
    .files['textarea-sync.json'].content
)
assert.deepEqual(removePayload.documents.map(value => value.name), [newDocument.name])

const missing = await remove(
  {token: 'github-token', gistId: 'gist-1'},
  'Absent document',
  async (url, options) => {
    if (options.method === 'GET') {
      return jsonResponse({
        id: 'gist-1',
        html_url: 'https://gist.github.com/octocat/gist-1',
        files: {
          'textarea-sync.json': {
            content: JSON.stringify({version: 2, documents: [remoteDocument]}),
          },
        },
      })
    }
    assert.fail('Deleting an unknown document should not write the Gist.')
  }
)
assert.equal(missing.removed, false)

let githubError
try {
  await connect('bad-token', [], async () => jsonResponse({message: 'Bad credentials'}, 401))
} catch (error) {
  githubError = error
}
assert.match(githubError.message, /GitHub request failed \(401\): Bad credentials/)

console.log('Shared GitHub Gist tests passed')
