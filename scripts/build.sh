#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD_ROOT="${FOLIO_BUILD_DIR:-${TMPDIR:-/tmp}/folio-build}"
APP="$BUILD_ROOT/Folio.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mkdir -p "$APP/Contents/Resources/web"
for file in index.html style.css bundle.js; do cp -X "build/web/$file" "$APP/Contents/Resources/web/$file"; done
swiftc -target arm64-apple-macosx14.0 Sources/Folio.swift -o "$APP/Contents/MacOS/Folio" -framework Cocoa -framework WebKit -module-cache-path "$BUILD_ROOT/module-cache"
cp -X Info.plist "$APP/Contents/Info.plist"
cp -X THIRD-PARTY-LICENSES.txt "$APP/Contents/Resources/THIRD-PARTY-LICENSES.txt"
if [ -f AppIcon.icns ]; then cp -X AppIcon.icns "$APP/Contents/Resources/"; fi
codesign --force --deep --sign - "$APP"
mkdir -p dist
ditto -c -k --keepParent --norsrc "$APP" "$PWD/dist/Folio.zip"
echo "Built: $APP and dist/Folio.zip"
