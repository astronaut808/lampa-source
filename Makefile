.PHONY: test test-browser browser-install check

test:
	npm test -- --run

browser-install:
	npx playwright install chromium webkit

test-browser:
	sh scripts/test-browser.sh

check: test test-browser
