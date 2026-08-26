(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome
  let timer
  let lastSentUrl = ''
  let pastebinPrompt

  function openExtensionSettings(button, onError) {
    button.disabled = true
    extensionApi.runtime.sendMessage({type: 'open-pastebin-setup'})
      .then(response => {
        if (!response?.ok) throw new Error(response?.error || 'Unable to open extension settings.')
      })
      .catch(onError)
      .finally(() => { button.disabled = false })
  }

  function showSettingsButton() {
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
      button {
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
      button:hover { background: #fff; }
      button:disabled { cursor: default; opacity: .6; }
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
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Extension settings'
    button.title = 'Open Textarea Sync settings'
    button.addEventListener('click', () => {
      openExtensionSettings(button, error => { button.title = error.message })
    })
    shadow.append(style, button)
    document.documentElement.append(host)
  }

  function hidePastebinPrompt() {
    pastebinPrompt?.remove()
    pastebinPrompt = null
  }

  function showPastebinPrompt() {
    if (pastebinPrompt) return

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
    panel.setAttribute('aria-label', 'Connect Pastebin')
    const heading = document.createElement('strong')
    heading.textContent = 'Connect Pastebin'
    const description = document.createElement('p')
    description.textContent = 'Add your Pastebin API key and login to sync this textarea across browsers.'
    const actions = document.createElement('div')
    const setupButton = document.createElement('button')
    setupButton.type = 'button'
    setupButton.textContent = 'Set up Pastebin'
    const dismissButton = document.createElement('button')
    dismissButton.type = 'button'
    dismissButton.textContent = 'Not now'
    actions.append(setupButton, dismissButton)
    panel.append(heading, description, actions)
    shadow.append(style, panel)
    document.documentElement.append(host)
    pastebinPrompt = host

    setupButton.addEventListener('click', () => {
      openExtensionSettings(setupButton, error => { description.textContent = error.message })
    })
    dismissButton.addEventListener('click', hidePastebinPrompt)
  }

  function checkPastebinConnection() {
    extensionApi.runtime.sendMessage({type: 'get-pastebin-connection'})
      .then(response => {
        if (response?.ok && !response.connected) showPastebinPrompt()
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
    showSettingsButton()
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
    checkPastebinConnection()
    scheduleSave(0)
  })

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.pastebinCredentials?.newValue) {
      hidePastebinPrompt()
    }
  })
})()
