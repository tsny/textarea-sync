# Repository instructions

- After making changes to the browser extension, increment the patch version with `make version VERSION=<next>` before finishing the task, unless the user specifies a different version. It bumps both `chrome-extension/manifest.json` and `firefox-extension/manifest.json`, which must stay in step because each store rejects a re-upload of an existing version.
- Edit shared code in `extension-shared/`, then run `make sync-extensions` to copy it into both extensions.
- `make package` builds the Chrome zip and the Firefox xpi into each extension's `dist/`.
