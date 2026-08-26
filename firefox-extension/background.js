const extensionApi = globalThis.browser ?? globalThis.chrome
const {getLatest, saveLatest} = globalThis.TextareaDocumentStorage
const {
  isAuthenticationError: isPastebinAuthenticationError,
  load: loadPastebin,
  login: loginPastebin,
  replace: replacePastebin,
} = globalThis.TextareaPastebin
const TEXTAREA_ORIGIN = 'https://textarea.my'
const PASTEBIN_CREDENTIALS_KEY = 'pastebinCredentials'
const PASTEBIN_DEVICE_ID_KEY = 'pastebinDeviceId'
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

async function withRefreshedPastebinKey(credentials, operation) {
  try {
    return await operation(credentials)
  } catch (error) {
    if (!isPastebinAuthenticationError(error) || !credentials.username || !credentials.password) {
      throw error
    }

    const userKey = await loginPastebin(
      credentials.developerKey,
      credentials.username,
      credentials.password
    )
    const refreshed = {...credentials, userKey}
    await extensionApi.storage.local.set({[PASTEBIN_CREDENTIALS_KEY]: refreshed})
    return operation(refreshed)
  }
}

async function getPastebinState() {
  const credentials = await getPastebinCredentials()
  if (!credentials) return {connected: false}

  const localState = await extensionApi.storage.local.get(PASTEBIN_LAST_URL_KEY)
  try {
    const remote = await withRefreshedPastebinKey(credentials, loadPastebin)
    return {
      connected: true,
      username: credentials.username,
      documents: remote.documents,
      pasteUrl: remote.pastes[0]?.url || localState[PASTEBIN_LAST_URL_KEY] || null,
    }
  } catch (error) {
    return {
      connected: true,
      username: credentials.username,
      documents: [],
      pasteUrl: localState[PASTEBIN_LAST_URL_KEY] || null,
      error: error.message,
    }
  }
}

async function syncLatestToPastebin() {
  const credentials = await getPastebinCredentials()
  if (!credentials) throw new Error('Connect a Pastebin account first.')
  const latest = await getLatest(extensionApi.storage.local)
  if (!latest) throw new Error('Open and edit a textarea before syncing to Pastebin.')

  const deviceId = await getDeviceId()
  const localDocument = {
    deviceId,
    url: `${TEXTAREA_ORIGIN}${latest.path}`,
    title: latest.title,
    updatedAt: latest.savedAt,
  }
  const result = await withRefreshedPastebinKey(
    credentials,
    currentCredentials => replacePastebin(currentCredentials, localDocument)
  )
  await extensionApi.storage.local.set({[PASTEBIN_LAST_URL_KEY]: result.pasteUrl})
  return result
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
    return syncLatestToPastebin()
      .then(result => ({ok: true, ...result}))
      .catch(error => ({ok: false, error: error.message}))
  }

  if (message?.type === 'disconnect-pastebin') {
    return extensionApi.storage.local.remove([PASTEBIN_CREDENTIALS_KEY, PASTEBIN_LAST_URL_KEY])
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
