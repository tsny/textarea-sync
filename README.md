# textarea.my sync

Browser extensions for Chrome and Firefox that save and share named
[`textarea.my`](https://textarea.my) documents through one secret GitHub Gist.

Shared extension code is in `extension-shared/`.

```sh
make sync-extensions
make test
make -C chrome-extension package
make -C firefox-extension package
```

GitHub receives the document URL, which contains the document text. Secret
Gists are unlisted, not encrypted. Do not use this for secrets.
