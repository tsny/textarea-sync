const {getLatest, saveLatest} = TextareaSyncStorage
const TEXTAREA_ORIGIN = 'https://textarea.my'
let saveQueue = Promise.resolve()

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
    .then(() => saveLatest(browser.storage.sync, document))
    .then(result => {
      if (result.changed) {
        browser.action.setBadgeBackgroundColor({color: '#2e7d32'})
        browser.action.setBadgeText({text: '✓'})
      }
      return result
    })
    .catch(error => {
      console.error('Unable to sync textarea.my document:', error)
      browser.action.setBadgeText({text: '!'})
      browser.action.setBadgeBackgroundColor({color: '#c62828'})
      throw error
    })
  return saveQueue
}

browser.runtime.onInstalled.addListener(() => {
  browser.action.setBadgeBackgroundColor({color: '#2e7d32'})
})

browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url) return
  const document = documentFromUrl(changeInfo.url, tab.title)
  if (document) queueSave(document).catch(() => {})
})

browser.runtime.onMessage.addListener((message, sender) => {
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
    return getLatest(browser.storage.sync)
      .then(document => ({ok: true, document}))
      .catch(error => ({ok: false, error: error.message}))
  }
})
