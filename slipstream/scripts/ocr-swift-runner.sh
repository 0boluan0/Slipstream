#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(/usr/bin/dirname "${BASH_SOURCE[0]}")" && /bin/pwd)"
SOURCE="$SCRIPT_DIR/VisionOCR.swift"
BUNDLED_BINARY="$SCRIPT_DIR/slipstream-ocr"

if [ $# -lt 1 ]; then
    /bin/echo '{"error":"No image path provided"}' >&2
    exit 1
fi

CACHE_DIR="${SLIPSTREAM_OCR_CACHE:?Missing SLIPSTREAM_OCR_CACHE}"
case "$CACHE_DIR" in
    /*) ;;
    *)
        /bin/echo '{"error":"OCR cache path must be absolute"}' >&2
        exit 1
        ;;
esac

if [ -x "$BUNDLED_BINARY" ]; then
    exec -- "$BUNDLED_BINARY" "$1"
fi

/bin/mkdir -p "$CACHE_DIR"
/bin/chmod 700 "$CACHE_DIR"
BINARY="$CACHE_DIR/slipstream-ocr"
VERSION_FILE="$CACHE_DIR/slipstream-ocr.version"

# Extract version from the Swift source
SOURCE_VERSION=$(/usr/bin/grep -o 'let OCR_VERSION = [0-9]*' "$SOURCE" | /usr/bin/grep -o '[0-9]*')
if [ -z "$SOURCE_VERSION" ]; then
    /bin/echo '{"error":"OCR source version is unavailable"}' >&2
    exit 1
fi

# Check if binary needs recompilation
NEEDS_COMPILE=0
if [ ! -f "$BINARY" ]; then
    NEEDS_COMPILE=1
elif [ ! -f "$VERSION_FILE" ]; then
    NEEDS_COMPILE=1
elif [ "$(/bin/cat "$VERSION_FILE")" != "$SOURCE_VERSION" ]; then
    /bin/echo "[runner] Version mismatch (cached: $(/bin/cat "$VERSION_FILE"), source: $SOURCE_VERSION), recompiling..." >&2
    NEEDS_COMPILE=1
fi

# Compile if needed
if [ "$NEEDS_COMPILE" -eq 1 ]; then
    /bin/echo "[runner] Compiling VisionOCR.swift (v${SOURCE_VERSION})..." >&2
    if ! /usr/bin/swiftc -o "$BINARY" "$SOURCE"; then
        /bin/echo '{"error":"Compilation failed"}' >&2
        exit 1
    fi
    /bin/echo "$SOURCE_VERSION" > "$VERSION_FILE"
    /bin/chmod 700 "$BINARY"
    /bin/chmod 600 "$VERSION_FILE"
fi

IMAGE_PATH="$1"

exec -- "$BINARY" "$IMAGE_PATH"
