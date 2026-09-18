const extensionApi = globalThis.browser ?? globalThis.chrome
const {captureGitHubCredentials} = globalThis.TextareaPopupForm
const status = document.querySelector('#status')
const details = document.querySelector('#details')
const openButton = document.querySelector('#open')
const gistStatus = document.querySelector('#gist-status')
const githubForm = document.querySelector('#github-form')
const githubConnected = document.querySelector('#github-connected')
const githubAccount = document.querySelector('#github-account')
const gistDocumentName = document.querySelector('#gist-document-name')
const gistSave = document.querySelector('#gist-save')
const gistNew = document.querySelector('#gist-new')
const gistOpen = document.querySelector('#gist-open')
const githubDisconnect = document.querySelector('#github-disconnect')
const gistDocuments = document.querySelector('#gist-documents')
const gistDocumentsHeading = document.querySelector('#gist-documents-heading')
const githubTokenHelp = document.querySelector('#github-token-help')
let latest = null
let gistUrl = null

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

function setGitHubBusy(busy) {
  for (const element of githubForm.elements) element.disabled = busy
  gistSave.disabled = busy
  gistNew.disabled = busy
  gistDocumentName.disabled = busy
  githubDisconnect.disabled = busy
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
  gistDocuments.replaceChildren()
  gistDocumentsHeading.hidden = documents.length === 0
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
        type: 'select-gist-document',
        documentName: syncedDocument.name,
      })
      if (response?.ok) {
        extensionApi.tabs.create({url: syncedDocument.url})
        window.close()
      } else {
        gistStatus.textContent = response?.error || 'Unable to select the document.'
      }
    })
    button.append(name, updated)
    item.append(button)
    gistDocuments.append(item)
  }
}

function showGistState(state) {
  githubForm.hidden = state.connected
  githubConnected.hidden = !state.connected
  if (!state.connected) {
    gistStatus.textContent = 'Connect GitHub to sync documents across devices.'
    gistUrl = null
    return
  }
  githubAccount.textContent = `Connected as ${state.username}`
  gistDocumentName.value = state.documentName
  gistStatus.textContent = state.error || 'Ready. Changes are shared when you choose Save.'
  gistUrl = state.gistUrl
  gistOpen.hidden = !gistUrl
  renderDocuments(state.documents)
}

async function loadGistState({cached = false} = {}) {
  const response = await extensionApi.runtime.sendMessage({type: 'get-gist-state', cached})
  if (!response?.ok) throw new Error(response?.error || 'Unable to check GitHub.')
  showGistState(response)
  return response
}

// Show what we already have, then pull the gist so the list is current.
async function loadAndRefreshGistState() {
  const cachedState = await loadGistState({cached: true})
  if (cachedState.connected) gistStatus.textContent = 'Refreshing documents…'
  await loadGistState()
}

githubForm.addEventListener('submit', async event => {
  event.preventDefault()
  const credentials = captureGitHubCredentials(githubForm, setGitHubBusy)
  gistStatus.textContent = 'Connecting to GitHub…'
  try {
    const response = await extensionApi.runtime.sendMessage({
      type: 'connect-github',
      ...credentials,
    })
    if (!response?.ok) throw new Error(response?.error || 'Unable to connect GitHub.')
    githubForm.reset()
    await loadGistState()
  } catch (error) {
    gistStatus.textContent = error.message
  } finally {
    setGitHubBusy(false)
  }
})

async function saveCurrentDocument() {
  gistStatus.textContent = 'Saving document…'
  const response = await extensionApi.runtime.sendMessage({
    type: 'sync-gist',
    documentName: gistDocumentName.value,
  })
  if (!response?.ok) throw new Error(response?.error || 'Unable to save the document.')
  gistDocumentName.value = response.documentName
  gistStatus.textContent = 'Document saved.'
  gistUrl = response.gistUrl
  gistOpen.hidden = !gistUrl
  renderDocuments(response.documents)
  return response
}

gistSave.addEventListener('click', async () => {
  setGitHubBusy(true)
  try {
    await saveCurrentDocument()
  } catch (error) {
    gistStatus.textContent = error.message
  } finally {
    setGitHubBusy(false)
  }
})

gistNew.addEventListener('click', async () => {
  setGitHubBusy(true)
  try {
    await saveCurrentDocument()
    const response = await extensionApi.runtime.sendMessage({type: 'start-new-gist-document'})
    if (!response?.ok) throw new Error(response?.error || 'Unable to start a new document.')
    await extensionApi.tabs.create({url: 'https://textarea.my/#new'})
    window.close()
  } catch (error) {
    gistStatus.textContent = error.message
    setGitHubBusy(false)
  }
})

gistOpen.addEventListener('click', () => {
  if (gistUrl) extensionApi.tabs.create({url: gistUrl})
  window.close()
})

githubDisconnect.addEventListener('click', async () => {
  setGitHubBusy(true)
  const response = await extensionApi.runtime.sendMessage({type: 'disconnect-github'})
  setGitHubBusy(false)
  if (!response?.ok) {
    gistStatus.textContent = response?.error || 'Unable to disconnect GitHub.'
    return
  }
  showGistState({connected: false})
})

githubTokenHelp.addEventListener('click', () => {
  extensionApi.tabs.create({
    url: 'https://github.com/settings/tokens/new?scopes=gist&description=Textarea%20Sync',
  })
  window.close()
})

loadAndRefreshGistState().catch(error => {
  gistStatus.textContent = error.message
  githubForm.hidden = false
})
