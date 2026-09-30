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
    throw new Error('No browser found');
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 340" width="600" height="340">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EA580C" />
    </linearGradient>
    <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#0284C7" />
    </linearGradient>
    <linearGradient id="purpleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#A855F7" />
      <stop offset="100%" stop-color="#7E22CE" />
    </linearGradient>
    <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#F43F5E" />
      <stop offset="100%" stop-color="#BE123C" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-10%" width="110%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.4" />
    </filter>
  </defs>

  <!-- Background Card -->
  <rect width="600" height="340" rx="16" fill="url(#bg)" stroke="#334155" stroke-width="2" />

  <!-- Title Header -->
  <text x="30" y="38" fill="#F8FAFC" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="700" font-size="16" letter-spacing="0.5">md-tech-slide Architecture Pipeline</text>
  <line x1="30" y1="52" x2="570" y2="52" stroke="#334155" stroke-width="1.5" />

  <!-- Node 1: Markdown Document -->
  <g filter="url(#shadow)" transform="translate(30, 130)">
    <rect width="130" height="80" rx="10" fill="#1E293B" stroke="#64748B" stroke-width="2" />
    <rect x="0" y="0" width="130" height="26" rx="10" fill="#334155" />
    <rect x="0" y="14" width="130" height="12" fill="#334155" />
    <text x="65" y="18" fill="#E2E8F0" font-family="-apple-system, sans-serif" font-weight="600" font-size="11" text-anchor="middle">Markdown Source</text>
    <text x="65" y="52" fill="#F97316" font-family="-apple-system, sans-serif" font-weight="700" font-size="13" text-anchor="middle">.md Document</text>
    <text x="65" y="68" fill="#94A3B8" font-family="monospace" font-size="10" text-anchor="middle">########, :::cols</text>
  </g>

  <!-- Arrow 1 -> 2 -->
  <path d="M 165 170 L 205 170" stroke="#F97316" stroke-width="2.5" stroke-linecap="round" />
  <polygon points="203,165 213,170 203,175" fill="#F97316" />

  <!-- Node 2: Core Parser & Slide IR -->
  <g filter="url(#shadow)" transform="translate(215, 120)">
    <rect width="140" height="100" rx="10" fill="#1E293B" stroke="#F97316" stroke-width="2.5" />
    <rect x="0" y="0" width="140" height="28" rx="10" fill="url(#primaryGrad)" />
    <rect x="0" y="16" width="140" height="12" fill="url(#primaryGrad)" />
    <text x="70" y="20" fill="#FFFFFF" font-family="-apple-system, sans-serif" font-weight="700" font-size="12" text-anchor="middle">Core Engine</text>
    <text x="70" y="56" fill="#F8FAFC" font-family="-apple-system, sans-serif" font-weight="700" font-size="14" text-anchor="middle">Slide IR</text>
    <text x="70" y="74" fill="#CBD5E1" font-family="-apple-system, sans-serif" font-size="11" text-anchor="middle">Unified Intermediate Model</text>
    <text x="70" y="90" fill="#94A3B8" font-family="monospace" font-size="10" text-anchor="middle">Slots / Grid / Tokens</text>
  </g>

  <!-- Branches from Node 2 -->
  <!-- Top Branch: PPTX -->
  <path d="M 360 150 Q 395 150 415 95" fill="none" stroke="#F97316" stroke-width="2" stroke-linecap="round" />
  <polygon points="410,95 422,90 417,102" fill="#F97316" />

  <!-- Middle Branch: Webview -->
  <path d="M 360 170 L 415 170" fill="none" stroke="#38BDF8" stroke-width="2" stroke-linecap="round" />
  <polygon points="413,165 423,170 413,175" fill="#38BDF8" />

  <!-- Bottom Branch: PDF -->
  <path d="M 360 190 Q 395 190 415 245" fill="none" stroke="#F43F5E" stroke-width="2" stroke-linecap="round" />
  <polygon points="417,238 422,250 410,245" fill="#F43F5E" />

  <!-- Node 3A: PowerPoint PPTX -->
  <g filter="url(#shadow)" transform="translate(425, 60)">
    <rect width="145" height="60" rx="8" fill="#1E293B" stroke="#F97316" stroke-width="2" />
    <rect x="0" y="0" width="145" height="22" rx="8" fill="#EA580C" />
    <rect x="0" y="12" width="145" height="10" fill="#EA580C" />
    <text x="72" y="16" fill="#FFFFFF" font-family="-apple-system, sans-serif" font-weight="700" font-size="10" text-anchor="middle">PptxGenJS + Shiki</text>
    <text x="72" y="44" fill="#F8FAFC" font-family="-apple-system, sans-serif" font-weight="700" font-size="12" text-anchor="middle">PowerPoint (.pptx)</text>
  </g>

  <!-- Node 3B: Webview Preview -->
  <g filter="url(#shadow)" transform="translate(425, 140)">
    <rect width="145" height="60" rx="8" fill="#1E293B" stroke="#0284C7" stroke-width="2" />
    <rect x="0" y="0" width="145" height="22" rx="8" fill="#0284C7" />
    <rect x="0" y="12" width="145" height="10" fill="#0284C7" />
    <text x="72" y="16" fill="#FFFFFF" font-family="-apple-system, sans-serif" font-weight="700" font-size="10" text-anchor="middle">SlideHtmlRenderer</text>
    <text x="72" y="44" fill="#F8FAFC" font-family="-apple-system, sans-serif" font-weight="700" font-size="12" text-anchor="middle">Live Webview Panel</text>
  </g>

  <!-- Node 3C: PDF Exporter -->
  <g filter="url(#shadow)" transform="translate(425, 220)">
    <rect width="145" height="60" rx="8" fill="#1E293B" stroke="#BE123C" stroke-width="2" />
    <rect x="0" y="0" width="145" height="22" rx="8" fill="#BE123C" />
    <rect x="0" y="12" width="145" height="10" fill="#BE123C" />
    <text x="72" y="16" fill="#FFFFFF" font-family="-apple-system, sans-serif" font-weight="700" font-size="10" text-anchor="middle">puppeteer-core</text>
    <text x="72" y="44" fill="#F8FAFC" font-family="-apple-system, sans-serif" font-weight="700" font-size="12" text-anchor="middle">Slide PDF (.pdf)</text>
  </g>
</svg>`;

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 340, deviceScaleFactor: 2 });
    await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent;">${svg}</body></html>`, { waitUntil: 'load' });

    const targetPaths = [
      path.resolve(__dirname, '../examples/images/architecture.png'),
      path.resolve(__dirname, '../../misc/examples/images/architecture.png'),
      path.resolve(__dirname, '../test/fixtures/images/architecture.png'),
    ];

    for (const p of targetPaths) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      await page.screenshot({ path: p, omitBackground: true });
      console.log('Generated architecture image at:', p);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
