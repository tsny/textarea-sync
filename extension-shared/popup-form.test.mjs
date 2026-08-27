import assert from 'node:assert/strict'
import './popup-form.js'

const form = {
  elements: [{disabled: false}],
}

class TestFormData {
  constructor(receivedForm) {
    assert.equal(receivedForm, form)
    assert.equal(form.elements.every(element => !element.disabled), true)
  }

  get(name) {
    return {token: 'github-token'}[name]
  }
}

const credentials = globalThis.TextareaPopupForm.captureGitHubCredentials(
  form,
  busy => {
    for (const element of form.elements) element.disabled = busy
  },
  TestFormData
)

assert.deepEqual(credentials, {
  token: 'github-token',
})
assert.equal(form.elements.every(element => element.disabled), true)

console.log('Shared popup form tests passed')
