globalThis.TextareaGist = (() => {
  const API_ROOT = 'https://api.github.com'
  const API_VERSION = '2022-11-28'
  const GIST_DESCRIPTION = 'textarea.my sync'
  const SYNC_FILE = 'textarea-sync.json'
  const MAX_DOCUMENTS = 10
  const MAX_PAYLOAD_LENGTH = 400000

  async function apiRequest(path, {method = 'GET', body, token, fetchImpl = fetch} = {}) {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? {'Content-Type': 'application/json'} : {}),
      },
      ...(body ? {body: JSON.stringify(body)} : {}),
    })
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) {
      const detail = typeof data?.message === 'string'
        ? data.message
        : String(text || '').replace(/\s+/g, ' ').slice(0, 200)
      throw new Error(`GitHub request failed (${response.status})${detail ? `: ${detail}` : ''}.`)
    }
    return data
  }

  function normalizeDocumentName(value) {
    return String(value || '').trim().slice(0, 100)
  }

  function normalizeDocument(document) {
    if (!document || typeof document !== 'object') return null
    let url
    try {
      url = new URL(document.url)
    } catch {
      return null
    }
    if (url.origin !== 'https://textarea.my' || !url.hash || url.hash === '#new') return null
    const deviceId = typeof document.deviceId === 'string' ? document.deviceId.slice(0, 50) : ''
    const name = normalizeDocumentName(document.name || document.deviceName || document.title)
    if (!name) return null
    const updatedAt = Number(document.updatedAt)
    if (!Number.isFinite(updatedAt)) return null
    return {
      name,
      url: url.href,
      title: String(document.title || 'Textarea').slice(0, 200),
      updatedAt,
      updatedByDeviceId: String(document.updatedByDeviceId || deviceId).slice(0, 50),
    }
  }

  function mergeDocuments(groups) {
    const documents = new Map()
    for (const group of groups) {
      for (const value of group || []) {
        const document = normalizeDocument(value)
        const key = document?.name.toLocaleLowerCase()
        const existing = document && documents.get(key)
        if (document && (!existing || document.updatedAt > existing.updatedAt)) {
          documents.set(key, document)
        }
      }
    }
    return Array.from(documents.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function parseSyncFile(contents) {
    try {
      const data = JSON.parse(contents)
      if (![1, 2].includes(data?.version) || !Array.isArray(data.documents)) return null
      return data.documents
    } catch {
      return null
    }
  }

  function buildPayload(documents) {
    const kept = documents.slice(0, MAX_DOCUMENTS)
    let payload
    do {
      payload = JSON.stringify({
        app: 'textarea-sync',
        version: 2,
        updatedAt: Date.now(),
        documents: kept,
      }, null, 2)
      if (payload.length <= MAX_PAYLOAD_LENGTH) return payload
      kept.pop()
    } while (kept.length)
    throw new Error('The current textarea is too large for the GitHub Gist sync file.')
  }

  function gistSummary(value) {
    if (!value?.id || !value?.files?.[SYNC_FILE]) return null
    return {
      id: String(value.id),
      url: String(value.html_url || `https://gist.github.com/${value.id}`),
    }
  }

  async function findSyncGist(token, fetchImpl = fetch) {
    for (let page = 1; page <= 10; page++) {
      const values = await apiRequest(`/gists?per_page=100&page=${page}`, {token, fetchImpl})
      if (!Array.isArray(values)) throw new Error('GitHub returned an invalid Gist list.')
      const match = values.find(value => (
        value?.description === GIST_DESCRIPTION && value?.files?.[SYNC_FILE]
      ))
      if (match) return gistSummary(match)
      if (values.length < 100) return null
    }
    return null
  }

  async function readGist(token, gistId, fetchImpl = fetch) {
    const value = await apiRequest(`/gists/${encodeURIComponent(gistId)}`, {token, fetchImpl})
    const gist = gistSummary(value)
    const contents = value?.files?.[SYNC_FILE]?.content
    if (!gist || typeof contents !== 'string') {
      throw new Error(`The GitHub Gist is missing ${SYNC_FILE}.`)
    }
    const documents = parseSyncFile(contents)
    if (!documents) throw new Error(`The GitHub Gist has an invalid ${SYNC_FILE}.`)
    return {documents: mergeDocuments([documents]), gist}
  }

  async function createGist(token, documents, fetchImpl = fetch) {
    const value = await apiRequest('/gists', {
      method: 'POST',
      token,
      fetchImpl,
      body: {
        description: GIST_DESCRIPTION,
        public: false,
        files: {[SYNC_FILE]: {content: buildPayload(documents)}},
      },
    })
    const gist = gistSummary(value)
    if (!gist) throw new Error('GitHub returned an invalid Gist.')
    return gist
  }

  async function updateGist(token, gistId, documents, fetchImpl = fetch) {
    const value = await apiRequest(`/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      token,
      fetchImpl,
      body: {
        description: GIST_DESCRIPTION,
        files: {[SYNC_FILE]: {content: buildPayload(documents)}},
      },
    })
    const gist = gistSummary(value)
    if (!gist) throw new Error('GitHub returned an invalid Gist.')
    return gist
  }

  async function connect(tokenValue, seedDocuments = [], fetchImpl = fetch) {
    const token = String(tokenValue || '').trim()
    if (!token) throw new Error('A GitHub token with Gist access is required.')
    const user = await apiRequest('/user', {token, fetchImpl})
    if (typeof user?.login !== 'string' || !user.login) {
      throw new Error('GitHub did not return an account name.')
    }

    let gist = await findSyncGist(token, fetchImpl)
    let documents = mergeDocuments([seedDocuments])
    if (gist) {
      const current = await readGist(token, gist.id, fetchImpl)
      documents = mergeDocuments([current.documents, seedDocuments])
      if (seedDocuments.length) gist = await updateGist(token, gist.id, documents, fetchImpl)
    } else {
      gist = await createGist(token, documents, fetchImpl)
    }
    return {token, username: user.login, gistId: gist.id, gistUrl: gist.url, documents}
  }

  async function load(credentials, fetchImpl = fetch) {
    if (!credentials?.token || !credentials?.gistId) {
      throw new Error('Connect a GitHub account first.')
    }
    const current = await readGist(credentials.token, credentials.gistId, fetchImpl)
    return {documents: current.documents, gistUrl: current.gist.url}
  }

  async function replace(credentials, localDocument, fetchImpl = fetch) {
    const current = await load(credentials, fetchImpl)
    const documents = mergeDocuments([current.documents, [localDocument]])
    const gist = await updateGist(credentials.token, credentials.gistId, documents, fetchImpl)
    return {documents, gistUrl: gist.url}
  }

  return {
    connect,
    load,
    mergeDocuments,
    normalizeDocumentName,
    parseSyncFile,
    replace,
  }
})()
