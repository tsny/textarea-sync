const extensionApi = globalThis.browser ?? globalThis.chrome
const {captureGitHubCredentials} = globalThis.TextareaPopupForm
const status = document.querySelector('#status')
const details = document.querySelector('#details')
const openButton = document.querySelector('#open')
const gistStatus = document.querySelector('#gist-status')
const githubForm = document.querySelector('#github-form')
const githubConnected = document.querySelector('#github-connected')
const githubAccount = document.querySelector('#github-account')
const gistNew = document.querySelector('#gist-new')
const gistOpen = document.querySelector('#gist-open')
const githubDisconnect = document.querySelector('#github-disconnect')
const gistDocuments = document.querySelector('#gist-documents')
const gistDocumentsHeading = document.querySelector('#gist-documents-heading')
const gistDocumentsEmpty = document.querySelector('#gist-documents-empty')
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
  gistNew.disabled = busy
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

const TRASH_ICON_PATH = 'M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5M6.8 7.4v3.2M9.2 7.4v3.2'

function createTrashIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  path.setAttribute('d', TRASH_ICON_PATH)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.3')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

function setDocumentsBusy(busy) {
  for (const button of gistDocuments.querySelectorAll('button')) button.disabled = busy
}

async function deleteDocument(name) {
  if (!window.confirm(`Delete "${name}" from the sync Gist?`)) return
  setDocumentsBusy(true)
  gistStatus.textContent = `Deleting ${name}…`
  try {
    const response = await extensionApi.runtime.sendMessage({
      type: 'delete-gist-document',
      documentName: name,
    })
    if (!response?.ok) throw new Error(response?.error || 'Unable to delete the document.')
    gistUrl = response.gistUrl
    gistOpen.hidden = !gistUrl
    renderDocuments(response.documents)
    gistStatus.textContent = `Deleted ${name}.`
  } catch (error) {
    gistStatus.textContent = error.message
    setDocumentsBusy(false)
  }
}

function renderDocuments(documents = []) {
  gistDocuments.replaceChildren()
  gistDocumentsHeading.hidden = documents.length === 0
  gistDocumentsEmpty.hidden = documents.length > 0
  for (const syncedDocument of documents) {
    const item = document.createElement('li')
    const button = document.createElement('button')
    const deleteButton = document.createElement('button')
    const name = document.createElement('span')
    const updated = document.createElement('span')
    button.type = 'button'
    button.className = 'document-list-select'
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
    deleteButton.type = 'button'
    deleteButton.className = 'document-list-delete'
    deleteButton.title = `Delete ${syncedDocument.name}`
    deleteButton.setAttribute('aria-label', `Delete ${syncedDocument.name}`)
    deleteButton.append(createTrashIcon())
    deleteButton.addEventListener('click', () => deleteDocument(syncedDocument.name))
    button.append(name, updated)
    item.append(button, deleteButton)
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
  gistStatus.textContent = state.error || 'Documents are saved from the Actions menu on textarea.my.'
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

gistNew.addEventListener('click', () => {
  extensionApi.tabs.create({url: 'https://textarea.my/#new'})
  window.close()
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
