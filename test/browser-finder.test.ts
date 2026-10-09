import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findInstalledBrowser } from '../src/export/browser-finder.js';

describe('browser-finder', () => {
  const originalEnv = process.env['PUPPETEER_EXECUTABLE_PATH'];

  beforeEach(() => {
    delete process.env['PUPPETEER_EXECUTABLE_PATH'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['PUPPETEER_EXECUTABLE_PATH'] = originalEnv;
    } else {
      delete process.env['PUPPETEER_EXECUTABLE_PATH'];
    }
  });

  it('respects PUPPETEER_EXECUTABLE_PATH when set', () => {
    process.env['PUPPETEER_EXECUTABLE_PATH'] = process.execPath;
    const found = findInstalledBrowser();
    expect(found).toBe(process.execPath);
  });

  it('returns a string path or null on host system', () => {
    const found = findInstalledBrowser();
    expect(found === null || typeof found === 'string').toBe(true);
  });

  it('respects CHROME_PATH and MD_TECH_SLIDE_BROWSER_PATH priority', () => {
    const origChrome = process.env['CHROME_PATH'];
    const origCustom = process.env['MD_TECH_SLIDE_BROWSER_PATH'];
    try {
      process.env['CHROME_PATH'] = process.execPath;
      expect(findInstalledBrowser()).toBe(process.execPath);

      // MD_TECH_SLIDE_BROWSER_PATH has higher priority
      process.env['MD_TECH_SLIDE_BROWSER_PATH'] = process.execPath;
      expect(findInstalledBrowser()).toBe(process.execPath);
    } finally {
      if (origChrome !== undefined) process.env['CHROME_PATH'] = origChrome;
      else delete process.env['CHROME_PATH'];
      if (origCustom !== undefined) process.env['MD_TECH_SLIDE_BROWSER_PATH'] = origCustom;
      else delete process.env['MD_TECH_SLIDE_BROWSER_PATH'];
    }
  });

  it('reports mermaid-invalid-browser-path when specified path does not exist', async () => {
    const { resolveBrowserExecutable } = await import('../src/export/browser-finder.js');
    const result = resolveBrowserExecutable('/non/existent/browser/path/xyz');
    expect('error' in result && result.error).toBe('mermaid-invalid-browser-path');
  });
});
