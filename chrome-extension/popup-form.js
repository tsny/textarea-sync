globalThis.TextareaPopupForm = (() => {
  function capturePastebinCredentials(form, setBusy, FormDataType = FormData) {
    const values = new FormDataType(form)
    const credentials = {
      developerKey: values.get('developerKey'),
      username: values.get('username'),
      password: values.get('password'),
    }
    setBusy(true)
    return credentials
  }

  return {capturePastebinCredentials}
})()
