# Textarea Sync Firefox extension

This extension saves the most recently edited `textarea.my` URL in
`browser.storage.sync`. On another device using the same signed-in Firefox
account, click the extension and choose **Open synced textarea**.

The same package supports Firefox for Android 142 and newer. Its Manifest V3
background uses an event page (`background.scripts`), because background
service workers are not supported on Firefox for Android.

## Try it temporarily

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select this directory's `manifest.json`.
4. Repeat on the other device and make sure Firefox Sync is enabled there.

For Android development, connect the phone or emulator with Android Debug
Bridge and use Mozilla's `web-ext run -t firefox-android` workflow. Normal users
install the signed build from Mozilla Add-ons.

Temporary add-ons are removed when Firefox restarts. For normal installation
and reliable cross-device use, package and sign the extension through Mozilla
Add-ons. The manifest's fixed Gecko ID ensures both installations use the same
Firefox Sync namespace.

## Build the upload

Run:

```sh
make package
```

The signed-upload archive is written to `dist/`. The Makefile packages an
explicit allowlist of extension files and strips ZIP metadata, so `.DS_Store`,
`__MACOSX`, tests, and documentation are not included. Run `make clean` to
remove generated archives.

Run `make lint` to check both desktop and Android compatibility with Mozilla's
current `web-ext` linter before submitting a release.

The extension watches textarea edits automatically. Because a textarea document
is stored in its URL fragment, the synced URL contains the document itself.
Only the latest document is retained; whichever textarea was edited last wins.

Firefox Sync has a roughly 100 KiB extension-storage quota. This implementation
chunks the URL to satisfy the smaller per-item quota and supports paths up to
95,000 characters. Larger documents remain usable on the website but are not
synced by this extension.

## Privacy

The extension does not use a textarea.my server account or send documents to a
new backend. The URL is stored through the signed-in browser's Firefox Sync
storage. Anyone with access to that Firefox account or profile may be able to
read it, so it should not be treated as end-to-end encrypted secret storage.
