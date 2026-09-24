(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome
  let timer
  let lastSentUrl = ''
  let githubPrompt
  let syncedDocumentName = ''
  let actionsDocumentNameInput
  let refreshActionsSaveButton = () => {}
  let documentArticle
  let documentIsDirty = false
  let autoSaveTimer
  let autoSaveInFlight = false
  let toastHost
  let toastTimer
  let lastGistSaveAt = 0
  let remotePollTimer
  let nextRemotePollAt = 0
  let extensionDetached = false
  const DETACHED_MESSAGE = 'Textarea Sync was updated. Reload this page to keep syncing.'
  const AUTO_SAVE_DELAY = 3000
  const MIN_AUTO_SAVE_INTERVAL = 30000
  const REMOTE_POLL_INTERVAL = 30000
  const INDENT = '  '

  // Reloading or updating the extension orphans this script, and every later
  // sendMessage throws synchronously. Stop the timers and ask for a reload.
  function detachFromExtension() {
    if (extensionDetached) return
    extensionDetached = true
    clearTimeout(timer)
    clearTimeout(autoSaveTimer)
    clearInterval(remotePollTimer)
    showToast(DETACHED_MESSAGE)
  }

  function isDetachedError(error) {
    if (!extensionApi?.runtime?.id) return true
    return /Extension context invalidated|Receiving end does not exist/i
      .test(String(error?.message || error))
  }

  function sendMessage(message) {
    if (extensionDetached) return Promise.reject(new Error(DETACHED_MESSAGE))
    try {
      return Promise.resolve(extensionApi.runtime.sendMessage(message)).catch(error => {
        if (isDetachedError(error)) detachFromExtension()
        throw error
      })
    } catch (error) {
      if (isDetachedError(error)) detachFromExtension()
      return Promise.reject(new Error(extensionDetached ? DETACHED_MESSAGE : error.message))
    }
  }

  function applySyncedDocumentTitle() {
    const title = documentIsDirty ? `* ${syncedDocumentName}` : syncedDocumentName
    if (title && document.title !== title) {
      document.title = title
    }
  }

  function setDocumentDirty(dirty) {
    documentIsDirty = Boolean(dirty && syncedDocumentName)
    applySyncedDocumentTitle()
    refreshActionsSaveButton()
  }

  function showToast(message) {
    if (!toastHost) {
      toastHost = document.createElement('div')
      const shadow = toastHost.attachShadow({mode: 'closed'})
      const style = document.createElement('style')
      style.textContent = `
        :host {
          all: initial;
          bottom: max(12px, env(safe-area-inset-bottom));
          left: max(12px, env(safe-area-inset-left));
          position: fixed;
          z-index: 2147483647;
        }
        p {
          background: rgba(38, 38, 38, .94);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, .22);
          color: #fff;
          font: 600 12px/1.3 system-ui, sans-serif;
          margin: 0;
          opacity: 1;
          padding: 8px 12px;
          transition: opacity .3s ease;
        }
        p[data-hidden="true"] { opacity: 0; }
      `
      const text = document.createElement('p')
      text.setAttribute('role', 'status')
      text.setAttribute('aria-live', 'polite')
      shadow.append(style, text)
      toastHost.__text = text
      document.documentElement.append(toastHost)
    }
    const text = toastHost.__text
    text.textContent = message
    text.dataset.hidden = 'false'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { text.dataset.hidden = 'true' }, 2500)
  }

  async function autoSaveDocument() {
    if (extensionDetached || autoSaveInFlight || !documentIsDirty || !syncedDocumentName) return
    if (!location.hash || location.hash === '#new') return

    autoSaveInFlight = true
    try {
      const localResponse = await sendMessage({
        type: 'save-current',
        url: location.href,
        title: syncedDocumentName,
      })
      if (!localResponse?.ok) {
        throw new Error(localResponse?.error || 'Unable to capture the current document.')
      }
      const response = await sendMessage({
        type: 'sync-gist',
        documentName: syncedDocumentName,
      })
      if (!response?.ok) throw new Error(response?.error || 'Unable to save the document.')
      syncedDocumentName = response.documentName
      if (actionsDocumentNameInput && !actionsDocumentNameInput.matches(':focus')) {
        actionsDocumentNameInput.value = syncedDocumentName
      }
      lastGistSaveAt = Date.now()
      setDocumentDirty(false)
      showToast(`Saved ${syncedDocumentName}`)
    } catch (error) {
      showToast(error.message)
    } finally {
      autoSaveInFlight = false
    }
  }

  async function pollRemoteDocument() {
    if (extensionDetached || !syncedDocumentName || documentIsDirty ||
        autoSaveInFlight || document.hidden) return

    const response = await sendMessage({
      type: 'refresh-gist-document',
      documentName: syncedDocumentName,
    })
    if (!response?.ok || !response.document) return
    // The document may have been edited or saved while the Gist was being read.
    if (documentIsDirty || autoSaveInFlight) return
    const remoteDocument = response.document
    if (remoteDocument.updatedByDeviceId === response.deviceId) return
    if (remoteDocument.url === location.href) return

    showToast(`Loaded newer ${remoteDocument.name} from another device`)
    goToDocument(remoteDocument.url, {replace: true})
    return true
  }

  // Restarting the interval lets a manual check reset the countdown.

  function startRemotePolling() {
    clearInterval(remotePollTimer)
    nextRemotePollAt = Date.now() + REMOTE_POLL_INTERVAL
    remotePollTimer = setInterval(() => {
      nextRemotePollAt = Date.now() + REMOTE_POLL_INTERVAL
      pollRemoteDocumentQuietly()
    }, REMOTE_POLL_INTERVAL)
  }

  // textarea.my keeps the whole document in the URL hash, so pointing the
  // browser at another one only fires hashchange and the old text stays on
  // screen. Reload whenever the path is unchanged so the switch takes effect.
  function goToDocument(url, {replace = false} = {}) {
    const samePage = url.split('#')[0] === location.href.split('#')[0]
    if (replace) location.replace(url)
    else location.assign(url)
    if (samePage) location.reload()
  }

  function pollRemoteDocumentQuietly() {
    pollRemoteDocument().catch(() => {
      // The Gist may be unreachable, or the extension reloaded; retry on the next poll.
    })
  }

  function scheduleAutoSave() {
    if (extensionDetached || !syncedDocumentName) return
    const sinceLastSave = Date.now() - lastGistSaveAt
    const delay = Math.max(AUTO_SAVE_DELAY, MIN_AUTO_SAVE_INTERVAL - sinceLastSave)
    clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      autoSaveDocument().catch(() => {
        // Autosave failures are surfaced through the toast.
      })
    }, delay)
  }

  function loadSyncedDocumentTitle() {
    return sendMessage({
      type: 'get-gist-document-title',
      url: location.href,
    }).then(response => {
      if (response?.ok && response.name) {
        if (syncedDocumentName && response.name !== syncedDocumentName) {
          documentIsDirty = false
        }
        syncedDocumentName = response.name
        if (actionsDocumentNameInput && !actionsDocumentNameInput.matches(':focus')) {
          actionsDocumentNameInput.value = syncedDocumentName
        }
        applySyncedDocumentTitle()
        refreshActionsSaveButton()
      }
    }).catch(() => {
      // The extension may have been reloaded while this tab stayed open.
    })
  }

  function openExtensionSettings(button, onError) {
    button.disabled = true
    sendMessage({type: 'open-sync-setup'})
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Unable to open extension settings.')
      })
      .catch(onError)
      .finally(() => { button.disabled = false })
  }

  async function saveCurrentDocument(button, status, requestedName = syncedDocumentName) {
    if (!location.hash || location.hash === '#new') {
      throw new Error('Start typing in the new document before saving it.')
    }

    button.disabled = true
    status.textContent = 'Saving…'
    try {
      const localResponse = await sendMessage({
        type: 'save-current',
        url: location.href,
        title: requestedName || syncedDocumentName || document.title,
      })
      if (!localResponse?.ok) {
        throw new Error(localResponse?.error || 'Unable to capture the current document.')
      }
      const response = await sendMessage({
        type: 'sync-gist',
        documentName: requestedName,
      })
      if (!response?.ok) throw new Error(response?.error || 'Unable to save the document.')
      syncedDocumentName = response.documentName
      if (actionsDocumentNameInput) actionsDocumentNameInput.value = syncedDocumentName
      lastGistSaveAt = Date.now()
      setDocumentDirty(false)
      status.textContent = 'Saved.'
    } finally {
      button.disabled = false
      refreshActionsSaveButton()
    }
  }

  function createExternalLinkIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '12')
    svg.setAttribute('height', '12')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.6')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    const frame = document.createElementNS(svg.namespaceURI, 'path')
    frame.setAttribute('d', 'M9.5 2.5H13.5V6.5M13.5 2.5L7.5 8.5')
    const box = document.createElementNS(svg.namespaceURI, 'path')
    box.setAttribute('d', 'M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3')
    svg.append(frame, box)
    return svg
  }

  function createMenuIcon(pathData) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '22')
    svg.setAttribute('height', '22')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.25')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of pathData) {
      const path = document.createElementNS(svg.namespaceURI, 'path')
      path.setAttribute('d', d)
      svg.append(path)
    }
    return svg
  }

  // Adds the extension's actions to the bottom of textarea.my's own menu.
  // Items reuse the page's `.item` class so they follow its theme.

  function showActionsMenu() {
    const menu = document.querySelector('#menu')
    const menuButton = document.querySelector('#button')
    if (!menu || !menuButton) return

    const style = document.createElement('style')
    style.textContent = `
      #menu {
        --ts-top: #f7f4ee;
        --ts-bottom: #e4ded2;
        --ts-edge: #b7ae9e;
        --ts-highlight: rgba(255, 255, 255, .85);
        --ts-shade: rgba(60, 45, 20, .18);
        --ts-well: #fbfaf7;
        --ts-ink: #2e2a24;
        background: linear-gradient(180deg, var(--ts-top), var(--ts-bottom));
        border: 1px solid var(--ts-edge);
        box-shadow:
          inset 0 1px 0 var(--ts-highlight),
          0 1px 0 rgba(0, 0, 0, .08),
          0 14px 34px rgba(0, 0, 0, .32),
          0 3px 8px rgba(0, 0, 0, .18);
        gap: 4px;
        padding: 6px;
        width: min(calc(100vw - 32px), max(180px, 30vw));
      }
      @media (prefers-color-scheme: dark) {
        #menu {
          --ts-top: #3a3834;
          --ts-bottom: #25231f;
          --ts-edge: #0d0c0a;
          --ts-highlight: rgba(255, 255, 255, .12);
          --ts-shade: rgba(0, 0, 0, .45);
          --ts-well: #1a1916;
          --ts-ink: #ece6da;
        }
      }
      #menu .item,
      #menu .item:first-child,
      #menu .item:last-child {
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--ts-top) 70%, white 30%), var(--ts-top));
        border: 1px solid color-mix(in srgb, var(--ts-edge) 70%, transparent);
        border-radius: 7px;
        box-shadow: inset 0 1px 0 var(--ts-highlight), 0 1px 2px var(--ts-shade);
        color: var(--ts-ink);
        text-shadow: 0 1px 0 var(--ts-highlight);
      }
      @media (prefers-color-scheme: dark) {
        #menu .item,
        #menu .item:first-child,
        #menu .item:last-child {
          background: linear-gradient(180deg, #45423d, #312f2a);
          text-shadow: 0 -1px 0 rgba(0, 0, 0, .6);
        }
      }
      #menu .item:hover,
      #menu .ts-section .item:hover {
        background: linear-gradient(180deg,
          color-mix(in srgb, var(--ts-top) 50%, white 50%), var(--ts-top));
      }
      @media (prefers-color-scheme: dark) {
        #menu .item:hover,
        #menu .ts-section .item:hover { background: linear-gradient(180deg, #524e48, #3a3732); }
      }
      #menu .item:active,
      #menu .ts-section .item:active {
        background: var(--ts-bottom);
        box-shadow: inset 0 2px 4px var(--ts-shade);
        transform: translateY(1px);
      }
      #menu .ts-section {
        border-top: 1px solid var(--ts-shade);
        box-shadow: inset 0 1px 0 var(--ts-highlight);
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 4px;
        padding-top: 8px;
      }
      #menu .ts-section .item { width: 100%; }
      #menu .ts-section .item:disabled { cursor: default; opacity: .5; }
      #menu .ts-section .item:disabled,
      #menu .ts-section .item:disabled:hover {
        background: var(--ts-bottom);
        box-shadow: none;
        transform: none;
      }
      #menu .ts-section .item:focus-visible { outline: 2px solid var(--outline); }
      #menu .ts-name {
        background: transparent;
        background: var(--ts-well);
        border: 1px solid var(--ts-edge);
        border-radius: 6px;
        box-shadow: inset 0 2px 3px var(--ts-shade), 0 1px 0 var(--ts-highlight);
        box-sizing: border-box;
        color: var(--ts-ink);
        font: 14px / 1.4 system-ui;
        margin: 4px 0;
        padding: 7px 9px;
        width: 100%;
      }
      #menu .ts-name:focus { outline: 2px solid var(--outline); outline-offset: -1px; }
      #menu .ts-status {
        font: 13px / 1.4 system-ui;
        color: var(--ts-ink);
        margin: 0 4px 2px;
        opacity: .75;
      }
      #menu .ts-status:empty { display: none; }
      #menu .ts-heading {
        font: 600 11px / 1.2 system-ui;
        letter-spacing: .04em;
        color: var(--ts-ink);
        margin: 6px 4px 0;
        opacity: .6;
        text-shadow: 0 1px 0 var(--ts-highlight);
        text-transform: uppercase;
      }
      #menu .ts-recent[hidden] { display: none; }
      #menu .ts-recent-row { display: flex; gap: 4px; }
      #menu .ts-recent { display: flex; flex-direction: column; gap: 4px; }
      #menu .ts-recent > div { display: flex; flex-direction: column; gap: 4px; }
      #menu .ts-recent-row .ts-recent-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
      #menu .ts-recent-row .ts-recent-open {
        flex: none;
        justify-content: center;
        opacity: .7;
        padding: 10px;
        width: auto;
      }
    `
    document.head.append(style)

    const section = document.createElement('div')
    section.className = 'ts-section'

    const nameInput = document.createElement('input')
    nameInput.className = 'ts-name'
    nameInput.type = 'text'
    nameInput.maxLength = 100
    nameInput.placeholder = 'Document name'
    nameInput.setAttribute('aria-label', 'Document name')
    nameInput.value = syncedDocumentName
    actionsDocumentNameInput = nameInput

    const saveButton = document.createElement('button')
    saveButton.className = 'item'
    saveButton.type = 'button'
    saveButton.setAttribute('role', 'menuitem')
    saveButton.append(createMenuIcon([
      'M6 4h10l4 4v12a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-15a1 1 0 0 1 1 -1',
      'M12 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M9 4l0 5l6 0l0 -5',
    ]), 'Save to gist')

    // Saving is only worth offering when it would change something: unsaved
    // edits, a document that has never been named, or a pending rename.

    refreshActionsSaveButton = () => {
      const renaming = nameInput.value.trim() !== syncedDocumentName
      const saveable = documentIsDirty || !syncedDocumentName || renaming
      saveButton.disabled = !saveable
      saveButton.title = saveable ? '' : 'No changes since the last save'
      refreshUpdateButton()
    }
    nameInput.addEventListener('input', refreshActionsSaveButton)

    const settingsButton = document.createElement('button')
    settingsButton.className = 'item'
    settingsButton.type = 'button'
    settingsButton.setAttribute('role', 'menuitem')
    settingsButton.append(createMenuIcon([
      'M10.3 4.3c.4 -1.8 3 -1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.5 -.9 3.3 .8 2.4 2.4a1.7 1.7 0 0 0 1 2.5c1.8 .4 1.8 3 0 3.4a1.7 1.7 0 0 0 -1 2.6c.9 1.5 -.9 3.3 -2.4 2.4a1.7 1.7 0 0 0 -2.6 1c-.4 1.8 -3 1.8 -3.4 0a1.7 1.7 0 0 0 -2.5 -1c-1.6 .9 -3.3 -.9 -2.4 -2.4a1.7 1.7 0 0 0 -1.1 -2.6c-1.8 -.4 -1.8 -3 0 -3.4a1.7 1.7 0 0 0 1.1 -2.5c-.9 -1.6 .8 -3.3 2.4 -2.4c1 .6 2.3 .1 2.5 -1.1',
      'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
    ]), 'Sync settings')

    const updateButton = document.createElement('button')
    updateButton.className = 'item'
    updateButton.type = 'button'
    updateButton.setAttribute('role', 'menuitem')
    const updateLabel = document.createElement('span')
    updateButton.append(createMenuIcon([
      'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4',
      'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4',
    ]), updateLabel)
    let checkingForUpdates = false

    function refreshUpdateButton() {
      const seconds = Math.max(0, Math.ceil((nextRemotePollAt - Date.now()) / 1000))
      updateLabel.textContent = checkingForUpdates
        ? 'Checking…'
        : `Check for updates (${seconds}s)`
      updateButton.disabled = checkingForUpdates || documentIsDirty || !syncedDocumentName
      updateButton.title = documentIsDirty ? 'Save or discard changes first' : ''
    }

    refreshActionsSaveButton()

    const status = document.createElement('p')
    status.className = 'ts-status'
    status.setAttribute('aria-live', 'polite')

    const recentDocumentsSection = document.createElement('div')
    recentDocumentsSection.className = 'ts-recent'
    recentDocumentsSection.hidden = true
    const recentHeading = document.createElement('p')
    recentHeading.className = 'ts-heading'
    recentHeading.textContent = 'Recent documents'
    const recentDocuments = document.createElement('div')
    recentDocumentsSection.append(recentHeading, recentDocuments)

    section.append(nameInput, status, saveButton, updateButton, settingsButton, recentDocumentsSection)
    menu.append(section)

    function closeMenu() {
      menu.classList.remove('visible')
    }

    async function loadRecentDocuments() {
      const response = await sendMessage({
        type: 'get-recent-gist-documents',
      })
      if (!response?.ok) {
        recentDocumentsSection.hidden = true
        return
      }
      const documents = response.documents.filter(candidate => (
        candidate.name.toLocaleLowerCase() !== syncedDocumentName.toLocaleLowerCase()
      ))
      recentDocuments.replaceChildren()
      for (const recentDocument of documents) {
        const row = document.createElement('div')
        row.className = 'ts-recent-row'
        const button = document.createElement('button')
        button.className = 'item ts-recent-name'
        button.type = 'button'
        button.setAttribute('role', 'menuitem')
        button.textContent = recentDocument.name
        button.title = `Switch to ${recentDocument.name}`
        const openButton = document.createElement('button')
        openButton.className = 'item ts-recent-open'
        openButton.type = 'button'
        openButton.title = `Open ${recentDocument.name} in a new tab`
        openButton.setAttribute('aria-label', openButton.title)
        openButton.append(createExternalLinkIcon())
        openButton.addEventListener('click', () => {
          closeMenu()
          open(recentDocument.url, '_blank', 'noopener')
        })
        button.addEventListener('click', async () => {
          if (documentIsDirty &&
              !confirm('This document has unsaved changes. Switch documents?')) {
            return
          }
          button.disabled = true
          status.textContent = 'Switching…'
          const selectResponse = await sendMessage({
            type: 'select-gist-document',
            documentName: recentDocument.name,
          })
          if (!selectResponse?.ok) {
            button.disabled = false
            status.textContent = selectResponse?.error || 'Unable to switch documents.'
            return
          }
          goToDocument(recentDocument.url)
        })
        row.append(button, openButton)
        recentDocuments.append(row)
      }
      recentDocumentsSection.hidden = documents.length === 0
    }

    menuButton.addEventListener('click', () => {
      refreshActionsSaveButton()
      if (menu.classList.contains('visible')) {
        loadRecentDocuments().catch(() => {
          recentDocumentsSection.hidden = true
        })
      }
    })
    function saveFromMenu() {
      saveCurrentDocument(saveButton, status, nameInput.value.trim()).catch(error => {
        status.textContent = error.message
      })
    }
    saveButton.addEventListener('click', saveFromMenu)
    updateButton.addEventListener('click', async () => {
      checkingForUpdates = true
      refreshUpdateButton()
      startRemotePolling()
      try {
        const loaded = await pollRemoteDocument()
        if (!loaded) status.textContent = 'Already up to date.'
      } catch (error) {
        status.textContent = error.message
      } finally {
        checkingForUpdates = false
        refreshUpdateButton()
      }
    })
    setInterval(() => {
      if (menu.classList.contains('visible')) refreshUpdateButton()
    }, 1000)
    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        saveFromMenu()
      }
    })
    settingsButton.addEventListener('click', () => {
      closeMenu()
      openExtensionSettings(settingsButton, error => {
        status.textContent = error.message
        menu.classList.add('visible')
      })
    })
  }

  function hideGitHubPrompt() {
    githubPrompt?.remove()
    githubPrompt = null
  }

  function showGitHubPrompt() {
    if (githubPrompt) return

    const host = document.createElement('div')
    const shadow = host.attachShadow({mode: 'closed'})
    const style = document.createElement('style')
    style.textContent = `
      :host {
        all: initial;
        bottom: max(12px, env(safe-area-inset-bottom));
        position: fixed;
        right: max(12px, env(safe-area-inset-right));
        width: min(300px, calc(100vw - 24px));
        z-index: 2147483647;
      }
      aside {
        background: #fff;
        border: 1px solid rgba(0, 0, 0, .18);
        border-radius: 10px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, .18);
        color: #242424;
        font: 14px/1.4 system-ui, sans-serif;
        padding: 14px;
      }
      strong { display: block; font-size: 15px; margin-bottom: 4px; }
      p { margin: 0 0 12px; }
      div { display: flex; gap: 8px; }
      button {
        appearance: none;
        border: 0;
        border-radius: 7px;
        cursor: pointer;
        font: 600 13px/1.2 system-ui, sans-serif;
        min-height: 36px;
        padding: 8px 11px;
      }
      button:first-child { background: #0569fa; color: #fff; }
      button:last-child { background: transparent; color: #555; }
      button:disabled { cursor: default; opacity: .6; }
      button:focus-visible { outline: 2px solid #0569fa; outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        aside {
          background: #292929;
          border-color: rgba(255, 255, 255, .2);
          color: #eee;
        }
        button:last-child { color: #ccc; }
      }
    `
    const panel = document.createElement('aside')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Connect GitHub')
    const heading = document.createElement('strong')
    heading.textContent = 'Connect GitHub'
    const description = document.createElement('p')
    description.textContent = 'Add a GitHub token with Gist access to sync this textarea across browsers.'
    const actions = document.createElement('div')
    const setupButton = document.createElement('button')
    setupButton.type = 'button'
    setupButton.textContent = 'Set up GitHub'
    const dismissButton = document.createElement('button')
    dismissButton.type = 'button'
    dismissButton.textContent = 'Not now'
    actions.append(setupButton, dismissButton)
    panel.append(heading, description, actions)
    shadow.append(style, panel)
    document.documentElement.append(host)
    githubPrompt = host

    setupButton.addEventListener('click', () => {
      openExtensionSettings(setupButton, error => { description.textContent = error.message })
    })
    dismissButton.addEventListener('click', hideGitHubPrompt)
  }

  function checkGitHubConnection() {
    sendMessage({type: 'get-github-connection'})
      .then(response => {
        if (response?.ok && !response.connected) showGitHubPrompt()
      })
      .catch(() => {
        // The extension may have been reloaded while this tab stayed open.
      })
  }

  function sendCurrentUrl() {
    const url = location.href
    if (!location.hash || location.hash === '#new' || url === lastSentUrl) return
    lastSentUrl = url
    sendMessage({
      type: 'save-current',
      url,
      title: syncedDocumentName || document.title,
    })
      .then(response => {
        if (!response?.ok) lastSentUrl = ''
      })
      .catch(() => {
        // The extension may have been reloaded while this tab stayed open.
        lastSentUrl = ''
      })
  }

  function scheduleSave(delay = 1500) {
    if (extensionDetached) return
    clearTimeout(timer)
    timer = setTimeout(sendCurrentUrl, delay)
  }

  addEventListener('pageshow', () => {
    loadSyncedDocumentTitle()
    scheduleSave(0)
  })
  addEventListener('hashchange', () => {
    loadSyncedDocumentTitle()
    scheduleSave(0)
  })
  addEventListener('popstate', () => {
    loadSyncedDocumentTitle()
    scheduleSave(0)
  })
  // The page's contenteditable article lets Tab move focus out of the editor.
  // Keep Tab in the document and spend it on indentation instead. execCommand
  // is the only edit that keeps the browser's native undo stack intact.
  function handleIndentKey(event) {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    if (!documentArticle?.contains(event.target)) return
    const selection = getSelection()
    if (!selection?.rangeCount) return
    event.preventDefault()
    if (event.shiftKey) {
      outdentAtCaret(selection)
      return
    }
    document.execCommand('insertText', false, INDENT)
  }

  // Shift+Tab eats one indent worth of whitespace immediately before the caret.
  function outdentAtCaret(selection) {
    const range = selection.getRangeAt(0)
    if (!range.collapsed) return
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const before = node.textContent.slice(0, range.startOffset)
    const match = new RegExp(`(?:\t| {1,${INDENT.length}})$`).exec(before)
    if (!match) return
    const doomed = document.createRange()
    doomed.setStart(node, range.startOffset - match[0].length)
    doomed.setEnd(node, range.startOffset)
    selection.removeAllRanges()
    selection.addRange(doomed)
    document.execCommand('delete')
  }

  addEventListener('keydown', handleIndentKey, true)

  addEventListener('input', event => {
    scheduleSave()
    if (documentArticle?.contains(event.target)) setDocumentDirty(true)
    scheduleAutoSave()
  }, true)

  addEventListener('beforeunload', event => {
    if (!documentIsDirty || !syncedDocumentName) return
    event.preventDefault()
    event.returnValue = ''
  })

  addEventListener('DOMContentLoaded', () => {
    showActionsMenu()
    loadSyncedDocumentTitle()
    new MutationObserver(applySyncedDocumentTitle).observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    documentArticle = document.querySelector('article')
    if (documentArticle) {
      new MutationObserver(() => {
        scheduleSave()
        scheduleAutoSave()
      }).observe(documentArticle, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        characterData: true,
        subtree: true,
      })
    }
    checkGitHubConnection()
    scheduleSave(0)
    startRemotePolling()
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollRemoteDocumentQuietly()
    })
  })

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.githubCredentials?.newValue) {
      hideGitHubPrompt()
    }
    if (areaName === 'local' && changes.gistDocuments?.newValue) {
      loadSyncedDocumentTitle()
    }
    const savedDocument = changes.gistLastSavedDocument?.newValue
    if (areaName === 'local' && savedDocument?.url === location.href &&
        savedDocument.name === syncedDocumentName) {
      setDocumentDirty(false)
    }
  })
})()
