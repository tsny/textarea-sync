const extensionApi = globalThis.browser ?? globalThis.chrome
const {getLatest, saveLatest} = globalThis.TextareaDocumentStorage
const {
  isAuthenticationError: isPastebinAuthenticationError,
  load: loadPastebin,
  login: loginPastebin,
  normalizeDocumentName,
  replace: replacePastebin,
} = globalThis.TextareaPastebin
const TEXTAREA_ORIGIN = 'https://textarea.my'
const PASTEBIN_CREDENTIALS_KEY = 'pastebinCredentials'
const PASTEBIN_DEVICE_ID_KEY = 'pastebinDeviceId'
const PASTEBIN_DOCUMENT_NAME_KEY = 'pastebinDocumentName'
const PASTEBIN_DOCUMENTS_KEY = 'pastebinDocuments'
const PASTEBIN_LAST_SAVED_DOCUMENT_KEY = 'pastebinLastSavedDocument'
const PASTEBIN_LAST_URL_KEY = 'pastebinLastUrl'
let saveQueue = Promise.resolve()
let deviceIdRequest = null

function getDeviceId() {
  if (!deviceIdRequest) {
    deviceIdRequest = extensionApi.storage.local.get(PASTEBIN_DEVICE_ID_KEY).then(async values => {
      if (typeof values[PASTEBIN_DEVICE_ID_KEY] === 'string') {
        return values[PASTEBIN_DEVICE_ID_KEY]
      }
      const bytes = crypto.getRandomValues(new Uint8Array(4))
      const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
      await extensionApi.storage.local.set({[PASTEBIN_DEVICE_ID_KEY]: id})
      return id
    }).finally(() => { deviceIdRequest = null })
  }
  return deviceIdRequest
}

async function getPastebinCredentials() {
  return (await extensionApi.storage.local.get(PASTEBIN_CREDENTIALS_KEY))[PASTEBIN_CREDENTIALS_KEY]
}

async function connectPastebin(message) {
  const developerKey = String(message.developerKey || '').trim()
  const username = String(message.username || '').trim()
  const password = String(message.password || '')
  const userKey = await loginPastebin(developerKey, username, password)
  await extensionApi.storage.local.set({
    [PASTEBIN_CREDENTIALS_KEY]: {developerKey, userKey, username, password},
  })
  return {username}
}

async function refreshPastebinCredentials(credentials) {
  if (!credentials) credentials = await getPastebinCredentials()
  if (!credentials) throw new Error('Connect a Pastebin account first.')
  if (!credentials.username || !credentials.password) {
    throw new Error('Reconnect Pastebin once to store the password needed to refresh the user key.')
  }
  const userKey = await loginPastebin(
    credentials.developerKey,
    credentials.username,
    credentials.password
  )
  const refreshed = {...credentials, userKey}
  await extensionApi.storage.local.set({[PASTEBIN_CREDENTIALS_KEY]: refreshed})
  return refreshed
}

async function withRefreshedPastebinKey(credentials, operation) {
  try {
    return await operation(credentials)
  } catch (error) {
    if (!isPastebinAuthenticationError(error) || !credentials.username || !credentials.password) {
      throw error
    }

    const refreshed = await refreshPastebinCredentials(credentials)
    return operation(refreshed)
  }
}

async function getPastebinState() {
  const credentials = await getPastebinCredentials()
  if (!credentials) return {connected: false}

  const localState = await extensionApi.storage.local.get(PASTEBIN_LAST_URL_KEY)
  const nameState = await extensionApi.storage.local.get(PASTEBIN_DOCUMENT_NAME_KEY)
  const latest = await getLatest(extensionApi.storage.local)
  const hasSelectedDocument = Object.hasOwn(nameState, PASTEBIN_DOCUMENT_NAME_KEY)
  const documentName = normalizeDocumentName(
    hasSelectedDocument ? nameState[PASTEBIN_DOCUMENT_NAME_KEY] : latest?.title || 'Textarea'
  )
  try {
    const remote = await withRefreshedPastebinKey(credentials, loadPastebin)
    await extensionApi.storage.local.set({[PASTEBIN_DOCUMENTS_KEY]: remote.documents})
    return {
      connected: true,
      username: credentials.username,
      documentName,
      documents: remote.documents,
      pasteUrl: remote.pastes[0]?.url || localState[PASTEBIN_LAST_URL_KEY] || null,
    }
  } catch (error) {
    return {
      connected: true,
      username: credentials.username,
      documentName,
      documents: [],
      pasteUrl: localState[PASTEBIN_LAST_URL_KEY] || null,
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

async function syncLatestToPastebin(requestedDocumentName) {
  const credentials = await getPastebinCredentials()
  if (!credentials) throw new Error('Connect a Pastebin account first.')
  const latest = await getLatest(extensionApi.storage.local)
  if (!latest) throw new Error('Open and edit a textarea before syncing to Pastebin.')

  const deviceId = await getDeviceId()
  const name = normalizeDocumentName(requestedDocumentName) || createDocumentName()
  await extensionApi.storage.local.set({[PASTEBIN_DOCUMENT_NAME_KEY]: name})
  const localDocument = {
    name,
    url: `${TEXTAREA_ORIGIN}${latest.path}`,
    title: latest.title,
    updatedAt: latest.savedAt,
    updatedByDeviceId: deviceId,
  }
  const result = await withRefreshedPastebinKey(
    credentials,
    currentCredentials => replacePastebin(currentCredentials, localDocument)
  )
  await extensionApi.storage.local.set({
    [PASTEBIN_DOCUMENTS_KEY]: result.documents,
    [PASTEBIN_LAST_SAVED_DOCUMENT_KEY]: {
      name,
      url: localDocument.url,
      savedAt: Date.now(),
    },
    [PASTEBIN_LAST_URL_KEY]: result.pasteUrl,
  })
  return {...result, documentName: name}
}

async function getPastebinDocumentTitle(value) {
  const document = documentFromUrl(value)
  if (!document) return null
  const url = `${TEXTAREA_ORIGIN}${document.path}`
  const state = await extensionApi.storage.local.get([
    PASTEBIN_DOCUMENT_NAME_KEY,
    PASTEBIN_DOCUMENTS_KEY,
  ])
  const documents = Array.isArray(state[PASTEBIN_DOCUMENTS_KEY])
    ? state[PASTEBIN_DOCUMENTS_KEY]
    : []
  const matchingDocuments = documents.filter(candidate => candidate?.url === url)
  const selectedName = normalizeDocumentName(state[PASTEBIN_DOCUMENT_NAME_KEY])
  const match = matchingDocuments.find(candidate => (
    selectedName && normalizeDocumentName(candidate.name).toLocaleLowerCase() ===
      selectedName.toLocaleLowerCase()
  )) || matchingDocuments[0]
  return match ? normalizeDocumentName(match.name) : null
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
      console.error('Unable to sync textarea.my document:', error)
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

  if (message?.type === 'get-pastebin-document-title') {
    const senderUrl = sender.url || sender.tab?.url
    if (!senderUrl?.startsWith(`${TEXTAREA_ORIGIN}/`)) {
      return {ok: false, error: 'Document titles are available only on textarea.my.'}
    }
    return getPastebinDocumentTitle(message.url || senderUrl)
      .then(name => ({ok: true, name}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'connect-pastebin') {
    return connectPastebin(message)
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-pastebin-state') {
    return getPastebinState()
      .then(state => ({ok: true, ...state}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'refresh-pastebin-key') {
    return refreshPastebinCredentials()
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'select-pastebin-document') {
    const name = normalizeDocumentName(message.documentName)
    if (!name) return {ok: false, error: 'Document name is invalid.'}
    return extensionApi.storage.local.set({[PASTEBIN_DOCUMENT_NAME_KEY]: name})
      .then(() => ({ok: true, documentName: name}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'start-new-pastebin-document') {
    return extensionApi.storage.local.set({[PASTEBIN_DOCUMENT_NAME_KEY]: ''})
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'get-pastebin-connection') {
    return getPastebinCredentials()
      .then(credentials => ({ok: true, connected: Boolean(credentials)}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'open-pastebin-setup') {
    const senderUrl = sender.url || sender.tab?.url
    if (!senderUrl?.startsWith(`${TEXTAREA_ORIGIN}/`)) {
      return {ok: false, error: 'Pastebin setup can only be opened from textarea.my.'}
    }
    return extensionApi.tabs.create({url: extensionApi.runtime.getURL('popup.html')})
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'sync-pastebin') {
    return syncLatestToPastebin(message.documentName)
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'disconnect-pastebin') {
    return extensionApi.storage.local.remove([
      PASTEBIN_CREDENTIALS_KEY,
      PASTEBIN_DOCUMENTS_KEY,
      PASTEBIN_LAST_SAVED_DOCUMENT_KEY,
      PASTEBIN_LAST_URL_KEY,
    ])
      .then(() => ({ok: true}))
      .catch(error => ({ok: false, error: error.message}))
  }
}

// Firefox accepts a returned Promise from a message listener, while Chrome's
// broadly compatible contract is sendResponse plus a literal true. Use the
// latter in both browsers so the shared background has one dispatch path.
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
