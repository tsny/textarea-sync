# textarea.my sync

Browser extensions for Chrome and Firefox that save and share named
[`textarea.my`](https://textarea.my) documents through Pastebin.

Shared extension code is in `extension-shared/`.

```sh
make sync-extensions
make test
make -C chrome-extension package
make -C firefox-extension package
```

Pastebin receives the document URL, which contains the document text. Do not
use it for secrets.
