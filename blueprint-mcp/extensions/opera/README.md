# Blueprint MCP for Opera

Opera extension for Blueprint MCP - browser automation via Model Context Protocol.

## About

Opera is Chromium-based, so this extension uses the same source code as the Chrome extension. The only difference is the manifest.json which has Opera-specific branding.

## Building

```bash
cd extensions
node build-opera.js
```

This will:
1. Copy Chrome source files (background-module.js, content-script.js)
2. Copy shared modules
3. Use Opera's manifest.json (with "Blueprint MCP for Opera" branding)
4. Output to `dist/opera/`

## Installing

1. Build the extension: `node build-opera.js`
2. Open Opera and go to `opera://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `dist/opera/` directory

## Features

Same features as Chrome extension:
- Browser automation via MCP protocol
- Tab management and navigation
- Console and network monitoring
- Tech stack detection
- Screenshot capture
- And much more!

See main [FEATURES.md](../../FEATURES.md) for complete list.
