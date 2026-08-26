# Textarea Sync Firefox extension

This extension saves the most recently edited `textarea.my` URL in local
extension storage. Pastebin provides optional cross-device sharing.

## Firefox for Android

The same package supports Firefox for Android 142 and newer. Install the signed
extension from Mozilla Add-ons and connect the same Pastebin account on every
device that should share textareas.

To use it:

1. Open `textarea.my` and edit a document on one device.
2. Open **Add-ons → Textarea Sync** and choose **Update Pastebin now**.
3. Open **Add-ons → Textarea Sync** on the other device.
4. Select the textarea under **Synced devices**.

The Manifest V3 background uses an event page (`background.scripts`), because
background service workers are not supported on Firefox for Android. The popup
also uses touch-sized controls and adapts to narrow mobile panels.

For development testing, connect an Android phone or emulator with Android
Debug Bridge and run Mozilla's `web-ext` Android workflow. Run `make lint`
before release to check the manifest and APIs against Firefox Android support.

## Try it temporarily

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on**.
3. Select this directory's `manifest.json`.
4. Repeat on another device and connect the same Pastebin account if desired.

Temporary add-ons are removed when Firefox restarts. For normal installation
and reliable cross-device use, package and sign the extension through Mozilla
Add-ons. The manifest's fixed Gecko ID preserves the extension's local storage
across upgrades.

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

The runtime files are generated from the repository's `extension-shared/`
directory. After editing shared source, run
`node ../scripts/sync-extension-shared.mjs --write`.

## Nightly build

Build the separately installable nightly add-on with:

```sh
make nightly
```

The nightly manifest is generated in a temporary staging directory. It uses:

- Add-on ID: `textarea-sync-nightly@textarea.my`
- Name: `Textarea Sync Nightly`
- Version: the stable version plus the UTC build date, such as
  `0.1.0.20260825`

The stable manifest is never modified. Because Mozilla scopes extension storage
to the add-on ID, stable and nightly can be installed together and have separate
local data. They can still share the same Pastebin record if both connect the
same account. Register the nightly ID as a separate add-on in Mozilla Add-ons
before signing it.

To rebuild more than once per day for submission, supply a unique compatible
version explicitly:

```sh
make nightly NIGHTLY_VERSION=0.1.1.20260825
```

## Optional Pastebin sync

The popup can maintain an unlisted Pastebin JSON paste named `textarea.my sync`
containing the latest textarea URL contributed by each connected device. The
Pastebin account is the shared namespace and sole cross-device mechanism.
Supply a Pastebin developer API key, username, and password to connect. The
password is stored in `browser.storage.local` with the developer key, generated
user key, and username so the extension can re-login and retry once when
Pastebin reports an authentication failure. This local storage is not encrypted.
When Pastebin is disconnected, `textarea.my` shows a setup prompt that opens the
extension-owned connection form so credentials are not entered into the site.
A persistent **Extension settings** button on `textarea.my` opens that form at
any time.

Pastebin does not provide an edit API. **Update Pastebin now** therefore reads
and merges all matching sync pastes, creates a replacement, and then removes
the older copies. Updates are manual to avoid creating a new paste after every
textarea edit. Concurrent updates may briefly leave multiple copies, which are
merged the next time either device updates.

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
