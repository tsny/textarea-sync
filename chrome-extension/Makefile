NAME := textarea-sync-chrome
VERSION := $(shell awk -F'"' '/"version"/ { print $$4; exit }' manifest.json)
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(NAME)-$(VERSION).zip

EXTENSION_FILES := \
	manifest.json \
	service-worker.js \
	background.js \
	content.js \
	pastebin.js \
	document-storage.js \
	popup.html \
	popup.css \
	popup-form.js \
	popup.js

.PHONY: all package test clean

all: package

package: test | $(DIST_DIR)
	rm -f $(PACKAGE)
	zip -X -9 $(PACKAGE) $(EXTENSION_FILES)
	@echo "Built $(PACKAGE)"

test:
	python3 -m json.tool manifest.json >/dev/null
	node ../scripts/sync-extension-shared.mjs --check
	node ../extension-shared/document-storage.test.mjs
	node ../extension-shared/pastebin.test.mjs
	node ../extension-shared/background.test.mjs
	node ../extension-shared/popup-form.test.mjs
	node --check service-worker.js
	node --check background.js
	node --check content.js
	node --check pastebin.js
	node --check popup-form.js
	node --check popup.js
	node --check document-storage.js

$(DIST_DIR):
	mkdir -p $(DIST_DIR)

clean:
	rm -rf $(DIST_DIR)
