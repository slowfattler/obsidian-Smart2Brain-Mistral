#!/bin/bash

# Build and install script for Obsidian Mistral Assistant Plugin

echo "🔧 Building Mistral Assistant Plugin..."

# Clean up previous builds
rm -f main.js
rm -rf dist

# Install dependencies and build
npm install
npm run build

# Check if build succeeded
if [ ! -f "dist/main.js" ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build successful!"

# Copy built file to root
cp dist/main.js .
rm -rf dist

echo ""
echo "📁 Plugin files ready:"
echo "   - main.js"
echo "   - styles.css"
echo "   - manifest.json"
echo ""
echo "📝 To install in Obsidian:"
echo "   1. Copy main.js, styles.css, and manifest.json to:"
echo "      .obsidian/plugins/obsidian-mistral-assistant/"
echo "   2. Enable the plugin in Obsidian Settings → Community plugins"
