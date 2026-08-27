globalThis.TextareaPopupForm = (() => {
  function captureGitHubCredentials(form, setBusy, FormDataType = FormData) {
    const values = new FormDataType(form)
    const credentials = {token: values.get('token')}
    setBusy(true)
    return credentials
  }

  return {captureGitHubCredentials}
})()
