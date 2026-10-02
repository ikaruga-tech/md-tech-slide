import { Browser, computeExecutablePath } from '@puppeteer/browsers';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildId = process.env.CHROME_BUILD_ID || '128.0.6613.119';
const cacheDir = process.env.CHROME_CACHE_DIR || path.resolve(__dirname, '../.cache/chrome');

try {
  const executablePath = computeExecutablePath({
    cacheDir,
    browser: Browser.CHROME,
    buildId,
  });
  console.log(executablePath);
} catch (err) {
  console.error('Failed to resolve Chrome executable path:', err);
  process.exit(1);
}
