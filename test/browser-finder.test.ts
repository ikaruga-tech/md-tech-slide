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
});
