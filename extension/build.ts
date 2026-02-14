/**
 * Post-tsc build step — copies static assets (HTML, CSS, PNG) from src/ to dist/
 * Preserves directory structure so manifest references work correctly.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __buildDir = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__buildDir, 'src');
const DIST_DIR = path.resolve(__buildDir, 'dist');

const ASSET_EXTENSIONS = new Set(['.html', '.css', '.png']);

function copyAssets(dir: string): number {
  let copied = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const srcPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      copied += copyAssets(srcPath);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!ASSET_EXTENSIONS.has(ext)) continue;

    const relativePath = path.relative(SRC_DIR, srcPath);
    const destPath = path.join(DIST_DIR, relativePath);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    console.log(`  ${relativePath}`);
    copied++;
  }

  return copied;
}

console.log('Copying static assets to dist/:');
const count = copyAssets(SRC_DIR);
console.log(`\n${count} asset(s) copied. Build complete.`);
