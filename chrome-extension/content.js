(() => {
  let timer
  let lastSentUrl = ''

  function sendCurrentUrl() {
    const url = location.href
    if (!location.hash || location.hash === '#new' || url === lastSentUrl) return
    lastSentUrl = url
    chrome.runtime.sendMessage({type: 'save-current', url, title: document.title})
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
    scheduleSave(0)
  })
})()
