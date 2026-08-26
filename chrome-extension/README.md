# Textarea Sync Chrome extension

This extension saves the most recently edited `textarea.my` URL in
`chrome.storage.sync`. On another computer using the same signed-in Chrome
profile, click the extension and choose **Open synced textarea**.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `chrome-extension` directory.
4. Repeat on the other computer and make sure Chrome Sync is enabled there.

The manifest includes a public `key` so unpacked copies use the same extension
ID on both computers. (The key is an identifier, not a credential.) A published
Chrome Web Store build receives a stable extension ID from the store instead.

## Build the upload

Run `make package` to create the Chrome Web Store ZIP in `dist/`. Run
`make test` for shared unit, manifest, drift, and syntax checks. Mozilla's
`web-ext lint` targets Firefox manifests and is run from `firefox-extension/`.

The runtime files are generated from the repository's `extension-shared/`
directory. After editing shared source, run:

```sh
node ../scripts/sync-extension-shared.mjs --write
```

## Optional Pastebin sync

The popup can maintain an unlisted Pastebin JSON paste named `textarea.my sync`
containing the latest textarea URL contributed by each connected device. The
Pastebin account is the shared namespace, so it can bridge Chrome and Firefox.
Supply a Pastebin developer API key, username, and password to connect. The
password is sent directly to Pastebin to obtain a user session key and is never
stored; the developer and user keys are retained in `chrome.storage.local`.

Pastebin does not provide an edit API. **Update Pastebin now** reads and merges
matching sync pastes, creates a replacement, and removes older copies. Updates
are manual to avoid creating a new paste after every textarea edit.

Because the document is embedded in a `textarea.my` URL fragment, enabling this
feature uploads the document contents to Pastebin. Unlisted pastes are not
end-to-end encrypted and should not contain secrets.

The extension watches textarea edits automatically. Because a textarea document
is stored in its URL fragment, the synced URL contains the document itself.
Only the latest document is retained; whichever textarea was edited last wins.

Chrome Sync has a roughly 100 KiB extension-storage quota. This implementation
chunks the URL to satisfy the smaller per-item quota and supports paths up to
95,000 characters. Larger documents remain usable on the website but are not
synced by this extension.

## Privacy

By default, the URL is stored only through the signed-in browser's Chrome Sync
storage. Anyone with access to that Chrome profile may be able to read it. If
the optional Pastebin feature is connected, choosing **Update Pastebin now**
additionally sends the stored textarea URLs to the user's Pastebin account.
