#!/bin/bash

# Build script for Firefox extension

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 SkyPost - Firefox Extension Builder${NC}\n"

# Check if we're in the right directory
if [ ! -f "manifest.json" ]; then
    echo -e "${YELLOW}❌ manifest.json not found. Please run this script from the firefox-extension directory.${NC}"
    exit 1
fi

# Create output directory
OUTPUT_DIR="dist"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}📦 Copying files...${NC}"

# Copy all necessary files for Firefox
cp manifest.json "$OUTPUT_DIR/"
cp content.js "$OUTPUT_DIR/"
cp background.js "$OUTPUT_DIR/"
cp customize.html "$OUTPUT_DIR/"
cp customize.js "$OUTPUT_DIR/"
cp workspace.html "$OUTPUT_DIR/"
cp workspace.js "$OUTPUT_DIR/"
cp backup.js "$OUTPUT_DIR/"
cp init.js "$OUTPUT_DIR/"
cp license.js "$OUTPUT_DIR/"
cp pro-settings.html "$OUTPUT_DIR/"

echo -e "${GREEN}✅ Files copied to $OUTPUT_DIR/${NC}\n"

# Create XPI (ZIP archive)
echo -e "${BLUE}📦 Creating XPI file...${NC}"
cd "$OUTPUT_DIR"
zip -r ../skypost-firefox.xpi . > /dev/null 2>&1
cd ..

echo -e "${GREEN}✅ XPI created: skypost-firefox.xpi${NC}\n"

echo -e "${BLUE}📋 Firefox Extension Installation:${NC}\n"
echo "1. Open Firefox"
echo "2. Go to about:debugging"
echo "3. Click 'This Firefox'"
echo "4. Click 'Load Temporary Add-on'"
echo "5. Select dist/manifest.json"
echo ""
echo "To test persistence:"
echo "- Create a note and log in to Bluesky"
echo "- Remove the extension (about:addons)"
echo "- Reinstall it (load from dist again)"
echo "- Your notes and session should still be there"
echo ""

echo -e "${GREEN}✨ Build complete!${NC}"
echo -e "Extension XPI: ${BLUE}skypost-firefox.xpi${NC}"
echo -e "Dev folder: ${BLUE}dist/${NC}"
