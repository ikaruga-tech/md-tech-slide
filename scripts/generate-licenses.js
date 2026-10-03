import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const LICENSE_FILE_PATTERNS = [/^LICEN[CS]E(\..+)?$/i, /^COPYING(\..+)?$/i, /^NOTICE(\..+)?$/i];

const STANDARD_LICENSES = {
  MIT: (author, year) => `MIT License

Copyright (c) ${year || 'present'} ${author || 'The Package Authors'}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,

  'Apache-2.0': (author, year) => `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Copyright ${year || 'present'} ${author || 'The Package Authors'}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,

  ISC: (author, year) => `ISC License

Copyright (c) ${year || 'present'} ${author || 'The Package Authors'}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,

  '0BSD': () => `0BSD License (Zero-Clause BSD)

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
};

function formatAuthor(author) {
  if (!author) return '';
  if (typeof author === 'string') return author;
  let res = author.name || '';
  if (author.email) res += ` <${author.email}>`;
  if (author.url) res += ` (${author.url})`;
  return res;
}

function formatRepository(repo) {
  if (!repo) return '';
  if (typeof repo === 'string') return repo;
  if (repo.url) return repo.url.replace(/^git\+/, '').replace(/\.git$/, '');
  return '';
}

function extractLicenseId(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(', ');
  }
  return 'Unknown';
}

export async function generateThirdPartyLicenses(metafile) {
  let mf = metafile;
  if (!mf) {
    const res = await esbuild.build({
      entryPoints: [path.join(rootDir, 'src/extension.ts')],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      outfile: path.join(rootDir, 'dist/extension.cjs'),
      external: ['vscode'],
      metafile: true,
      legalComments: 'eof',
      minify: true,
      write: false,
    });
    mf = res.metafile;
  }

  const packageDirs = new Map();

  for (const inputPath of Object.keys(mf.inputs)) {
    if (!inputPath.includes('node_modules')) continue;
    const absPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(rootDir, inputPath);
    let currentDir = path.dirname(absPath);

    while (currentDir !== path.dirname(currentDir) && currentDir.includes('node_modules')) {
      const pkgJsonPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          if (pkg.name) {
            packageDirs.set(pkg.name, { dir: currentDir, pkg });
            break;
          }
        } catch {
          // ignore corrupted/unreadable json
        }
      }
      currentDir = path.dirname(currentDir);
    }
  }

  const sortedPackages = Array.from(packageDirs.values()).sort((a, b) =>
    a.pkg.name.localeCompare(b.pkg.name)
  );

  const sections = [];

  sections.push(`================================================================================
THIRD-PARTY SOFTWARE NOTICES AND INFORMATION
================================================================================

This product bundles dependencies licensed under various open source licenses.
The notices, copyright statements, and license texts for these dependencies are
provided below.

Total bundled third-party packages: ${sortedPackages.length}
`);

  for (const { dir, pkg } of sortedPackages) {
    const name = pkg.name;
    const version = pkg.version || 'unknown';
    const licenseId = extractLicenseId(pkg);
    const repo = formatRepository(pkg.repository) || pkg.homepage || '';
    const author = formatAuthor(pkg.author);

    let licenseContent;
    const files = fs.readdirSync(dir);
    const licenseFiles = files.filter((f) => LICENSE_FILE_PATTERNS.some((p) => p.test(f)));

    if (licenseFiles.length > 0) {
      licenseContent = licenseFiles
        .map((file) => {
          const content = fs.readFileSync(path.join(dir, file), 'utf8').trim();
          return `[${file}]\n${content}`;
        })
        .join('\n\n');
    } else {
      const normalizedLicense = licenseId.replace(/[()]/g, '').trim();
      if (STANDARD_LICENSES[normalizedLicense]) {
        licenseContent = STANDARD_LICENSES[normalizedLicense](author);
      } else {
        licenseContent = `Package: ${name}\nLicense: ${licenseId}\nSee ${repo || 'repository'} for license terms.`;
      }
    }

    const packageBlock = [
      '================================================================================',
      `Package: ${name}@${version}`,
      `License: ${licenseId}`,
      repo ? `Repository: ${repo}` : null,
      author ? `Author: ${author}` : null,
      '================================================================================',
      '',
      licenseContent.trim(),
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');

    sections.push(packageBlock);
  }

  const outputFilePath = path.join(rootDir, 'THIRD_PARTY_LICENSES.txt');
  const fullText = sections.join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  fs.writeFileSync(outputFilePath, fullText, 'utf8');
  console.log(`Generated ${outputFilePath} (${sortedPackages.length} packages)`);
  return outputFilePath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateThirdPartyLicenses().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
