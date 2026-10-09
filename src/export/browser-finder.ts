import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function getOsCandidatePaths(): readonly string[] {
  const platform = process.platform;
  const home = os.homedir();
  const candidates: string[] = [];

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

export function isExecutableFile(targetPath: string): boolean {
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      return false;
    }

    if (process.platform === 'win32') {
      const ext = path.extname(targetPath).toLowerCase();
      return ext === '.exe' || ext === '.cmd' || ext === '.bat';
    }

    // POSIX
    fs.accessSync(targetPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findInstalledBrowser(): string | null {
  const envCandidates = [
    process.env['MD_TECH_SLIDE_BROWSER_PATH'],
    process.env['PUPPETEER_EXECUTABLE_PATH'],
    process.env['CHROME_PATH'],
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);

  for (const envPath of envCandidates) {
    const trimmed = envPath.trim();
    if (isExecutableFile(trimmed)) {
      return trimmed;
    }
  }

  const osCandidates = getOsCandidatePaths();
  for (const candidate of osCandidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

export type BrowserResolutionResult =
  | { readonly executablePath: string }
  | {
      readonly error: 'mermaid-invalid-browser-path' | 'mermaid-browser-not-found';
      readonly message: string;
    };

/**
 * Resolves browser executable according to priority:
 * 1. MD_TECH_SLIDE_BROWSER_PATH
 * 2. PUPPETEER_EXECUTABLE_PATH
 * 3. CHROME_PATH
 * 4. configPath (mdTechSlide.browserPath)
 * 5. fallbackConfigPath (mdTechSlide.export.browserPath)
 * 6. findInstalledBrowser()
 */
export function resolveBrowserExecutable(
  configPath?: string,
  fallbackConfigPath?: string
): BrowserResolutionResult {
  const envPath =
    process.env['MD_TECH_SLIDE_BROWSER_PATH'] ||
    process.env['PUPPETEER_EXECUTABLE_PATH'] ||
    process.env['CHROME_PATH'];

  const explicitlySpecifiedPath =
    (envPath && envPath.trim()) ||
    (configPath && configPath.trim()) ||
    (fallbackConfigPath && fallbackConfigPath.trim());

  if (explicitlySpecifiedPath) {
    if (!fs.existsSync(explicitlySpecifiedPath)) {
      return {
        error: 'mermaid-invalid-browser-path',
        message: `Configured browser path does not exist: "${explicitlySpecifiedPath}"`,
      };
    }
    if (!isExecutableFile(explicitlySpecifiedPath)) {
      return {
        error: 'mermaid-invalid-browser-path',
        message: `Configured browser path is not an executable file: "${explicitlySpecifiedPath}"`,
      };
    }
    return { executablePath: explicitlySpecifiedPath };
  }

  const detected = findInstalledBrowser();
  if (!detected) {
    return {
      error: 'mermaid-browser-not-found',
      message:
        'No compatible Chromium-based browser (Chrome / Edge) found on system. Please set mdTechSlide.browserPath or install Chrome.',
    };
  }

  return { executablePath: detected };
}
