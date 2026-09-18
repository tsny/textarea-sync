.PHONY: install-hooks sync-extensions test package version clean

install-hooks:
	git config core.hooksPath .githooks
	@echo "Git hooks enabled from .githooks/"

sync-extensions:
	node scripts/sync-extension-shared.mjs --write

test:
	$(MAKE) -C chrome-extension test
	$(MAKE) -C firefox-extension test

package:
	$(MAKE) -C chrome-extension package
	$(MAKE) -C firefox-extension package

# Both stores reject a re-upload of an existing version, so the manifests move
# together. Run make version VERSION=0.1.23
version:
	@test -n "$(VERSION)" || { echo "Set VERSION, e.g. make version VERSION=0.1.23"; exit 1; }
	@for manifest in chrome-extension/manifest.json firefox-extension/manifest.json; do \
		python3 -c "import re,sys; p=sys.argv[1]; s=open(p).read(); s,n=re.subn(r'(\"version\"\s*:\s*\")[^\"]+', r'\g<1>'+sys.argv[2], s, count=1); sys.exit('No version field in '+p) if not n else open(p,'w').write(s)" $$manifest '$(VERSION)'; \
		python3 -m json.tool $$manifest >/dev/null; \
		echo "$$manifest -> $(VERSION)"; \
	done

clean:
	$(MAKE) -C chrome-extension clean
	$(MAKE) -C firefox-extension clean
