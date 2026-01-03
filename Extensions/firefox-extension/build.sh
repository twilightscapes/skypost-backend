#!/bin/bash

# Build script for Safari Web Extension local testing

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Floating Notes - Safari Extension Builder${NC}\n"

# Check if we're in the right directory
if [ ! -f "manifest.json" ]; then
    echo -e "${YELLOW}❌ manifest.json not found. Please run this script from the safari-extension directory.${NC}"
    exit 1
fi

# Create output directory
OUTPUT_DIR="dist"
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}📦 Copying files...${NC}"

# Copy all necessary files
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

echo -e "${BLUE}📋 Safari Extension Testing Instructions:${NC}\n"

echo -e "${YELLOW}Option 1: Using Safari Preferences (Easiest for local testing)${NC}"
echo "1. Open Safari"
echo "2. Go to Safari → Preferences → Advanced"
echo "3. Check 'Show Develop menu in menu bar'"
echo "4. Go to Develop → Allow Unsigned Extensions"
echo "5. Go to Develop → Manage Extensions"
echo "6. Click 'Allow' for Floating Notes"
echo ""

echo -e "${YELLOW}Option 2: Using Xcode (Recommended)${NC}"
echo "1. Open Xcode"
echo "2. File → New → Project"
echo "3. Choose 'Web Extension' template"
echo "4. Copy the dist folder contents into the Web Extension target"
echo "5. Press Cmd+R to build and test"
echo ""

echo -e "${YELLOW}Option 3: Quick Safari Test${NC}"
echo "1. Copy the entire 'dist' folder to a known location"
echo "2. Open Safari Web Inspector on any page"
echo "3. Load the extension manually via Develop menu"
echo ""

echo -e "${GREEN}✨ Build complete!${NC}"
echo -e "Extension ready in: ${BLUE}$OUTPUT_DIR/${NC}"
