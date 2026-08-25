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

The extension watches textarea edits automatically. Because a textarea document
is stored in its URL fragment, the synced URL contains the document itself.
Only the latest document is retained; whichever textarea was edited last wins.

Chrome Sync has a roughly 100 KiB extension-storage quota. This implementation
chunks the URL to satisfy the smaller per-item quota and supports paths up to
95,000 characters. Larger documents remain usable on the website but are not
synced by this extension.

## Privacy

The extension does not use a textarea.my server account or send documents to a
new backend. The URL is stored through the signed-in browser's Chrome Sync
storage. Anyone with access to that Chrome profile may be able to read it, so it
should not be treated as end-to-end encrypted secret storage.
