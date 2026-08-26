# Shared browser-extension source

This directory is the canonical source for runtime files used by both the
Chrome and Firefox extensions. After editing a shared file, materialize it into
both extension directories with:

```sh
node scripts/sync-extension-shared.mjs --write
```

Tests and packages run the script in `--check` mode so generated copies cannot
silently drift. Manifests, packaging, Firefox nightly generation, and Chrome's
service-worker loader remain browser-specific.
