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

  function showActionsMenu() {
    const host = document.createElement('div')
    const shadow = host.attachShadow({mode: 'closed'})
    const style = document.createElement('style')
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        right: max(8px, env(safe-area-inset-right));
        top: max(8px, env(safe-area-inset-top));
        z-index: 2147483647;
      }
      .trigger {
        appearance: none;
        background: rgba(248, 248, 248, .94);
        border: 1px solid rgba(0, 0, 0, .2);
        border-radius: 999px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, .12);
        color: #3b3b3b;
        cursor: pointer;
        font: 600 11px/1.2 system-ui, sans-serif;
        min-height: 32px;
        padding: 6px 10px;
      }
      .trigger:hover { background: #fff; }
      .menu {
        background: rgba(248, 248, 248, .98);
        border: 1px solid rgba(0, 0, 0, .2);
        border-radius: 9px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
        box-sizing: border-box;
        margin-top: 6px;
        padding: 5px;
        position: absolute;
        right: 0;
        width: 210px;
      }
      .menu[hidden] { display: none; }
      .menu button {
        appearance: none;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: #3b3b3b;
        cursor: pointer;
        display: block;
        font: 600 12px/1.2 system-ui, sans-serif;
        min-height: 36px;
        padding: 8px 9px;
        text-align: left;
        width: 100%;
      }
      .menu button:hover { background: rgba(0, 0, 0, .07); }
      label {
        color: #555;
        display: block;
        font: 600 11px/1.2 system-ui, sans-serif;
        padding: 5px 9px 3px;
      }
      input {
        background: #fff;
        border: 1px solid rgba(0, 0, 0, .25);
        border-radius: 5px;
        box-sizing: border-box;
        color: #222;
        display: block;
        font: 12px/1.2 system-ui, sans-serif;
        margin: 0 5px 5px;
        min-height: 34px;
        padding: 7px 8px;
        width: calc(100% - 10px);
      }
      .status {
        color: #666;
        font: 11px/1.3 system-ui, sans-serif;
        margin: 3px 9px 5px;
      }
      .status:empty { display: none; }
      .recent-documents {
        border-top: 1px solid rgba(0, 0, 0, .14);
        margin-top: 5px;
        padding-top: 5px;
      }
      .recent-documents[hidden] { display: none; }
      .recent-heading {
        color: #666;
        font: 600 10px/1.2 system-ui, sans-serif;
        margin: 4px 9px 3px;
        text-transform: uppercase;
      }
      .recent-row { display: flex; gap: 2px; }
      .recent-row .recent-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .recent-row .recent-open {
        align-items: center;
        color: #666;
        display: flex;
        flex: none;
        justify-content: center;
        padding: 8px;
        width: auto;
      }
      .recent-row .recent-open svg { display: block; }
      button:disabled { cursor: default; opacity: .6; }
      button:focus-visible { outline: 2px solid #0569fa; outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        .trigger {
          background: rgba(42, 42, 42, .94);
          border-color: rgba(255, 255, 255, .25);
          color: #e8e8e8;
        }
        .trigger:hover { background: #333; }
        .menu {
          background: rgba(42, 42, 42, .98);
          border-color: rgba(255, 255, 255, .25);
        }
        .menu button { color: #e8e8e8; }
        .menu button:hover { background: rgba(255, 255, 255, .1); }
        label { color: #bbb; }
        input {
          background: #252525;
          border-color: rgba(255, 255, 255, .25);
          color: #eee;
        }
        .status { color: #bbb; }
        .recent-documents { border-top-color: rgba(255, 255, 255, .16); }
        .recent-heading { color: #aaa; }
        .recent-row .recent-open { color: #bbb; }
      }
    `
    const trigger = document.createElement('button')
    trigger.className = 'trigger'
    trigger.type = 'button'
    trigger.textContent = 'Actions ▾'
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-haspopup', 'dialog')
    const menu = document.createElement('div')
    menu.className = 'menu'
    menu.hidden = true
    menu.setAttribute('role', 'dialog')
    menu.setAttribute('aria-label', 'Textarea Sync actions')
    const nameLabel = document.createElement('label')
    nameLabel.textContent = 'Document name'
    const nameInput = document.createElement('input')
    nameInput.type = 'text'
    nameInput.maxLength = 100
    nameInput.placeholder = 'Generated if blank'
    nameInput.value = syncedDocumentName
    nameLabel.append(nameInput)
    actionsDocumentNameInput = nameInput
    const saveButton = document.createElement('button')
    saveButton.type = 'button'
    saveButton.textContent = 'Save current document'
    // Saving is only worth offering when it would change something: unsaved
    // edits, a document that has never been named, or a pending rename.
    refreshActionsSaveButton = () => {
      const renaming = nameInput.value.trim() !== syncedDocumentName
      const saveable = documentIsDirty || !syncedDocumentName || renaming
      saveButton.disabled = !saveable
      saveButton.title = saveable ? '' : 'No changes since the last save'
    }
    refreshActionsSaveButton()
    nameInput.addEventListener('input', refreshActionsSaveButton)

    const settingsButton = document.createElement('button')
    settingsButton.type = 'button'
    settingsButton.textContent = 'Extension settings'
    const status = document.createElement('p')
    status.className = 'status'
    status.setAttribute('aria-live', 'polite')
    const recentDocumentsSection = document.createElement('div')
    recentDocumentsSection.className = 'recent-documents'
    recentDocumentsSection.hidden = true
    const recentHeading = document.createElement('p')
    recentHeading.className = 'recent-heading'
    recentHeading.textContent = 'Recent documents'
    const recentDocuments = document.createElement('div')
    recentDocumentsSection.append(recentHeading, recentDocuments)
    menu.append(nameLabel, saveButton, settingsButton, status, recentDocumentsSection)

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
        row.className = 'recent-row'
        const button = document.createElement('button')
        button.className = 'recent-name'
        button.type = 'button'
        button.textContent = recentDocument.name
        button.title = `Switch to ${recentDocument.name}`
        const openButton = document.createElement('button')
        openButton.className = 'recent-open'
        openButton.type = 'button'
        openButton.title = `Open ${recentDocument.name} in a new tab`
        openButton.setAttribute('aria-label', openButton.title)
        openButton.append(createExternalLinkIcon())
        openButton.addEventListener('click', () => {
          setMenuOpen(false)
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

    function setMenuOpen(open) {
      menu.hidden = !open
      trigger.setAttribute('aria-expanded', String(open))
    }

    trigger.addEventListener('click', () => {
      const open = menu.hidden
      setMenuOpen(open)
      refreshActionsSaveButton()
      if (open) loadRecentDocuments().catch(() => {
        recentDocumentsSection.hidden = true
      })
    })
    function saveFromMenu() {
      saveCurrentDocument(saveButton, status, nameInput.value.trim()).catch(error => {
        status.textContent = error.message
      })
    }
    saveButton.addEventListener('click', saveFromMenu)
    nameInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        saveFromMenu()
      }
    })
    settingsButton.addEventListener('click', () => {
      setMenuOpen(false)
      openExtensionSettings(settingsButton, error => {
        status.textContent = error.message
        setMenuOpen(true)
      })
    })
    document.addEventListener('pointerdown', event => {
      if (!event.composedPath().includes(host)) setMenuOpen(false)
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setMenuOpen(false)
    })
    shadow.append(style, trigger, menu)
    document.documentElement.append(host)
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
    remotePollTimer = setInterval(pollRemoteDocumentQuietly, REMOTE_POLL_INTERVAL)
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
