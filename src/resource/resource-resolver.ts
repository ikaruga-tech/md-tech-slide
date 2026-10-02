import * as fs from 'node:fs';
import * as path from 'node:path';

export class ResourceNotFoundError extends Error {
  constructor(resourcePath: string, options?: ErrorOptions) {
    super(`Resource not found: ${resourcePath}`, options);
    this.name = 'ResourceNotFoundError';
  }
}

export class ResourceAccessDeniedError extends Error {
  constructor(resourcePath: string, reason: string, options?: ErrorOptions) {
    super(`Access denied for resource "${resourcePath}": ${reason}`, options);
    this.name = 'ResourceAccessDeniedError';
  }
}

export class UnsupportedResourceFormatError extends Error {
  constructor(ext: string, allowedExtensions: readonly string[], options?: ErrorOptions) {
    super(
      `Unsupported resource format "${ext}". Allowed: ${allowedExtensions.join(', ')}`,
      options
    );
    this.name = 'UnsupportedResourceFormatError';
  }
}

export class ResourceTooLargeError extends Error {
  constructor(sizeBytes: number, maxSizeBytes: number, options?: ErrorOptions) {
    super(`Resource size (${sizeBytes} bytes) exceeds limit of ${maxSizeBytes} bytes`, options);
    this.name = 'ResourceTooLargeError';
  }
}

export interface ResolveResourceOptions {
  readonly sourceMarkdownPath?: string;
  readonly resourcePath: string;
  readonly allowedRoots?: readonly string[];
  readonly maxSizeBytes?: number;
  readonly allowedExtensions?: readonly string[];
}

export interface ResolvedResource {
  readonly absolutePath: string;
  readonly mimeType: string;
  readonly extension: string;
  readonly sizeBytes: number;
  readBuffer(): Buffer;
  toDataUri(): string;
}

const DEFAULT_ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.webp'] as const;
const DEFAULT_MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function isSubdirectory(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function resolveLocalResource(options: ResolveResourceOptions): ResolvedResource {
  const {
    sourceMarkdownPath,
    resourcePath,
    allowedRoots,
    maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
    allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS,
  } = options;

  if (!resourcePath || typeof resourcePath !== 'string') {
    throw new ResourceNotFoundError(String(resourcePath));
  }

  // HTTP / HTTPS / Data URI はローカルファイルではない
  if (/^(https?|data):/i.test(resourcePath)) {
    throw new ResourceAccessDeniedError(
      resourcePath,
      'Remote URLs or inline data URIs are not resolved as local resources'
    );
  }

  // ベースディレクトリの決定
  let baseDir: string;
  if (sourceMarkdownPath) {
    baseDir = path.dirname(path.resolve(sourceMarkdownPath));
  } else {
    baseDir = process.cwd();
  }

  // パスの正規化
  let candidatePath: string;
  if (path.isAbsolute(resourcePath)) {
    candidatePath = path.normalize(resourcePath);
  } else {
    candidatePath = path.resolve(baseDir, resourcePath);
  }

  // 拡張子検証
  const ext = path.extname(candidatePath).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new UnsupportedResourceFormatError(ext, allowedExtensions);
  }

  // 許可ルート（境界チェック）の準備
  const roots: string[] = [];
  if (allowedRoots && allowedRoots.length > 0) {
    roots.push(
      ...allowedRoots.map((r) =>
        fs.existsSync(r) ? fs.realpathSync(path.resolve(r)) : path.resolve(r)
      )
    );
  } else if (sourceMarkdownPath) {
    roots.push(fs.existsSync(baseDir) ? fs.realpathSync(baseDir) : baseDir);
  } else {
    roots.push(fs.existsSync(process.cwd()) ? fs.realpathSync(process.cwd()) : process.cwd());
  }

  // 1. 候補パスの境界チェック（存在チェック前に実行し、情報漏洩や外部探索を遮断）
  const isCandidateWithinRoots = roots.some(
    (root) => isSubdirectory(root, candidatePath) || root === candidatePath
  );
  if (!isCandidateWithinRoots) {
    throw new ResourceAccessDeniedError(
      candidatePath,
      `Path "${candidatePath}" escapes allowed boundaries: ${roots.join(', ')}`
    );
  }

  // 2. 存在チェック
  if (!fs.existsSync(candidatePath)) {
    throw new ResourceNotFoundError(candidatePath);
  }

  // 3. シンボリックリンク解決
  let realPath: string;
  try {
    realPath = fs.realpathSync(candidatePath);
  } catch (err) {
    throw new ResourceNotFoundError(candidatePath, { cause: err });
  }

  // 4. 実パスの再境界チェック（シンボリックリンクによる境界外参照を防止）
  const isRealWithinRoots = roots.some(
    (root) => isSubdirectory(root, realPath) || root === realPath
  );
  if (!isRealWithinRoots) {
    throw new ResourceAccessDeniedError(
      candidatePath,
      `Symlink target for "${candidatePath}" escapes allowed boundaries: ${roots.join(', ')}`
    );
  }

  // ファイルサイズチェック
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    throw new ResourceNotFoundError(candidatePath);
  }
  if (stat.size > maxSizeBytes) {
    throw new ResourceTooLargeError(stat.size, maxSizeBytes);
  }

  const mimeType = MIME_MAP[ext] || 'application/octet-stream';

  return {
    absolutePath: realPath,
    mimeType,
    extension: ext,
    sizeBytes: stat.size,
    readBuffer() {
      return fs.readFileSync(realPath);
    },
    toDataUri() {
      const buf = fs.readFileSync(realPath);
      return `data:${mimeType};base64,${buf.toString('base64')}`;
    },
  };
}

/**
 * Markdown 親ディレクトリとワークスペースルートを統合した単一の許可ルートリストを生成します。
 * Preview、Diagnostic、PPTX、PDF の全コンポーネントでこの関数を用いて一貫した許可境界を形成します。
 */
export function getAllowedResourceRoots(
  sourceMarkdownPath?: string,
  workspaceFolders?: readonly string[]
): string[] {
  const roots = new Set<string>();

  if (sourceMarkdownPath) {
    const parentDir = path.dirname(path.resolve(sourceMarkdownPath));
    if (fs.existsSync(parentDir)) {
      try {
        roots.add(fs.realpathSync(parentDir));
      } catch {
        roots.add(parentDir);
      }
    } else {
      roots.add(parentDir);
    }
  }

  if (workspaceFolders && workspaceFolders.length > 0) {
    for (const folder of workspaceFolders) {
      const resolved = path.resolve(folder);
      if (fs.existsSync(resolved)) {
        try {
          roots.add(fs.realpathSync(resolved));
        } catch {
          roots.add(resolved);
        }
      } else {
        roots.add(resolved);
      }
    }
  }

  if (roots.size === 0) {
    const cwd = process.cwd();
    try {
      roots.add(fs.realpathSync(cwd));
    } catch {
      roots.add(cwd);
    }
  }

  return Array.from(roots);
}
