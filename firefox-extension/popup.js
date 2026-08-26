const extensionApi = globalThis.browser ?? globalThis.chrome
const {capturePastebinCredentials} = globalThis.TextareaPopupForm
const status = document.querySelector('#status')
const details = document.querySelector('#details')
const openButton = document.querySelector('#open')
const pastebinStatus = document.querySelector('#pastebin-status')
const pastebinForm = document.querySelector('#pastebin-form')
const pastebinConnected = document.querySelector('#pastebin-connected')
const pastebinAccount = document.querySelector('#pastebin-account')
const pastebinSync = document.querySelector('#pastebin-sync')
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
    status.textContent = 'No document has been synced yet.'
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
  pastebinSync.disabled = busy
  pastebinDisconnect.disabled = busy
}

function renderDocuments(documents = []) {
  pastebinDocuments.replaceChildren()
  pastebinDocumentsHeading.hidden = documents.length === 0
  for (const syncedDocument of documents) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `${syncedDocument.title} · device ${syncedDocument.deviceId}`
    button.title = `Updated ${new Date(syncedDocument.updatedAt).toLocaleString()}`
    button.addEventListener('click', () => {
      extensionApi.tabs.create({url: syncedDocument.url})
      window.close()
    })
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
  pastebinStatus.textContent = state.error || 'Ready. Updates happen only when you choose “Update Pastebin now.”'
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

pastebinSync.addEventListener('click', async () => {
  setPastebinBusy(true)
  pastebinStatus.textContent = 'Creating the replacement paste…'
  try {
    const response = await extensionApi.runtime.sendMessage({type: 'sync-pastebin'})
    if (!response?.ok) throw new Error(response?.error || 'Unable to update Pastebin.')
    pastebinStatus.textContent = response.deletionFailures
      ? 'Updated, but Pastebin could not remove every older copy.'
      : 'Pastebin updated.'
    await loadPastebinState()
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
