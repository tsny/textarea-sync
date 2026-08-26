# Textarea Sync and Improvshop Notes

This repository contains browser extensions that synchronize a textarea.my URL
and a private, single-user notes web application.

## Private notes web app

[`notes-app/`](notes-app/) is a deployable Cloudflare Workers and D1 application
for `notes.improvshop.wiki`. It adds password authentication, multiple notes,
search, autosave, conflict detection, export, and a responsive mobile interface
without requiring the browser extensions.

At one-user scale it is designed to remain within Cloudflare's $0 free tier.
See the [deployment guide](notes-app/README.md) for local setup, password
management, D1 creation, and custom-domain configuration.

## Browser extensions

The extensions save the latest [`textarea.my`](https://textarea.my) document
locally and can share it across devices through Pastebin.

`textarea.my` stores the document in the URL fragment. Textarea Sync watches
that URL while you edit and saves it to local extension storage. Connecting a
Pastebin account adds explicit cross-device sharing without a textarea.my
account or custom backend.

## Supported browsers

| Extension | Platforms | Cross-device service |
| --- | --- | --- |
| [Chrome](chrome-extension/) | Chrome desktop | Pastebin |
| [Firefox](firefox-extension/) | Firefox desktop 140+ and Firefox for Android 142+ | Pastebin |

Chrome and Firefox can share documents by connecting the same Pastebin account
on each device. Without Pastebin, each extension keeps its latest URL locally.

Runtime code shared by both extensions lives in [`extension-shared/`](extension-shared/).
After changing it, refresh the generated copies with:

```sh
node scripts/sync-extension-shared.mjs --write
```

Enable the tracked pre-commit drift check in a new checkout with:

```sh
make install-hooks
```

The hook runs the synchronizer in `--check` mode and blocks commits containing
stale generated copies without modifying the staged index.

## Install for development

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `chrome-extension/`.
4. Connect Pastebin from the extension when cross-device sharing is wanted.

See the [Chrome extension README](chrome-extension/README.md) for details.

### Firefox desktop

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `firefox-extension/manifest.json`.

Temporary add-ons disappear when Firefox restarts. Normal desktop and Android
installation requires a build signed through Mozilla Add-ons. See the
[Firefox extension README](firefox-extension/README.md) for Android testing and
installation details.

## Build extensions

Build the Chrome Web Store ZIP with:

```sh
make -C chrome-extension package
```

Build the Firefox upload XPI with:

```sh
make -C firefox-extension package
```

The upload-ready XPI is written to `firefox-extension/dist/`. The package uses
an explicit file allowlist, so macOS metadata, tests, and documentation are not
included.

Build the separately installable Firefox nightly add-on with its own Mozilla
add-on ID and sync namespace:

```sh
make -C firefox-extension nightly
```

Additional commands:

```sh
make -C firefox-extension test
make -C firefox-extension lint
make -C firefox-extension clean
```

## Behavior and limits

- The most recently edited textarea wins; only one document is retained.
- Opening an empty textarea or choosing **New** does not erase the synced URL.
- Paths up to 95,000 characters are retained in local extension storage.
- Larger documents continue to work on `textarea.my`, but are not synced by the
  extension.

## Privacy

By default, documents remain in local extension storage. When Pastebin is
connected, choosing **Update Pastebin now** sends the textarea URLs—and
therefore their embedded contents—to the user's unlisted Pastebin paste. Treat
this as convenient sharing, not end-to-end encrypted storage.
