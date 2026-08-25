import {getLatest, saveLatest} from './sync-storage.js'

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
    .then(() => saveLatest(chrome.storage.sync, document))
    .then(result => {
      if (result.changed) {
        chrome.action.setBadgeBackgroundColor({color: '#2e7d32'})
        chrome.action.setBadgeText({text: '✓'})
      }
      return result
    })
    .catch(error => {
      console.error('Unable to sync textarea.my document:', error)
      chrome.action.setBadgeText({text: '!'})
      chrome.action.setBadgeBackgroundColor({color: '#c62828'})
      throw error
    })
  return saveQueue
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({color: '#2e7d32'})
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url) return
  const document = documentFromUrl(changeInfo.url, tab.title)
  if (document) queueSave(document).catch(() => {})
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'save-current') {
    const senderUrl = sender.url || sender.tab?.url
    const document = documentFromUrl(message.url || senderUrl, message.title)
    if (!document || !senderUrl?.startsWith(`${TEXTAREA_ORIGIN}/`)) {
      sendResponse({ok: false, error: 'Invalid textarea.my URL.'})
      return
    }

    queueSave(document)
      .then(() => sendResponse({ok: true}))
      .catch(error => sendResponse({ok: false, error: error.message}))
    return true
  }

  if (message?.type === 'get-latest') {
    getLatest(chrome.storage.sync)
      .then(document => sendResponse({ok: true, document}))
      .catch(error => sendResponse({ok: false, error: error.message}))
    return true
  }
})
