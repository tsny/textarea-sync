globalThis.TextareaPastebin = (() => {
  const API_POST_URL = 'https://pastebin.com/api/api_post.php'
  const API_LOGIN_URL = 'https://pastebin.com/api/api_login.php'
  const API_RAW_URL = 'https://pastebin.com/api/api_raw.php'
  const SYNC_TITLE = 'textarea.my sync'
  const MAX_DOCUMENTS = 10
  const MAX_PAYLOAD_LENGTH = 400000
  const MAX_SOURCE_PASTES = 20

  async function apiRequest(url, values, fetchImpl = fetch) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
      body: new URLSearchParams(values).toString(),
    })
    const text = (await response.text()).trim()
    if (!response.ok) throw new Error(`Pastebin request failed (${response.status}).`)
    return text
  }

  function requireSuccess(text) {
    if (text.startsWith('Bad API request,')) {
      throw new Error(text.replace(/^Bad API request,\s*/, 'Pastebin: '))
    }
    return text
  }

  async function login(developerKey, username, password, fetchImpl = fetch) {
    if (!developerKey || !username || !password) {
      throw new Error('Pastebin developer key, username, and password are required.')
    }
    const userKey = requireSuccess(await apiRequest(API_LOGIN_URL, {
      api_dev_key: developerKey,
      api_user_name: username,
      api_user_password: password,
    }, fetchImpl))
    if (!userKey) throw new Error('Pastebin did not return a user session key.')
    return userKey
  }

  function decodeXml(value) {
    return value
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&amp;', '&')
  }

  function xmlValue(block, tag) {
    const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
    return match ? decodeXml(match[1]) : ''
  }

  function parsePasteList(xml) {
    return Array.from(xml.matchAll(/<paste>([\s\S]*?)<\/paste>/g), match => ({
      key: xmlValue(match[1], 'paste_key'),
      title: xmlValue(match[1], 'paste_title'),
      url: xmlValue(match[1], 'paste_url'),
      createdAt: Number(xmlValue(match[1], 'paste_date')) * 1000,
    })).filter(paste => paste.key)
  }

  async function listPastes(credentials, fetchImpl = fetch) {
    const text = await apiRequest(API_POST_URL, {
      api_dev_key: credentials.developerKey,
      api_user_key: credentials.userKey,
      api_option: 'list',
      api_results_limit: '1000',
    }, fetchImpl)
    if (/no pastes found/i.test(text)) return []
    return parsePasteList(requireSuccess(text))
  }

  async function readPaste(credentials, pasteKey, fetchImpl = fetch) {
    return requireSuccess(await apiRequest(API_RAW_URL, {
      api_dev_key: credentials.developerKey,
      api_user_key: credentials.userKey,
      api_option: 'show_paste',
      api_paste_key: pasteKey,
    }, fetchImpl))
  }

  async function createPaste(credentials, title, contents, fetchImpl = fetch) {
    const value = requireSuccess(await apiRequest(API_POST_URL, {
      api_dev_key: credentials.developerKey,
      api_user_key: credentials.userKey,
      api_option: 'paste',
      api_paste_code: contents,
      api_paste_name: title,
      api_paste_private: '1',
      api_paste_expire_date: 'N',
      api_paste_format: 'json',
    }, fetchImpl))
    const url = new URL(value)
    if (url.origin !== 'https://pastebin.com' || !url.pathname.slice(1)) {
      throw new Error('Pastebin returned an invalid paste URL.')
    }
    return {key: url.pathname.slice(1), url: url.href}
  }

  async function deletePaste(credentials, pasteKey, fetchImpl = fetch) {
    requireSuccess(await apiRequest(API_POST_URL, {
      api_dev_key: credentials.developerKey,
      api_user_key: credentials.userKey,
      api_option: 'delete',
      api_paste_key: pasteKey,
    }, fetchImpl))
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
    if (typeof document.deviceId !== 'string' || !document.deviceId) return null
    const updatedAt = Number(document.updatedAt)
    if (!Number.isFinite(updatedAt)) return null
    return {
      deviceId: document.deviceId.slice(0, 50),
      url: url.href,
      title: String(document.title || 'Textarea').slice(0, 200),
      updatedAt,
    }
  }

  function mergeDocuments(groups) {
    const documents = new Map()
    for (const group of groups) {
      for (const value of group) {
        const document = normalizeDocument(value)
        const existing = document && documents.get(document.deviceId)
        if (document && (!existing || document.updatedAt > existing.updatedAt)) {
          documents.set(document.deviceId, document)
        }
      }
    }
    return Array.from(documents.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function parseSyncPaste(contents) {
    try {
      const data = JSON.parse(contents)
      if (data?.version !== 1 || !Array.isArray(data.documents)) return []
      return data.documents
    } catch {
      return []
    }
  }

  async function load(credentials, fetchImpl = fetch) {
    const pastes = (await listPastes(credentials, fetchImpl))
      .filter(paste => paste.title === SYNC_TITLE)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_SOURCE_PASTES)
    const groups = []
    for (const paste of pastes) {
      try {
        groups.push(parseSyncPaste(await readPaste(credentials, paste.key, fetchImpl)))
      } catch {
        // A malformed or deleted copy should not hide the other valid copies.
      }
    }
    return {documents: mergeDocuments(groups), pastes}
  }

  function buildPayload(documents) {
    const kept = documents.slice(0, MAX_DOCUMENTS)
    let payload
    do {
      payload = JSON.stringify({version: 1, updatedAt: Date.now(), documents: kept}, null, 2)
      if (payload.length <= MAX_PAYLOAD_LENGTH) return payload
      kept.pop()
    } while (kept.length)
    throw new Error('The current textarea is too large for the Pastebin sync file.')
  }

  async function replace(credentials, localDocument, fetchImpl = fetch) {
    const current = await load(credentials, fetchImpl)
    const documents = mergeDocuments([current.documents, [localDocument]])
    const created = await createPaste(
      credentials,
      SYNC_TITLE,
      buildPayload(documents),
      fetchImpl
    )
    let deletionFailures = 0
    for (const paste of current.pastes) {
      try {
        await deletePaste(credentials, paste.key, fetchImpl)
      } catch {
        deletionFailures++
      }
    }
    return {
      documents,
      pasteUrl: created.url,
      deletionFailures,
    }
  }

  return {load, login, mergeDocuments, parsePasteList, parseSyncPaste, replace}
})()
