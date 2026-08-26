# Textarea Sync Chrome extension

This extension saves the most recently edited `textarea.my` URL in local
extension storage. Pastebin provides optional cross-device sharing.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `chrome-extension` directory.
4. Connect the same Pastebin account on another device to share documents.

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
password is stored in `chrome.storage.local` with the developer key, generated
user key, and username so the extension can re-login and retry once when
Pastebin reports an authentication failure. This local storage is not encrypted.
When Pastebin is disconnected, `textarea.my` shows a setup prompt that opens the
extension-owned connection form so credentials are not entered into the site.
A persistent **Extension settings** button on `textarea.my` opens that form at
any time.

Pastebin does not provide an edit API. **Update Pastebin now** reads and merges
matching sync pastes, creates a replacement, and removes older copies. Updates
are manual to avoid creating a new paste after every textarea edit.

Because the document is embedded in a `textarea.my` URL fragment, enabling this
feature uploads the document contents to Pastebin. Unlisted pastes are not
end-to-end encrypted and should not contain secrets.

The extension watches textarea edits automatically. Because a textarea document
is stored in its URL fragment, the locally stored URL contains the document
itself. Only the latest local document is retained. Paths up to 95,000
characters are supported.

## Privacy

By default, the URL remains in local extension storage. If Pastebin is
connected, choosing **Update Pastebin now** sends the stored textarea URLs to
the user's Pastebin account.
