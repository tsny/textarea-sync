(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome
  let timer
  let lastSentUrl = ''
  let syncIdButton
  let syncIdResetTimer

  function showSyncId(id) {
    if (typeof id !== 'string') return

    if (!syncIdButton) {
      const host = document.createElement('div')
      host.dataset.textareaSyncId = ''
      const shadow = host.attachShadow({mode: 'closed'})
      const style = document.createElement('style')
      style.textContent = `
        :host {
          all: initial;
          bottom: max(8px, env(safe-area-inset-bottom));
          position: fixed;
          right: max(8px, env(safe-area-inset-right));
          z-index: 2147483647;
        }
        button {
          appearance: none;
          background: rgba(248, 248, 248, .94);
          border: 1px solid rgba(0, 0, 0, .2);
          border-radius: 999px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, .12);
          color: #3b3b3b;
          cursor: pointer;
          font: 600 11px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
          letter-spacing: .02em;
          padding: 5px 8px;
        }
        button:hover { background: #fff; }
        button:focus-visible { outline: 2px solid #0569fa; outline-offset: 2px; }
        @media (prefers-color-scheme: dark) {
          button {
            background: rgba(42, 42, 42, .94);
            border-color: rgba(255, 255, 255, .25);
            color: #e8e8e8;
          }
          button:hover { background: #333; }
        }
      `
      syncIdButton = document.createElement('button')
      syncIdButton.type = 'button'
      shadow.append(style, syncIdButton)
      document.documentElement.append(host)

      syncIdButton.addEventListener('click', async () => {
        const currentId = syncIdButton.dataset.syncId
        try {
          await navigator.clipboard.writeText(currentId)
          syncIdButton.textContent = `Copied ${currentId}`
          clearTimeout(syncIdResetTimer)
          syncIdResetTimer = setTimeout(() => setSyncIdText(currentId), 1500)
        } catch {
          syncIdButton.title = 'Unable to copy. Compare this Sync ID on your other device.'
        }
      })
    }

    clearTimeout(syncIdResetTimer)
    setSyncIdText(id)
  }

  function setSyncIdText(id) {
    if (!syncIdButton) return
    syncIdButton.dataset.syncId = id
    syncIdButton.textContent = `Sync ID ${id}`
    syncIdButton.title = 'Matching IDs mean these installs share browser sync data. Click to copy.'
    syncIdButton.setAttribute('aria-label', `Textarea Sync ID ${id}. Click to copy.`)
  }

  function requestSyncId() {
    extensionApi.runtime.sendMessage({type: 'get-sync-id'})
      .then(response => {
        if (response?.ok) showSyncId(response.id)
      })
      .catch(() => {
        // The extension may have been reloaded while this tab stayed open.
      })
  }

  function sendCurrentUrl() {
    const url = location.href
    if (!location.hash || location.hash === '#new' || url === lastSentUrl) return
    lastSentUrl = url
    extensionApi.runtime.sendMessage({type: 'save-current', url, title: document.title})
      .then(response => {
        if (!response?.ok) lastSentUrl = ''
      })
      .catch(() => {
        // The extension may have been reloaded while this tab stayed open.
        lastSentUrl = ''
      })
  }

  function scheduleSave(delay = 1500) {
    clearTimeout(timer)
    timer = setTimeout(sendCurrentUrl, delay)
  }

  addEventListener('pageshow', () => scheduleSave(0))
  addEventListener('hashchange', () => scheduleSave(0))
  addEventListener('popstate', () => scheduleSave(0))
  addEventListener('input', () => scheduleSave(), true)

  addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('article')
    if (article) {
      new MutationObserver(() => scheduleSave()).observe(article, {
        attributes: true,
        attributeFilter: ['style'],
        childList: true,
        characterData: true,
        subtree: true,
      })
    }
    requestSyncId()
    scheduleSave(0)
  })

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.syncId?.newValue) {
      showSyncId(changes.syncId.newValue)
    }
  })
})()
