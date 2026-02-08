package main

import "embed"

// StaticFS holds the embedded Vue app (gateway/static/ filled at build from frontend/dist).
// For local dev without embed, set STATIC_DIR e.g. to ../frontend/dist.
//go:embed static
var StaticFS embed.FS
