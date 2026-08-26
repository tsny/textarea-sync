import assert from 'node:assert/strict'
import './popup-form.js'

const form = {
  elements: [
    {disabled: false},
    {disabled: false},
    {disabled: false},
  ],
}

class TestFormData {
  constructor(receivedForm) {
    assert.equal(receivedForm, form)
    assert.equal(form.elements.every(element => !element.disabled), true)
  }

  get(name) {
    return {
      developerKey: 'developer-key',
      username: 'pastebin-user',
      password: 'pastebin-password',
    }[name]
  }
}

const credentials = globalThis.TextareaPopupForm.capturePastebinCredentials(
  form,
  busy => {
    for (const element of form.elements) element.disabled = busy
  },
  TestFormData
)

assert.deepEqual(credentials, {
  developerKey: 'developer-key',
  username: 'pastebin-user',
  password: 'pastebin-password',
})
assert.equal(form.elements.every(element => element.disabled), true)

console.log('Shared popup form tests passed')
