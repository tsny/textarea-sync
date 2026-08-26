.PHONY: install-hooks sync-extensions test

install-hooks:
	git config core.hooksPath .githooks
	@echo "Git hooks enabled from .githooks/"

sync-extensions:
	node scripts/sync-extension-shared.mjs --write

test:
	$(MAKE) -C chrome-extension test
	$(MAKE) -C firefox-extension test
