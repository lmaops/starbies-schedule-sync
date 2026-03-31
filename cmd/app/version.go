package main

// Injected at build time via -ldflags "-X main.CommitSHA=... -X main.CommitURL=..."
var (
	CommitSHA = "dev"
	CommitURL = ""
)
