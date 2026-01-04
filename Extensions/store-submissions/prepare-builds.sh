#!/bin/bash

# SkyPost Store Submission Build Script
# Organizes builds for submission to Firefox, Chrome, and Safari

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/.."
SUBMISSIONS_DIR="$SCRIPT_DIR"

# Get version from manifest
VERSION=$(grep -o '"version": "[^"]*"' "$PROJECT_ROOT/firefox-extension/manifest.json" | head -1 | sed 's/"version": "\(.*\)"/\1/')

echo "📦 SkyPost Store Submission Builder v$VERSION"
echo "================================================"

# Create directories if they don't exist
mkdir -p "$SUBMISSIONS_DIR/firefox"
mkdir -p "$SUBMISSIONS_DIR/chrome"
mkdir -p "$SUBMISSIONS_DIR/safari"

# ============================================================================
# Firefox - Copy XPI
# ============================================================================
echo ""
echo "🦊 Preparing Firefox Build..."

if [ -f "$PROJECT_ROOT/firefox-extension/skypost-firefox.xpi" ]; then
    cp "$PROJECT_ROOT/firefox-extension/skypost-firefox.xpi" \
       "$SUBMISSIONS_DIR/firefox/skypost-v$VERSION.xpi"
    echo "✓ Firefox XPI copied to: firefox/skypost-v$VERSION.xpi"
else
    echo "⚠ Firefox XPI not found. Make sure to run build-firefox.sh first"
fi

# ============================================================================
# Chrome - Create ZIP from Safari dist (Chrome uses same code as Safari)
# ============================================================================
echo ""
echo "🎨 Preparing Chrome Build..."

if [ -d "$PROJECT_ROOT/safari-extension-pro/dist" ]; then
    cd "$PROJECT_ROOT/safari-extension-pro/dist"
    zip -r -q "$SUBMISSIONS_DIR/chrome/skypost-v$VERSION.zip" . || true
    cd - > /dev/null
    echo "✓ Chrome ZIP created: chrome/skypost-v$VERSION.zip"
    echo "  (Contains all extension files - ready for Web Store upload)"
else
    echo "⚠ Safari dist directory not found. Make sure to run build.sh first"
fi

# ============================================================================
# Safari - Instructions
# ============================================================================
echo ""
echo "🍎 Safari Preparation (Requires Manual Setup)..."
echo ""
echo "Safari requires a macOS app bundle. Follow these steps:"
echo ""
echo "1. Copy your extension files to an app bundle:"
echo "   mkdir -p SkyPost.app/Contents/Resources"
echo "   cp -r safari-extension-pro/dist/* SkyPost.app/Contents/Resources/"
echo ""
echo "2. Create required files (see SAFARI_DETAILED_GUIDE.md)"
echo ""
echo "3. Code sign the app:"
echo "   codesign --deep --force --sign - SkyPost.app"
echo ""
echo "4. Notarize:"
echo "   ditto -c -k --sequesterRsrc SkyPost.app SkyPost-v$VERSION.zip"
echo "   xcrun notarytool submit SkyPost-v$VERSION.zip --apple-id your@email.com"
echo ""
echo "See safari/SAFARI_DETAILED_GUIDE.md for complete instructions"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "================================================"
echo "✅ Build Organization Complete!"
echo "================================================"
echo ""
echo "📍 Firefox:"
echo "   File: store-submissions/firefox/skypost-v$VERSION.xpi"
echo "   Action: Upload to https://addons.mozilla.org"
echo ""
echo "📍 Chrome:"
echo "   File: store-submissions/chrome/skypost-v$VERSION.zip"
echo "   Action: Upload to https://chrome.google.com/webstore/devconsole"
echo ""
echo "📍 Safari:"
echo "   Folder: store-submissions/safari/"
echo "   Read: store-submissions/safari/SAFARI_DETAILED_GUIDE.md"
echo "   Action: Follow manual setup steps for app bundling & code signing"
echo ""
echo "================================================"
echo "📚 Documentation:"
echo "   - store-submissions/SUBMISSION_GUIDE.md"
echo "   - store-submissions/SUBMISSION_CHECKLIST.md"
echo "   - store-submissions/safari/SAFARI_DETAILED_GUIDE.md"
echo ""
echo "Next steps:"
echo "1. Review store listing requirements"
echo "2. Prepare marketing assets (icons, screenshots)"
echo "3. Create store accounts if not already done"
echo "4. Submit in order: Firefox → Chrome → Safari"
echo ""
