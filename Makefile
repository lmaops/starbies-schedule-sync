BINARY      := bin/app
STATIC_DIR  := cmd/app/static
WEB_DIR     := web
SCRAPER_DIR := scraper

.PHONY: all build build-web build-app build-scraper test clean

all: build

# full production build
build: build-web build-app

# compile frontend and copy into the go embed directory
build-web:
	cd $(WEB_DIR) && npm ci && npm run build
	rm -rf $(STATIC_DIR)
	cp -r $(WEB_DIR)/dist $(STATIC_DIR)

# compile go binary (requires build-web to have been run first)
build-app:
	mkdir -p bin
	go build -o $(BINARY) ./cmd/app

# build the scraper container image
build-scraper:
	docker build -t sbuxsync-scraper-module:latest $(SCRAPER_DIR)

test:
	go test ./...

clean:
	rm -rf bin $(STATIC_DIR) $(WEB_DIR)/dist
