/**
 * Post-tsc build step — copies non-TS files to dist/
 * Chrome loads from the extension root, pointing at dist/ for JS
 */

const fs = require('fs');
const path = require('path');

// Nothing else to copy for now — manifest.json, popup/, icons/ are at extension root
// tsc outputs .js files to dist/ which manifest.json references

console.log('Build complete — extension ready to load from extension/');
