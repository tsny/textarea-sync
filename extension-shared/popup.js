const extensionApi = globalThis.browser ?? globalThis.chrome
const {capturePastebinCredentials} = globalThis.TextareaPopupForm
const status = document.querySelector('#status')
const details = document.querySelector('#details')
const openButton = document.querySelector('#open')
const pastebinStatus = document.querySelector('#pastebin-status')
const pastebinForm = document.querySelector('#pastebin-form')
const pastebinConnected = document.querySelector('#pastebin-connected')
const pastebinAccount = document.querySelector('#pastebin-account')
const pastebinDocumentName = document.querySelector('#pastebin-document-name')
const pastebinSave = document.querySelector('#pastebin-save')
const pastebinNew = document.querySelector('#pastebin-new')
const pastebinRefreshKey = document.querySelector('#pastebin-refresh-key')
const pastebinOpen = document.querySelector('#pastebin-open')
const pastebinDisconnect = document.querySelector('#pastebin-disconnect')
const pastebinDocuments = document.querySelector('#pastebin-documents')
const pastebinDocumentsHeading = document.querySelector('#pastebin-documents-heading')
const pastebinApiHelp = document.querySelector('#pastebin-api-help')
let latest = null
let pastebinUrl = null

extensionApi.runtime.sendMessage({type: 'get-latest'}).then(response => {
  if (!response?.ok) throw new Error(response?.error || 'Local extension storage is unavailable.')
  if (!response.document) {
    status.textContent = 'No local document has been saved yet.'
    return
  }

  latest = response.document
  status.textContent = latest.title
  details.textContent = `Saved ${new Date(latest.savedAt).toLocaleString()}`
  details.hidden = false
  openButton.disabled = false
}).catch(error => {
  status.textContent = error.message
})

openButton.addEventListener('click', () => {
  if (!latest) return
  extensionApi.tabs.create({url: `https://textarea.my${latest.path}`})
  window.close()
})

function setPastebinBusy(busy) {
  for (const element of pastebinForm.elements) element.disabled = busy
  pastebinSave.disabled = busy
  pastebinNew.disabled = busy
  pastebinDocumentName.disabled = busy
  pastebinRefreshKey.disabled = busy
  pastebinDisconnect.disabled = busy
}

function formatUpdatedAgo(updatedAt) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Number(updatedAt)) / 60000))
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} hr${elapsedHours === 1 ? '' : 's'} ago`

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`
  return new Date(updatedAt).toLocaleDateString()
}

function renderDocuments(documents = []) {
  pastebinDocuments.replaceChildren()
  pastebinDocumentsHeading.hidden = documents.length === 0
  for (const syncedDocument of documents) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    const name = document.createElement('span')
    const updated = document.createElement('span')
    button.type = 'button'
    name.className = 'document-list-name'
    name.textContent = syncedDocument.name
    updated.className = 'document-list-updated'
    updated.textContent = formatUpdatedAgo(syncedDocument.updatedAt)
    button.title = `${syncedDocument.title} · Updated ${new Date(syncedDocument.updatedAt).toLocaleString()}`
    button.addEventListener('click', async () => {
      const response = await extensionApi.runtime.sendMessage({
        type: 'select-pastebin-document',
        documentName: syncedDocument.name,
      })
      if (response?.ok) {
        extensionApi.tabs.create({url: syncedDocument.url})
        window.close()
      } else {
        pastebinStatus.textContent = response?.error || 'Unable to select the document.'
      }
    })
    button.append(name, updated)
    item.append(button)
    pastebinDocuments.append(item)
  }
}

function showPastebinState(state) {
  pastebinForm.hidden = state.connected
  pastebinConnected.hidden = !state.connected
  if (!state.connected) {
    pastebinStatus.textContent = 'Connect your account to maintain an unlisted cross-device sync paste.'
    pastebinUrl = null
    return
  }

  pastebinAccount.textContent = `Connected as ${state.username}`
  pastebinDocumentName.value = state.documentName
  pastebinStatus.textContent = state.error || 'Ready. Changes are shared when you choose Save.'
  pastebinUrl = state.pasteUrl
  pastebinOpen.hidden = !pastebinUrl
  renderDocuments(state.documents)
}

async function loadPastebinState() {
  const response = await extensionApi.runtime.sendMessage({type: 'get-pastebin-state'})
  if (!response?.ok) throw new Error(response?.error || 'Unable to check Pastebin.')
  showPastebinState(response)
}

pastebinForm.addEventListener('submit', async event => {
  event.preventDefault()
  const credentials = capturePastebinCredentials(pastebinForm, setPastebinBusy)
  pastebinStatus.textContent = 'Connecting to Pastebin…'
  try {
    const response = await extensionApi.runtime.sendMessage({
      type: 'connect-pastebin',
      ...credentials,
    })
    if (!response?.ok) throw new Error(response?.error || 'Unable to connect Pastebin.')
    pastebinForm.reset()
    await loadPastebinState()
  } catch (error) {
    pastebinStatus.textContent = error.message
  } finally {
    setPastebinBusy(false)
  }
})

async function saveCurrentDocument() {
  pastebinStatus.textContent = 'Saving document…'
  const response = await extensionApi.runtime.sendMessage({
    type: 'sync-pastebin',
    documentName: pastebinDocumentName.value,
  })
  if (!response?.ok) throw new Error(response?.error || 'Unable to save the document.')
  pastebinDocumentName.value = response.documentName
  pastebinStatus.textContent = response.deletionFailures
    ? 'Saved, but Pastebin could not remove every older copy.'
    : 'Document saved.'
  pastebinUrl = response.pasteUrl
  pastebinOpen.hidden = !pastebinUrl
  renderDocuments(response.documents)
  return response
}

pastebinSave.addEventListener('click', async () => {
  setPastebinBusy(true)
  try {
    await saveCurrentDocument()
  } catch (error) {
    pastebinStatus.textContent = error.message
  } finally {
    setPastebinBusy(false)
  }
})

pastebinNew.addEventListener('click', async () => {
  setPastebinBusy(true)
  try {
    await saveCurrentDocument()
    const response = await extensionApi.runtime.sendMessage({type: 'start-new-pastebin-document'})
    if (!response?.ok) throw new Error(response?.error || 'Unable to start a new document.')
    await extensionApi.tabs.create({url: 'https://textarea.my/#new'})
    window.close()
  } catch (error) {
    pastebinStatus.textContent = error.message
    setPastebinBusy(false)
  }
})

pastebinRefreshKey.addEventListener('click', async () => {
  setPastebinBusy(true)
  pastebinStatus.textContent = 'Refreshing Pastebin user key…'
  try {
    const response = await extensionApi.runtime.sendMessage({type: 'refresh-pastebin-key'})
    if (!response?.ok) throw new Error(response?.error || 'Unable to refresh the user key.')
    pastebinStatus.textContent = 'Pastebin user key refreshed.'
  } catch (error) {
    pastebinStatus.textContent = error.message
  } finally {
    setPastebinBusy(false)
  }
})

pastebinOpen.addEventListener('click', () => {
  if (pastebinUrl) extensionApi.tabs.create({url: pastebinUrl})
  window.close()
})

pastebinDisconnect.addEventListener('click', async () => {
  setPastebinBusy(true)
  const response = await extensionApi.runtime.sendMessage({type: 'disconnect-pastebin'})
  setPastebinBusy(false)
  if (!response?.ok) {
    pastebinStatus.textContent = response?.error || 'Unable to disconnect Pastebin.'
    return
  }
  showPastebinState({connected: false})
})

pastebinApiHelp.addEventListener('click', () => {
  extensionApi.tabs.create({url: 'https://pastebin.com/doc_api#1'})
  window.close()
})

loadPastebinState().catch(error => {
  pastebinStatus.textContent = error.message
  pastebinForm.hidden = false
})
