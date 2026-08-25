# Textarea Sync

Browser extensions that keep the latest [`textarea.my`](https://textarea.my)
document available across signed-in devices.

`textarea.my` stores the document in the URL fragment. Textarea Sync watches
that URL while you edit, saves it to the browser's synchronized extension
storage, and provides an **Open synced textarea** button on another device. No
textarea.my account or additional backend is required.

## Supported browsers

| Extension | Platforms | Sync service |
| --- | --- | --- |
| [Chrome](chrome-extension/) | Chrome desktop | Chrome Sync |
| [Firefox](firefox-extension/) | Firefox desktop 140+ and Firefox for Android 142+ | Firefox Sync |

Chrome and Firefox use separate sync systems. Documents sync between devices
using the same browser account, but they do not sync between Chrome and Firefox.

## Install for development

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `chrome-extension/`.
4. Enable Chrome Sync and install the extension on the other computer.

See the [Chrome extension README](chrome-extension/README.md) for details.

### Firefox desktop

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `firefox-extension/manifest.json`.

Temporary add-ons disappear when Firefox restarts. Normal desktop and Android
installation requires a build signed through Mozilla Add-ons. See the
[Firefox extension README](firefox-extension/README.md) for Android testing and
installation details.

## Build Firefox

```sh
make -C firefox-extension package
```

The upload-ready XPI is written to `firefox-extension/dist/`. The package uses
an explicit file allowlist, so macOS metadata, tests, and documentation are not
included.

Additional commands:

```sh
make -C firefox-extension test
make -C firefox-extension lint
make -C firefox-extension clean
```

## Behavior and limits

- The most recently edited textarea wins; only one document is retained.
- Opening an empty textarea or choosing **New** does not erase the synced URL.
- URLs are split into chunks to meet browser per-item storage limits.
- Paths up to 95,000 characters are supported within the roughly 100 KiB sync
  quota.
- Larger documents continue to work on `textarea.my`, but are not synced by the
  extension.

## Privacy

Documents are sent only through the browser's own synchronized extension
storage. Anyone with access to the signed-in browser account or profile may be
able to read them. Treat this as convenient synchronization, not end-to-end
encrypted secret storage.
