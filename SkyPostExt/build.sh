#!/bin/bash

# Build script for SkyPost - packages both Chrome (MV3) and Firefox (MV2) versions
# Usage: ./build.sh [chrome|firefox|all]

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE_DIR="$SCRIPT_DIR/dist"
CHROME_DIR="$SCRIPT_DIR/dist"
FIREFOX_DIR="$SCRIPT_DIR/FIREFOX"
MANIFESTS_DIR="$SCRIPT_DIR/manifests"

echo "🏗️  SkyPost Build System"
echo "========================"

# Create manifests directory if it doesn't exist
mkdir -p "$MANIFESTS_DIR"

# Build Chrome (MV3) version
build_chrome() {
  echo ""
  echo "📦 Building Chrome version (MV3)..."
  
  # Copy MV3 manifest to dist/
  cp "$MANIFESTS_DIR/manifest-v3.json" "$CHROME_DIR/manifest.json"
  
  # Remove any XPI file if it exists
  rm -f "$CHROME_DIR/skypost.zip" 2>/dev/null || true
  
  # Create zip for Chrome Store
  cd "$CHROME_DIR"
  zip -r -q skypost.zip * -x "*.DS_Store" "skypost.xpi" "package.sh"
  
  echo "✅ Chrome version built: $CHROME_DIR/skypost.zip"
}

# Build Firefox (MV2) version
build_firefox() {
  echo ""
  echo "📦 Building Firefox version (MV2)..."
  
  # Full sync from dist/ to FIREFOX/ - use --checksum to detect actual changes, not just timestamps
  rsync -av --checksum --delete --exclude='manifest.json' --exclude='skypost.xpi' --exclude='skypost.zip' "$SOURCE_DIR/" "$FIREFOX_DIR/"
  
  # Ensure MV2 manifest is in FIREFOX/
  cp "$MANIFESTS_DIR/manifest-v2.json" "$FIREFOX_DIR/manifest.json"
  
  # Remove any zip file if it exists
  rm -f "$FIREFOX_DIR/skypost.zip" 2>/dev/null || true
  
  # Create XPI for Firefox
  cd "$FIREFOX_DIR"
  zip -r -q skypost.xpi * -x "*.DS_Store" "skypost.zip" "package.sh"
  
  echo "✅ Firefox version built: $FIREFOX_DIR/skypost.xpi"
}

# Main logic
case "${1:-all}" in
  chrome)
    build_chrome
    ;;
  firefox)
    build_firefox
    ;;
  all)
    build_chrome
    build_firefox
    ;;
  *)
    echo "Usage: $0 [chrome|firefox|all]"
    exit 1
    ;;
esac

echo ""
echo "✨ Build complete!"
