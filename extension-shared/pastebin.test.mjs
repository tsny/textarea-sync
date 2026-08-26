import assert from 'node:assert/strict'
import './pastebin.js'

const {
  isAuthenticationError,
  login,
  mergeDocuments,
  normalizeDocumentName,
  parsePasteList,
  parseSyncPaste,
  replace,
} = globalThis.TextareaPastebin

const credentials = {developerKey: 'developer-key', userKey: 'user-key'}

const xml = `
  <paste>
    <paste_key>first</paste_key>
    <paste_date>100</paste_date>
    <paste_title>textarea.my sync</paste_title>
    <paste_url>https://pastebin.com/first</paste_url>
  </paste>
  <paste>
    <paste_key>second</paste_key>
    <paste_date>200</paste_date>
    <paste_title>Other &amp; unrelated</paste_title>
    <paste_url>https://pastebin.com/second</paste_url>
  </paste>
  <paste>
    <paste_key>unmanaged</paste_key>
    <paste_date>300</paste_date>
    <paste_title>textarea.my sync</paste_title>
    <paste_url>https://pastebin.com/unmanaged</paste_url>
  </paste>
`

assert.deepEqual(parsePasteList(xml), [
  {
    key: 'first',
    title: 'textarea.my sync',
    url: 'https://pastebin.com/first',
    createdAt: 100000,
  },
  {
    key: 'second',
    title: 'Other & unrelated',
    url: 'https://pastebin.com/second',
    createdAt: 200000,
  },
  {
    key: 'unmanaged',
    title: 'textarea.my sync',
    url: 'https://pastebin.com/unmanaged',
    createdAt: 300000,
  },
])

assert.deepEqual(parseSyncPaste('{"version":1,"documents":[]}'), [])
assert.equal(parseSyncPaste('not json'), null)
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

const loginCalls = []
assert.equal(await login('dev', 'user', 'password', async (url, options) => {
  loginCalls.push({url, values: Object.fromEntries(new URLSearchParams(options.body))})
  return {ok: true, status: 200, text: async () => 'session-key'}
}), 'session-key')
assert.equal(loginCalls[0].values.api_user_password, 'password')

let authenticationError
try {
  await login('dev', 'user', 'password', async () => ({
    ok: false,
    status: 422,
    text: async () => 'invalid api_user_key',
  }))
} catch (error) {
  authenticationError = error
}
assert.match(authenticationError.message, /422.*invalid api_user_key/)
assert.equal(isAuthenticationError(authenticationError), true)

const apiCalls = []
const remoteDocument = {
  name: 'Shopping list',
  url: 'https://textarea.my/#remote',
  title: 'Remote',
  updatedAt: 150,
  updatedByDeviceId: 'DEVICE-B',
}

async function mockFetch(url, options) {
  const values = Object.fromEntries(new URLSearchParams(options.body))
  apiCalls.push({url, values})
  let text = ''
  if (values.api_option === 'list') text = xml
  if (values.api_option === 'show_paste') {
    text = values.api_paste_key === 'unmanaged'
      ? 'This belongs to another Pastebin workflow.'
      : JSON.stringify({version: 1, documents: [remoteDocument]})
  }
  if (values.api_option === 'paste') text = 'https://pastebin.com/replacement'
  if (values.api_option === 'delete') text = 'Paste Removed'
  return {ok: true, status: 200, text: async () => text}
}

const result = await replace(credentials, newDocument, mockFetch)
assert.equal(result.pasteUrl, 'https://pastebin.com/replacement')
assert.deepEqual(result.documents, [newDocument, remoteDocument])
assert.equal(result.deletionFailures, 0)
assert.equal(apiCalls.filter(call => call.values.api_option === 'delete').length, 1)

const createCall = apiCalls.find(call => call.values.api_option === 'paste')
const payload = JSON.parse(createCall.values.api_paste_code)
assert.equal(createCall.values.api_paste_name, 'textarea.my sync')
assert.equal(payload.app, 'textarea-sync')
assert.equal(payload.version, 2)
assert.deepEqual(payload.documents, [newDocument, remoteDocument])

console.log('Shared Pastebin tests passed')
