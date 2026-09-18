const extensionApi = globalThis.browser ?? globalThis.chrome
const {getLatest, saveLatest} = globalThis.TextareaDocumentStorage
const {
  connect: connectGist,
  load: loadGist,
  normalizeDocumentName,
  replace: replaceGist,
} = globalThis.TextareaGist
const TEXTAREA_ORIGIN = 'https://textarea.my'
const GITHUB_CREDENTIALS_KEY = 'githubCredentials'
const GIST_DOCUMENT_NAME_KEY = 'gistDocumentName'
const GIST_DOCUMENTS_KEY = 'gistDocuments'
const GIST_LAST_SAVED_DOCUMENT_KEY = 'gistLastSavedDocument'
const GIST_URL_KEY = 'gistUrl'
const SYNC_DEVICE_ID_KEY = 'syncDeviceId'
const LEGACY_PASTEBIN_KEYS = [
  'pastebinCredentials',
  'pastebinDeviceId',
  'pastebinDocumentName',
  'pastebinDocuments',
  'pastebinLastSavedDocument',
  'pastebinLastUrl',
]
let saveQueue = Promise.resolve()
let deviceIdRequest = null

function getDeviceId() {
  if (!deviceIdRequest) {
    deviceIdRequest = extensionApi.storage.local.get([
      SYNC_DEVICE_ID_KEY,
      'pastebinDeviceId',
    ]).then(async values => {
      const existing = values[SYNC_DEVICE_ID_KEY] || values.pastebinDeviceId
      if (typeof existing === 'string') {
        await extensionApi.storage.local.set({[SYNC_DEVICE_ID_KEY]: existing})
        return existing
      }
      const bytes = crypto.getRandomValues(new Uint8Array(4))
      const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
      await extensionApi.storage.local.set({[SYNC_DEVICE_ID_KEY]: id})
      return id
    }).finally(() => { deviceIdRequest = null })
  }
  return deviceIdRequest
}

async function getGitHubCredentials() {
  return (await extensionApi.storage.local.get(GITHUB_CREDENTIALS_KEY))[GITHUB_CREDENTIALS_KEY]
}

async function connectGitHub(message) {
  const legacy = await extensionApi.storage.local.get([
    'pastebinDeviceId',
    'pastebinDocumentName',
    'pastebinDocuments',
  ])
  const seedDocuments = Array.isArray(legacy.pastebinDocuments) ? legacy.pastebinDocuments : []
  const result = await connectGist(message.token, seedDocuments)
  const credentials = {
    token: result.token,
    username: result.username,
    gistId: result.gistId,
  }
  const values = {
    [GITHUB_CREDENTIALS_KEY]: credentials,
    [GIST_DOCUMENTS_KEY]: result.documents,
    [GIST_URL_KEY]: result.gistUrl,
  }
  if (typeof legacy.pastebinDocumentName === 'string') {
    values[GIST_DOCUMENT_NAME_KEY] = legacy.pastebinDocumentName
  }
  if (typeof legacy.pastebinDeviceId === 'string') {
    values[SYNC_DEVICE_ID_KEY] = legacy.pastebinDeviceId
  }
  await extensionApi.storage.local.set(values)
  await extensionApi.storage.local.remove(LEGACY_PASTEBIN_KEYS)
  return {username: result.username, gistUrl: result.gistUrl}
}

async function getGistState({cached = false} = {}) {
  const credentials = await getGitHubCredentials()
  if (!credentials) return {connected: false}

  const localState = await extensionApi.storage.local.get([
    GIST_DOCUMENT_NAME_KEY,
    GIST_DOCUMENTS_KEY,
    GIST_URL_KEY,
  ])
  const latest = await getLatest(extensionApi.storage.local)
  const hasSelectedDocument = Object.hasOwn(localState, GIST_DOCUMENT_NAME_KEY)
  const documentName = normalizeDocumentName(
    hasSelectedDocument ? localState[GIST_DOCUMENT_NAME_KEY] : latest?.title || 'Textarea'
  )
  const localDocuments = Array.isArray(localState[GIST_DOCUMENTS_KEY])
    ? localState[GIST_DOCUMENTS_KEY]
    : []
  if (cached) {
    return {
      connected: true,
      username: credentials.username,
      documentName,
      documents: localDocuments,
      gistUrl: localState[GIST_URL_KEY] || null,
    }
  }

  try {
    const remote = await loadGist(credentials)
    await extensionApi.storage.local.set({
      [GIST_DOCUMENTS_KEY]: remote.documents,
      [GIST_URL_KEY]: remote.gistUrl,
    })
    return {
      connected: true,
      username: credentials.username,
      documentName,
      documents: remote.documents,
      gistUrl: remote.gistUrl,
    }
  } catch (error) {
    return {
      connected: true,
      username: credentials.username,
      documentName,
      documents: localDocuments,
      gistUrl: localState[GIST_URL_KEY] || null,
      error: error.message,
    }
  }
}

function createDocumentName() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return `Document ${timestamp}`
}

async function syncLatestToGist(requestedDocumentName) {
  const credentials = await getGitHubCredentials()
  if (!credentials) throw new Error('Connect a GitHub account first.')
  const latest = await getLatest(extensionApi.storage.local)
  if (!latest) throw new Error('Open and edit a textarea before saving to GitHub.')

  const deviceId = await getDeviceId()
  const name = normalizeDocumentName(requestedDocumentName) || createDocumentName()
  await extensionApi.storage.local.set({[GIST_DOCUMENT_NAME_KEY]: name})
  const localDocument = {
    name,
    url: `${TEXTAREA_ORIGIN}${latest.path}`,
    title: latest.title,
    updatedAt: latest.savedAt,
    updatedByDeviceId: deviceId,
  }
  const result = await replaceGist(credentials, localDocument)
  await extensionApi.storage.local.set({
    [GIST_DOCUMENTS_KEY]: result.documents,
    [GIST_LAST_SAVED_DOCUMENT_KEY]: {
      name,
      url: localDocument.url,
      savedAt: Date.now(),
    },
    [GIST_URL_KEY]: result.gistUrl,
  })
  return {...result, documentName: name}
}

async function getGistDocumentTitle(value) {
  const document = documentFromUrl(value)
  if (!document) return null
  const url = `${TEXTAREA_ORIGIN}${document.path}`
  const state = await extensionApi.storage.local.get([
    GIST_DOCUMENT_NAME_KEY,
    GIST_DOCUMENTS_KEY,
  ])
  const documents = Array.isArray(state[GIST_DOCUMENTS_KEY]) ? state[GIST_DOCUMENTS_KEY] : []
  const matchingDocuments = documents.filter(candidate => candidate?.url === url)
  const selectedName = normalizeDocumentName(state[GIST_DOCUMENT_NAME_KEY])
  const match = matchingDocuments.find(candidate => (
    selectedName && normalizeDocumentName(candidate.name).toLocaleLowerCase() ===
      selectedName.toLocaleLowerCase()
  )) || matchingDocuments[0]
  return match ? normalizeDocumentName(match.name) : null
}

async function refreshGistDocument(requestedDocumentName) {
  const credentials = await getGitHubCredentials()
  if (!credentials) return {connected: false, document: null}

  const remote = await loadGist(credentials)
  await extensionApi.storage.local.set({
    [GIST_DOCUMENTS_KEY]: remote.documents,
    [GIST_URL_KEY]: remote.gistUrl,
  })
  const name = normalizeDocumentName(requestedDocumentName)
  const match = name && remote.documents.find(candidate => (
    normalizeDocumentName(candidate?.name).toLocaleLowerCase() === name.toLocaleLowerCase()
  ))
  if (!match) return {connected: true, document: null}
  const document = documentFromUrl(match.url, match.title)
  if (!document) return {connected: true, document: null}
  return {
    connected: true,
    deviceId: await getDeviceId(),
    document: {
      name: normalizeDocumentName(match.name),
      url: `${TEXTAREA_ORIGIN}${document.path}`,
      updatedAt: Number(match.updatedAt),
      updatedByDeviceId: match.updatedByDeviceId || '',
    },
  }
}

async function getRecentGistDocuments() {
  const state = await extensionApi.storage.local.get(GIST_DOCUMENTS_KEY)
  const documents = Array.isArray(state[GIST_DOCUMENTS_KEY]) ? state[GIST_DOCUMENTS_KEY] : []
  return documents.map(candidate => {
    const document = documentFromUrl(candidate?.url)
    const name = normalizeDocumentName(candidate?.name)
    const updatedAt = Number(candidate?.updatedAt)
    if (!document || !name || !Number.isFinite(updatedAt)) return null
    return {
      name,
      url: `${TEXTAREA_ORIGIN}${document.path}`,
      updatedAt,
    }
  }).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)
}

function documentFromUrl(value, title = 'Textarea') {
  let url
  try {
    url = new URL(value, TEXTAREA_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== TEXTAREA_ORIGIN || !url.hash || url.hash === '#new') return null
  return {path: url.pathname + url.search + url.hash, title}
}

function queueSave(document) {
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => saveLatest(extensionApi.storage.local, document))
    .then(result => {
      extensionApi.action.setBadgeText({text: ''})
      return result
    })
    .catch(error => {
      console.error('Unable to save textarea.my document:', error)
      extensionApi.action.setBadgeText({text: '!'})
      extensionApi.action.setBadgeBackgroundColor({color: '#c62828'})
      throw error
    })
  return saveQueue
}

extensionApi.runtime.onInstalled.addListener(() => {
  extensionApi.action.setBadgeText({text: ''})
})

extensionApi.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url) return
  const document = documentFromUrl(changeInfo.url, tab.title)
  if (document) queueSave(document).catch(() => {})
})

function requireTextareaSender(sender, error) {
  const senderUrl = sender.url || sender.tab?.url
  return senderUrl?.startsWith(`${TEXTAREA_ORIGIN}/`) ? senderUrl : {error}
}

function handleMessage(message, sender) {
  if (message?.type === 'save-current') {
    const senderUrl = sender.url || sender.tab?.url
    const document = documentFromUrl(message.url || senderUrl, message.title)
    if (!document || !senderUrl?.startsWith(`${TEXTAREA_ORIGIN}/`)) {
      return {ok: false, error: 'Invalid textarea.my URL.'}
    }
    return queueSave(document)
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-latest') {
    return getLatest(extensionApi.storage.local)
      .then(document => ({ok: true, document}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-gist-document-title') {
    const senderUrl = requireTextareaSender(sender, 'Document titles are available only on textarea.my.')
    if (typeof senderUrl !== 'string') return {ok: false, ...senderUrl}
    return getGistDocumentTitle(message.url || senderUrl)
      .then(name => ({ok: true, name}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-recent-gist-documents') {
    const senderUrl = requireTextareaSender(sender, 'Recent documents are available only on textarea.my.')
    if (typeof senderUrl !== 'string') return {ok: false, ...senderUrl}
    return getRecentGistDocuments()
      .then(documents => ({ok: true, documents}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'refresh-gist-document') {
    const senderUrl = requireTextareaSender(sender, 'Document updates are available only on textarea.my.')
    if (typeof senderUrl !== 'string') return {ok: false, ...senderUrl}
    return refreshGistDocument(message.documentName)
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'connect-github') {
    return connectGitHub(message)
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-gist-state') {
    return getGistState({cached: message.cached === true})
      .then(state => ({ok: true, ...state}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'select-gist-document') {
    const name = normalizeDocumentName(message.documentName)
    if (!name) return {ok: false, error: 'Document name is invalid.'}
    return extensionApi.storage.local.set({[GIST_DOCUMENT_NAME_KEY]: name})
      .then(() => ({ok: true, documentName: name}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'start-new-gist-document') {
    return extensionApi.storage.local.set({[GIST_DOCUMENT_NAME_KEY]: ''})
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-github-connection') {
    return getGitHubCredentials()
      .then(credentials => ({ok: true, connected: Boolean(credentials)}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'open-sync-setup') {
    const senderUrl = requireTextareaSender(sender, 'Sync setup can only be opened from textarea.my.')
    if (typeof senderUrl !== 'string') return {ok: false, ...senderUrl}
    return extensionApi.tabs.create({url: extensionApi.runtime.getURL('popup.html')})
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'sync-gist') {
    return syncLatestToGist(message.documentName)
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'disconnect-github') {
    return extensionApi.storage.local.remove([
      GITHUB_CREDENTIALS_KEY,
      GIST_DOCUMENTS_KEY,
      GIST_LAST_SAVED_DOCUMENT_KEY,
      GIST_URL_KEY,
    ]).then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let response
  try {
    response = handleMessage(message, sender)
  } catch (error) {
    sendResponse({ok: false, error: error.message})
    return false
  }
  if (response === undefined) return false
  Promise.resolve(response)
    .then(sendResponse)
    .catch(error => sendResponse({ok: false, error: error.message}))
  return true
})
