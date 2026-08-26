globalThis.TextareaDocumentStorage = (() => {
  const DOCUMENT_KEY = 'latestDocument'
  const MAX_PATH_LENGTH = 95000

  function validatePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
      throw new Error('Textarea URL path is invalid.')
    }
    if (path.length > MAX_PATH_LENGTH) {
      throw new Error('This document is too large to store locally.')
    }

    const url = new URL(path, 'https://textarea.my')
    if (url.origin !== 'https://textarea.my') {
      throw new Error('Only textarea.my URLs can be stored.')
    }
  }

  async function saveLatest(storage, document) {
    validatePath(document.path)
    const existing = (await storage.get(DOCUMENT_KEY))[DOCUMENT_KEY]
    if (existing?.path === document.path) return {changed: false}

    await storage.set({
      [DOCUMENT_KEY]: {
        version: 1,
        path: document.path,
        title: String(document.title || 'Textarea').slice(0, 200),
        savedAt: Date.now(),
      },
    })
    return {changed: true}
  }

  async function getLatest(storage) {
    const document = (await storage.get(DOCUMENT_KEY))[DOCUMENT_KEY]
    if (!document || document.version !== 1) return null
    validatePath(document.path)
    return {
      path: document.path,
      title: document.title || 'Textarea',
      savedAt: document.savedAt,
    }
  }

  return {MAX_PATH_LENGTH, getLatest, saveLatest}
})()
