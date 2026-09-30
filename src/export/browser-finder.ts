import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function getCandidatePaths(): readonly string[] {
  const platform = process.platform;
  const home = os.homedir();

  // 環境変数が指定されている場合は最優先
  const envPath = process.env['PUPPETEER_EXECUTABLE_PATH'] || process.env['CHROME_PATH'];
  const candidates: string[] = [];

  if (envPath && envPath.trim().length > 0) {
    candidates.push(envPath.trim());
  }

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')
    );
  } else if (platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');

    candidates.push(
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else {
    // Linux and others
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium'
    );
  }

  return candidates;
}

export function findInstalledBrowser(): string | null {
  const candidates = getCandidatePaths();

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // アクセス権限等の例外は無視して次を探索
      continue;
    }
  }

  return null;
}
