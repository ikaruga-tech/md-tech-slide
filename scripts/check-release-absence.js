import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * HTTPステータスコードに基づいて、Release不存在判定を構造的に評価する純粋関数
 * @param {number} repoStatusCode リポジトリAPIのHTTPステータス
 * @param {number} releaseStatusCode タグRelease APIのHTTPステータス
 * @returns {{ canProceed: boolean, error?: string }}
 */
export function evaluateReleaseAbsenceStatus(repoStatusCode, releaseStatusCode) {
  if (repoStatusCode !== 200) {
    return {
      canProceed: false,
      error: `Repository access check failed (HTTP ${repoStatusCode}). Authentication or network issue.`,
    };
  }

  if (releaseStatusCode === 404) {
    return {
      canProceed: true,
    };
  }

  if (releaseStatusCode === 200) {
    return {
      canProceed: false,
      error: `A GitHub Release for this tag already exists (HTTP 200). Aborting to prevent accidental overwriting.`,
    };
  }

  return {
    canProceed: false,
    error: `Failed to inspect release existence status (HTTP ${releaseStatusCode}). Cannot assume non-existence.`,
  };
}

async function runCli() {
  const repo = process.env.GITHUB_REPOSITORY || process.argv[2];
  const tag = process.env.TAG_NAME || process.argv[3];
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !tag) {
    console.error('Error: GITHUB_REPOSITORY and TAG_NAME are required.');
    process.exit(1);
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'md-tech-slide-release-verifier',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  console.log(`Checking repository access and Release absence for repo: ${repo}, tag: ${tag}...`);

  try {
    // 1. リポジトリ疎通確認
    const repoRes = await globalThis.fetch(`https://api.github.com/repos/${repo}`, { headers });
    const repoStatus = repoRes.status;

    // 2. Release存在確認
    const releaseRes = await globalThis.fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
      { headers }
    );
    const releaseStatus = releaseRes.status;

    const evalResult = evaluateReleaseAbsenceStatus(repoStatus, releaseStatus);

    if (!evalResult.canProceed) {
      console.error(`Release absence verification failed: ${evalResult.error}`);
      process.exit(1);
    }

    console.log(
      `Verified successfully: No existing Release found for tag "${tag}" (HTTP 404 with healthy repo connection). Safe to proceed with release creation.`
    );
  } catch (err) {
    console.error(`Network or execution error while checking release absence:`, err.message);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runCli();
}
