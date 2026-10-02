import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveLocalResource,
  getAllowedResourceRoots,
  ResourceNotFoundError,
  ResourceAccessDeniedError,
  UnsupportedResourceFormatError,
  ResourceTooLargeError,
} from '../src/resource/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('resource-resolver', () => {
  const fixturesDir = path.join(__dirname, 'fixtures');
  const sampleMdPath = path.join(fixturesDir, 'sample.md');
  const architectureImg = path.join(fixturesDir, 'images', 'architecture.png');

  it('resolves existing relative image path within allowed roots', () => {
    const resolved = resolveLocalResource({
      sourceMarkdownPath: sampleMdPath,
      resourcePath: './images/architecture.png',
      allowedRoots: [fixturesDir],
    });

    expect(resolved.absolutePath).toBe(architectureImg);
    expect(resolved.mimeType).toBe('image/png');
    expect(resolved.extension).toBe('.png');
    expect(resolved.sizeBytes).toBeGreaterThan(100);
    expect(resolved.toDataUri()).toContain('data:image/png;base64,');
  });

  it('throws ResourceNotFoundError when local file does not exist', () => {
    expect(() =>
      resolveLocalResource({
        sourceMarkdownPath: sampleMdPath,
        resourcePath: './non-existent.png',
        allowedRoots: [fixturesDir],
      })
    ).toThrow(ResourceNotFoundError);
  });

  it('throws ResourceAccessDeniedError when path escapes allowed root via traversal', () => {
    expect(() =>
      resolveLocalResource({
        sourceMarkdownPath: sampleMdPath,
        resourcePath: '../../package.json',
        allowedRoots: [fixturesDir],
        allowedExtensions: ['.json'],
      })
    ).toThrow(ResourceAccessDeniedError);
  });

  it('throws UnsupportedResourceFormatError when extension is not allowed', () => {
    expect(() =>
      resolveLocalResource({
        sourceMarkdownPath: sampleMdPath,
        resourcePath: './sample.md',
        allowedRoots: [fixturesDir],
      })
    ).toThrow(UnsupportedResourceFormatError);
  });

  it('rejects remote HTTP URLs and data URIs from local resource resolution', () => {
    expect(() =>
      resolveLocalResource({
        resourcePath: 'https://example.com/test.png',
      })
    ).toThrow(ResourceAccessDeniedError);

    expect(() =>
      resolveLocalResource({
        resourcePath: 'data:image/png;base64,1234',
      })
    ).toThrow(ResourceAccessDeniedError);
  });

  it('throws ResourceTooLargeError when file size exceeds limit', () => {
    expect(() =>
      resolveLocalResource({
        sourceMarkdownPath: sampleMdPath,
        resourcePath: './images/architecture.png',
        allowedRoots: [fixturesDir],
        maxSizeBytes: 10, // 10 bytes limit
      })
    ).toThrow(ResourceTooLargeError);
  });

  it('computes unified allowed roots combining markdown dir and workspace folders', () => {
    const roots = getAllowedResourceRoots(sampleMdPath, [fixturesDir, path.join(__dirname, '..')]);
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(roots.some((r) => r.includes('fixtures'))).toBe(true);
  });
});
