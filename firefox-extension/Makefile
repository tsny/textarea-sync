NAME := textarea-sync-firefox
VERSION := $(shell awk -F'"' '/"version"/ { print $$4; exit }' manifest.json)
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(NAME)-$(VERSION).xpi
NIGHTLY_ID ?= textarea-sync-nightly@textarea.my
NIGHTLY_VERSION ?= $(VERSION).$(shell date -u +%Y%m%d)
NIGHTLY_STAGE := $(DIST_DIR)/nightly
NIGHTLY_PACKAGE := $(DIST_DIR)/$(NAME)-nightly-$(NIGHTLY_VERSION).xpi

# Package from an allowlist so Finder metadata, tests, and source docs cannot
# accidentally end up in the submitted extension.
EXTENSION_FILES := \
	manifest.json \
	background.js \
	content.js \
	gist.js \
	document-storage.js \
	popup.html \
	popup.css \
	popup-form.js \
	popup.js

.PHONY: all package nightly test lint clean

all: package

package: test | $(DIST_DIR)
	rm -f $(PACKAGE)
	zip -X -9 $(PACKAGE) $(EXTENSION_FILES)
	@echo "Built $(PACKAGE)"

nightly: test | $(DIST_DIR)
	rm -rf $(NIGHTLY_STAGE)
	mkdir -p $(NIGHTLY_STAGE)
	cp $(filter-out manifest.json,$(EXTENSION_FILES)) $(NIGHTLY_STAGE)/
	python3 nightly_manifest.py \
		--source manifest.json \
		--destination $(NIGHTLY_STAGE)/manifest.json \
		--id '$(NIGHTLY_ID)' \
		--version '$(NIGHTLY_VERSION)'
	python3 -m json.tool $(NIGHTLY_STAGE)/manifest.json >/dev/null
	rm -f $(NIGHTLY_PACKAGE)
	cd $(NIGHTLY_STAGE) && zip -X -9 ../$(notdir $(NIGHTLY_PACKAGE)) $(EXTENSION_FILES)
	rm -rf $(NIGHTLY_STAGE)
	@echo "Built $(NIGHTLY_PACKAGE) with add-on ID $(NIGHTLY_ID)"

test:
	python3 -m json.tool manifest.json >/dev/null
	node ../scripts/sync-extension-shared.mjs --check
	node ../extension-shared/document-storage.test.mjs
	node ../extension-shared/gist.test.mjs
	node ../extension-shared/background.test.mjs
	node ../extension-shared/popup-form.test.mjs
	node --check background.js
	node --check content.js
	node --check gist.js
	node --check popup-form.js
	node --check popup.js
	node --check document-storage.js

lint:
	npx --yes web-ext lint --source-dir . \
		--ignore-files README.md Makefile .gitignore nightly_manifest.py \
			'dist/**' \
		--no-config-discovery --warnings-as-errors

$(DIST_DIR):
	mkdir -p $(DIST_DIR)

clean:
	rm -rf $(DIST_DIR)
