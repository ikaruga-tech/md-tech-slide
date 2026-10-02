import { describe, it, expect, vi, beforeEach } from 'vitest';
import puppeteer from 'puppeteer-core';
import { parseMarkdownToSlideDeck } from '../src/parser/index.js';
import { exportDeckToPdf } from '../src/export/pdf-exporter.js';

vi.mock('puppeteer-core', () => {
  return {
    default: {
      launch: vi.fn(),
    },
  };
});

vi.mock('../src/export/browser-finder.js', () => {
  return {
    findInstalledBrowser: vi.fn(),
  };
});

describe('export-unit tests (mocked puppeteer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an error if no browser executable is found or specified', async () => {
    const { findInstalledBrowser } = await import('../src/export/browser-finder.js');
    vi.mocked(findInstalledBrowser).mockReturnValue(undefined);

    const deck = parseMarkdownToSlideDeck('# Test');
    await expect(exportDeckToPdf(deck, '/tmp/path.pdf')).rejects.toThrow(
      'Google Chrome or Microsoft Edge was not found'
    );
  });

  it('launches puppeteer and exports PDF with exact 16:9 dimensions', async () => {
    const mockPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4'));
    const mockSetContent = vi.fn().mockResolvedValue(undefined);
    const mockSetViewport = vi.fn().mockResolvedValue(undefined);
    const mockClosePage = vi.fn().mockResolvedValue(undefined);

    const mockPage = {
      setViewport: mockSetViewport,
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockClosePage,
    };

    const mockCloseBrowser = vi.fn().mockResolvedValue(undefined);
    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: mockCloseBrowser,
    };

    vi.mocked(puppeteer.launch).mockResolvedValue(
      mockBrowser as unknown as ReturnType<typeof puppeteer.launch>
    );

    const deck = parseMarkdownToSlideDeck(`---
title: "Unit Test Deck"
aspectRatio: "16:9"
---
# Slide 1
Content`);

    const tempOutputPath = '/tmp/md-tech-slide-unit-test.pdf';
    await exportDeckToPdf(deck, tempOutputPath, { browserPath: '/mock/browser' });

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: '/mock/browser',
        headless: true,
      })
    );

    expect(mockSetViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1366,
        height: 768,
      })
    );

    expect(mockSetContent).toHaveBeenCalledWith(
      expect.stringContaining('Slide 1'),
      expect.objectContaining({ waitUntil: 'load' })
    );

    expect(mockPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        path: tempOutputPath,
        width: '13.333in',
        height: '7.5in',
        printBackground: true,
      })
    );

    expect(mockCloseBrowser).toHaveBeenCalled();
  });

  it('configures 4:3 dimensions correctly when requested', async () => {
    const mockPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4'));
    const mockSetContent = vi.fn().mockResolvedValue(undefined);
    const mockSetViewport = vi.fn().mockResolvedValue(undefined);

    const mockPage = {
      setViewport: mockSetViewport,
      setContent: mockSetContent,
      pdf: mockPdf,
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(puppeteer.launch).mockResolvedValue(
      mockBrowser as unknown as ReturnType<typeof puppeteer.launch>
    );

    const deck = parseMarkdownToSlideDeck(`---
title: "Unit Test 4:3"
aspectRatio: "4:3"
---
# Slide 1`);

    await exportDeckToPdf(deck, '/tmp/test4x3.pdf', { browserPath: '/mock/browser' });

    expect(mockSetViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1024,
        height: 768,
      })
    );

    expect(mockPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        width: '10in',
        height: '7.5in',
      })
    );
  });
});
