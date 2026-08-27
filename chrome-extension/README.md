# Textarea Sync for Chrome

## Install

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose Load unpacked.
4. Select this folder.

Connect GitHub with a token that has Gist access. The extension creates one
secret Gist named `textarea.my sync` and updates it in place.

```sh
make test
make package
```

Secret Gists are unlisted, not encrypted. Do not save secrets.
