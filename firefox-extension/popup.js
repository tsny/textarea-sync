const status = document.querySelector('#status')
const details = document.querySelector('#details')
const openButton = document.querySelector('#open')
let latest = null

browser.runtime.sendMessage({type: 'get-latest'}).then(response => {
  if (!response?.ok) throw new Error(response?.error || 'Firefox Sync is unavailable.')
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
  browser.tabs.create({url: `https://textarea.my${latest.path}`})
  window.close()
})
