#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="/tmp/slipstream-ocr"

# 1. Compile if binary doesn't exist
if [ ! -f "$BINARY" ]; then
    echo "[runner] Compiling VisionOCR.swift..." >&2
    swiftc -o "$BINARY" "$SCRIPT_DIR/VisionOCR.swift"
    if [ $? -ne 0 ]; then
        echo '{"error":"Compilation failed"}' >&2
        exit 1
    fi
fi

# 2. Validate argument
if [ $# -lt 1 ]; then
    echo '{"error":"No image path provided"}' >&2
    exit 1
fi

IMAGE_PATH="$1"

# 3. Run with 10-second timeout
timeout 10 "$BINARY" "$IMAGE_PATH"
EXIT_CODE=$?

# 4. Exit with binary's exit code
exit $EXIT_CODE
