import * as fs from 'node:fs';
import * as path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findInstalledBrowser } from '../src/export/browser-finder.js';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const browserPath = findInstalledBrowser();
  if (!browserPath) {
    throw new Error('No installed browser found to render icon.png');
  }

  const svgPath = path.resolve(__dirname, '../media/icon.svg');
  const pngPath = path.resolve(__dirname, '../media/icon.png');
  const svgContent = fs.readFileSync(svgPath, 'utf-8');

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });

    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 256px; height: 256px; overflow: hidden; background: transparent; }
    svg { display: block; width: 256px; height: 256px; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({
      path: pngPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width: 256, height: 256 },
    });

    console.log(`Successfully generated ${pngPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
