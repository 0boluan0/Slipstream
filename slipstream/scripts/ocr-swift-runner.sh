#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/VisionOCR.swift"
BUNDLED_BINARY="$SCRIPT_DIR/slipstream-ocr"

if [ -x "$BUNDLED_BINARY" ]; then
    if [ $# -lt 1 ]; then
        echo '{"error":"No image path provided"}' >&2
        exit 1
    fi
    exec "$BUNDLED_BINARY" "$1"
fi

CACHE_DIR="${SLIPSTREAM_OCR_CACHE:?Missing SLIPSTREAM_OCR_CACHE}"
mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR"
BINARY="$CACHE_DIR/slipstream-ocr"
VERSION_FILE="$CACHE_DIR/slipstream-ocr.version"

# Extract version from the Swift source
SOURCE_VERSION=$(grep -o 'let OCR_VERSION = [0-9]*' "$SOURCE" | grep -o '[0-9]*')

# Check if binary needs recompilation
NEEDS_COMPILE=0
if [ ! -f "$BINARY" ]; then
    NEEDS_COMPILE=1
elif [ ! -f "$VERSION_FILE" ]; then
    NEEDS_COMPILE=1
elif [ "$(cat "$VERSION_FILE")" != "$SOURCE_VERSION" ]; then
    echo "[runner] Version mismatch (cached: $(cat "$VERSION_FILE"), source: $SOURCE_VERSION), recompiling..." >&2
    NEEDS_COMPILE=1
fi

# Compile if needed
if [ "$NEEDS_COMPILE" -eq 1 ]; then
    echo "[runner] Compiling VisionOCR.swift (v${SOURCE_VERSION})..." >&2
    swiftc -o "$BINARY" "$SOURCE"
    if [ $? -ne 0 ]; then
        echo '{"error":"Compilation failed"}' >&2
        exit 1
    fi
    echo "$SOURCE_VERSION" > "$VERSION_FILE"
    chmod 700 "$BINARY"
    chmod 600 "$VERSION_FILE"
fi

# Validate argument
if [ $# -lt 1 ]; then
    echo '{"error":"No image path provided"}' >&2
    exit 1
fi

IMAGE_PATH="$1"

"$BINARY" "$IMAGE_PATH"
