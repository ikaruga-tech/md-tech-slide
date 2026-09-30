import puppeteer from 'puppeteer-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SlideDeck } from '../types/ir.js';
import { renderDeckToHtml } from '../renderer/index.js';
import { findInstalledBrowser } from './browser-finder.js';

export interface PdfExportOptions {
  readonly baseDir?: string;
  readonly browserPath?: string;
}

export async function exportDeckToPdf(
  deck: SlideDeck,
  outputPath: string,
  options?: PdfExportOptions
): Promise<void> {
  const browserPath = options?.browserPath || findInstalledBrowser();
  if (!browserPath) {
    throw new Error(
      'Google Chrome or Microsoft Edge was not found on this system. ' +
      'Please install Chrome or Edge to export PDF, or set the PUPPETEER_EXECUTABLE_PATH environment variable.'
    );
  }

  const is4x3 = deck.metadata.aspectRatio === '4:3';
  const widthIn = is4x3 ? '10in' : '13.333in';
  const heightIn = '7.5in';

  const baseHtml = renderDeckToHtml(deck, { baseDir: options?.baseDir });

  // PDF出力専用のページサイズ・改ページCSSを注入
  const printCss = `
  <style>
    @page {
      size: ${widthIn} ${heightIn};
      margin: 0;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: transparent !important;
      gap: 0 !important;
      display: block !important;
    }
    .slide-container {
      width: ${widthIn} !important;
      height: ${heightIn} !important;
      max-width: none !important;
      page-break-after: always !important;
      break-after: page !important;
      padding: 0 !important;
      gap: 0 !important;
      overflow: hidden !important;
    }
    .slide-card {
      width: 100% !important;
      height: 100% !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      border: none !important;
      transform: none !important;
    }
    .speaker-note-details {
      display: none !important;
    }
  </style>
  `;

  const printHtml = baseHtml.replace('</head>', `${printCss}</head>`);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: is4x3 ? 1024 : 1366,
      height: 768,
      deviceScaleFactor: 2,
    });

    await page.setContent(printHtml, {
      waitUntil: 'load',
    });

    await page.pdf({
      path: outputPath,
      width: widthIn,
      height: heightIn,
      printBackground: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });
  } finally {
    await browser.close();
  }
}
