import { describe, it, expect } from 'vitest';
import { sanitizeSvg, SanitizeSvgError } from '../src/diagram/svg-sanitizer.js';

describe('SVG Sanitizer (Multi-layer Defense)', () => {
  it('successfully sanitizes a well-formed SVG with viewBox', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <rect x="10" y="20" width="100" height="80" fill="#3b82f6" />
      <text x="20" y="40">Hello Mermaid</text>
    </svg>`;

    const result = sanitizeSvg(raw);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.aspectRatio).toBeCloseTo(800 / 600);
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 800, height: 600 });
    expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('synthesizes viewBox when only width and height are provided', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="300px">
      <circle cx="50" cy="50" r="40" fill="green" />
    </svg>`;

    const result = sanitizeSvg(raw);
    expect(result.viewBox).toEqual({ minX: 0, minY: 0, width: 400, height: 300 });
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('permits local fragment identifiers in href / xlink:href', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
      <use href="#my-node" />
      <use xlink:href="#another-node" />
    </svg>`;

    const result = sanitizeSvg(raw);
    expect(result.svg).toContain('href="#my-node"');
  });

  // 有害タグの拒否
  it.each([
    ['<script>alert(1)</script>'],
    [
      '<foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject>',
    ],
    ['<iframe src="https://evil.example.com"></iframe>'],
    ['<object data="test.swf"></object>'],
    ['<embed src="test.swf"></embed>'],
    ['<audio src="evil.mp3" autoplay="autoplay"></audio>'],
    ['<video src="evil.mp4"></video>'],
    ['<meta http-equiv="refresh" content="0;url=http://evil.example.com" />'],
  ])('rejects forbidden tag with mermaid-output-unsafe: %s', (forbiddenSnippet) => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${forbiddenSnippet}</svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  // イベントハンドラー属性の拒否
  it.each([
    ['onclick="alert(1)"'],
    ['onload="alert(1)"'],
    ['onmouseover="alert(1)"'],
    ['onerror="alert(1)"'],
    ['ONCLICK="alert(1)"'],
  ])('rejects event handler attribute with mermaid-output-unsafe: %s', (attr) => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ${attr}><rect width="10" height="10"/></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  // 外部URI・悪意あるプロトコルの拒否
  it.each([
    ['href="javascript:alert(1)"'],
    ['href="http://example.com"'],
    ['href="https://example.com"'],
    ['xlink:href="javascript:void(0)"'],
    ['action="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="'],
  ])('rejects dangerous URI attribute with mermaid-output-unsafe: %s', (attr) => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><a ${attr}><text>Click</text></a></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  // CSS インジェクションの拒否
  it.each([
    ['<style>rect { fill: url(https://evil.com/img.png); }</style>'],
    ['<style>@import "https://evil.com/style.css";</style>'],
    ['<style>div { width: expression(alert(1)); }</style>'],
    ['style="background: url(\'https://evil.com/leak\');"'],
    ['style="behavior: url(evil.htc);"'],
  ])('rejects dangerous CSS pattern with mermaid-output-unsafe: %s', (snippet) => {
    const raw = snippet.startsWith('<style>')
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${snippet}</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect ${snippet} width="10" height="10"/></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  // DTD / 実体参照の拒否
  it('rejects DOCTYPE declarations with mermaid-output-unsafe', () => {
    const raw = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  it('rejects ENTITY declarations with mermaid-output-unsafe', () => {
    const raw = `<!ENTITY xxe SYSTEM "file:///etc/passwd">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  // 資源上限検査
  it('rejects SVG exceeding 2MB byte limit', () => {
    const largePadding = ' '.repeat(2 * 1024 * 1024 + 10);
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><!--${largePadding}--></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-invalid-svg');
    }
  });

  it('rejects SVG exceeding maximum nesting depth (32)', () => {
    let deep = '<rect width="1" height="1"/>';
    for (let i = 0; i < 35; i++) {
      deep = `<g>${deep}</g>`;
    }
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${deep}</svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-invalid-svg');
    }
  });

  // 構造不備の検査
  it('rejects malformed XML syntax', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><unclosed-tag></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-invalid-svg');
    }
  });

  it('rejects multiple root elements', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-invalid-svg');
    }
  });

  // プレゼンテーション属性の url(...) 検査と安全性
  it.each([
    ['fill="url(https://evil.com/grad.svg#id)"'],
    ['stroke="url(//attacker.com/brush)"'],
    ['filter="url(data:image/svg+xml;base64,abc)"'],
    ['clip-path="url(\'http://leak.com/clip\')"'],
    ['mask=\'url("ftp://evil.com/mask")\''],
    ['cursor="url(https://evil.com/cursor.cur)"'],
    ['marker-start="url(//evil.com/m)"'],
    ['marker-end="url(javascript:alert(1))"'],
  ])('rejects non-local url in presentation attributes: %s', (attr) => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect ${attr} width="10" height="10"/></svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
    try {
      sanitizeSvg(raw);
    } catch (e: unknown) {
      expect((e as SanitizeSvgError).code).toBe('mermaid-output-unsafe');
    }
  });

  it('permits valid local fragment references in presentation attributes', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="grad1"><stop offset="0%" stop-color="red"/></linearGradient>
        <filter id="f1"><feGaussianBlur stdDeviation="2"/></filter>
      </defs>
      <rect fill="url(#grad1)" filter="url(#f1)" width="50" height="50"/>
    </svg>`;
    const result = sanitizeSvg(raw);
    expect(result.svg).toContain('fill="url(#grad1)"');
    expect(result.svg).toContain('filter="url(#f1)"');
  });

  it('rejects obfuscated non-local URLs with leading/trailing whitespace or mixed quotes', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <rect fill="  url(  'https://evil.com/test'  )  " width="10" height="10"/>
    </svg>`;
    expect(() => sanitizeSvg(raw)).toThrowError(SanitizeSvgError);
  });

  it('converts inline style="..." attributes to classes in <style> to eliminate style-src-attr violations', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g style="opacity: 0.8; fill: #ff0000;">
        <rect style="stroke: #00ff00;" width="10" height="10"/>
      </g>
    </svg>`;
    const result = sanitizeSvg(raw);
    expect(result.svg).not.toContain('style=');
    expect(result.svg).toContain('<style>');
    expect(result.svg).toContain('opacity: 0.8; fill: #ff0000;');
    expect(result.svg).toContain('stroke: #00ff00;');
    expect(result.svg).toMatch(/class="[^"]*svg-s-\d+[^"]*"/);
  });
});
