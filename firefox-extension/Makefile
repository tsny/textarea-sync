NAME := textarea-sync-firefox
VERSION := $(shell awk -F'"' '/"version"/ { print $$4; exit }' manifest.json)
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(NAME)-$(VERSION).xpi

# Package from an allowlist so Finder metadata, tests, and source docs cannot
# accidentally end up in the submitted extension.
EXTENSION_FILES := \
	manifest.json \
	background.js \
	content.js \
	sync-storage.js \
	popup.html \
	popup.css \
	popup.js

.PHONY: all package test clean

all: package

package: test | $(DIST_DIR)
	rm -f $(PACKAGE)
	zip -X -9 $(PACKAGE) $(EXTENSION_FILES)
	@echo "Built $(PACKAGE)"

test:
	python3 -m json.tool manifest.json >/dev/null
	node sync-storage.test.mjs
	node --check background.js
	node --check content.js
	node --check popup.js
	node --check sync-storage.js

$(DIST_DIR):
	mkdir -p $(DIST_DIR)

clean:
	rm -rf $(DIST_DIR)
