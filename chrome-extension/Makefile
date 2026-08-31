NAME := textarea-sync-chrome
VERSION := $(shell awk -F'"' '/"version"/ { print $$4; exit }' manifest.json)
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(NAME)-$(VERSION).zip
STAGE_DIR := $(DIST_DIR)/stage

EXTENSION_FILES := \
	manifest.json \
	service-worker.js \
	background.js \
	content.js \
	gist.js \
	document-storage.js \
	popup.html \
	popup.css \
	popup-form.js \
	popup.js

.PHONY: all package test clean

all: package

package: test | $(DIST_DIR)
	rm -rf $(STAGE_DIR)
	mkdir -p $(STAGE_DIR)
	cp $(EXTENSION_FILES) $(STAGE_DIR)/
	python3 -c "import json,collections; p='$(STAGE_DIR)/manifest.json'; m=json.load(open(p), object_pairs_hook=collections.OrderedDict); m.pop('key', None); json.dump(m, open(p,'w'), indent=2)"
	rm -f $(PACKAGE)
	cd $(STAGE_DIR) && zip -X -9 ../$(NAME)-$(VERSION).zip $(EXTENSION_FILES)
	rm -rf $(STAGE_DIR)
	@echo "Built $(PACKAGE)"

test:
	python3 -m json.tool manifest.json >/dev/null
	node ../scripts/sync-extension-shared.mjs --check
	node ../extension-shared/document-storage.test.mjs
	node ../extension-shared/gist.test.mjs
	node ../extension-shared/background.test.mjs
	node ../extension-shared/popup-form.test.mjs
	node --check service-worker.js
	node --check background.js
	node --check content.js
	node --check gist.js
	node --check popup-form.js
	node --check popup.js
	node --check document-storage.js

$(DIST_DIR):
	mkdir -p $(DIST_DIR)

clean:
	rm -rf $(DIST_DIR)
