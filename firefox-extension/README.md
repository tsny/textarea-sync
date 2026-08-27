# Textarea Sync for Firefox

## Install for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose Load Temporary Add-on.
3. Select `manifest.json` from this folder.

The same extension supports Firefox for Android 142 and newer. Connect GitHub
with a token that has Gist access. The extension creates one secret Gist named
`textarea.my sync` and updates it in place.

```sh
make test
make lint
make package
make nightly
```

Secret Gists are unlisted, not encrypted. Do not save secrets.
