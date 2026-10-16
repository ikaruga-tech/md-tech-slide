import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REQUIRED_CI_JOB_NAMES = [
  'Linux (Ubuntu) - Node 22',
  'Linux (Ubuntu) - Node 24',
  'Cross-OS (macos-latest)',
  'Cross-OS (windows-latest)',
];

/**
 * @typedef {Object} JobVerificationResult
 * @property {boolean} isSuccess
 * @property {string[]} foundJobNames
 * @property {string[]} missingJobNames
 * @property {Array<{name: string, conclusion: string, status: string, run_attempt: number}>} failedOrIncompleteJobs
 * @property {string} [error]
 */

/**
 * 渡されたジョブ一覧から、指定した最新 run_attempt のジョブのみを対象として
 * 必須4ジョブの存在と成功を厳格に照合する。
 * 古い試行（run_attemptが異なるもの）は除外する。
 *
 * @param {Array<{name: string, conclusion: string, status: string, run_attempt: number}>} jobs
 * @param {string[]} requiredNames
 * @param {number} targetAttempt
 * @returns {JobVerificationResult}
 */
export function verifyWorkflowJobs(jobs, requiredNames, targetAttempt) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return {
      isSuccess: false,
      foundJobNames: [],
      missingJobNames: [...requiredNames],
      failedOrIncompleteJobs: [],
      error: 'No jobs found in the specified workflow run.',
    };
  }

  // 最新 attempt のジョブのみに限定（古い attempt の成功/失敗結果を混入させない）
  const attemptJobs = jobs.filter((j) => j.run_attempt === targetAttempt);

  const foundJobNames = [];
  const missingJobNames = [];
  const failedOrIncompleteJobs = [];

  for (const requiredName of requiredNames) {
    const matchedJobs = attemptJobs.filter((j) => j.name === requiredName);
    if (matchedJobs.length === 0) {
      missingJobNames.push(requiredName);
      continue;
    }

    foundJobNames.push(requiredName);
    for (const job of matchedJobs) {
      if (job.status !== 'completed' || job.conclusion !== 'success') {
        failedOrIncompleteJobs.push({
          name: job.name,
          conclusion: job.conclusion,
          status: job.status,
          run_attempt: job.run_attempt,
        });
      }
    }
  }

  if (missingJobNames.length > 0) {
    return {
      isSuccess: false,
      foundJobNames,
      missingJobNames,
      failedOrIncompleteJobs,
      error: `Missing required CI jobs in attempt ${targetAttempt}: ${missingJobNames.join(', ')}`,
    };
  }

  if (failedOrIncompleteJobs.length > 0) {
    const details = failedOrIncompleteJobs
      .map((j) => `${j.name} (status: ${j.status}, conclusion: ${j.conclusion})`)
      .join(', ');
    return {
      isSuccess: false,
      foundJobNames,
      missingJobNames,
      failedOrIncompleteJobs,
      error: `Some required CI jobs in attempt ${targetAttempt} failed or did not complete: ${details}`,
    };
  }

  return {
    isSuccess: true,
    foundJobNames,
    missingJobNames: [],
    failedOrIncompleteJobs: [],
  };
}

/**
 * GitHub API から全ページにわたってジョブ一覧を取得する
 */
export async function fetchAllJobsForRun(repo, runId, token, attempt) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'md-tech-slide-release-verifier',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const allJobs = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    // 試行指定エンドポイントを優先、取得可能か試す
    let url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${perPage}&page=${page}`;
    let res = await globalThis.fetch(url, { headers });

    // 試行指定エンドポイントで404等の場合は通常のruns jobsエンドポイントへフォールバック
    if (!res.ok && res.status === 404 && page === 1) {
      url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=${perPage}&page=${page}`;
      res = await globalThis.fetch(url, { headers });
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch jobs from ${url} (HTTP ${res.status}: ${res.statusText})`);
    }

    const data = await res.json();
    const jobs = data.jobs || [];
    allJobs.push(...jobs);

    if (jobs.length < perPage || allJobs.length >= data.total_count) {
      break;
    }
    page++;
  }

  return allJobs;
}

/**
 * 対象コミットSHAのCI workflow runsを取得し、最新の完了実行を返す
 */
export async function fetchLatestCiRunForSha(repo, sha, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'md-tech-slide-release-verifier',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const url = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=10`;
  const res = await globalThis.fetch(url, { headers });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch CI runs for commit ${sha} (HTTP ${res.status}: ${res.statusText})`
    );
  }

  const data = await res.json();
  const runs = data.workflow_runs || [];
  if (runs.length === 0) {
    throw new Error(`No CI runs found for commit ${sha}`);
  }

  // 最新の run を取得
  const latestRun = runs[0];
  return latestRun;
}

async function runCli() {
  const repo = process.env.GITHUB_REPOSITORY || process.argv[2];
  const sha = process.env.COMMIT_SHA || process.env.GITHUB_SHA || process.argv[3];
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !sha) {
    console.error('Error: GITHUB_REPOSITORY and COMMIT_SHA are required.');
    process.exit(1);
  }

  console.log(`Checking CI status for repo: ${repo}, commit SHA: ${sha}...`);
  try {
    const latestRun = await fetchLatestCiRunForSha(repo, sha, token);
    console.log(
      `Found CI Run ID: ${latestRun.id}, status: ${latestRun.status}, conclusion: ${latestRun.conclusion}, attempt: ${latestRun.run_attempt}`
    );

    if (latestRun.status !== 'completed' || latestRun.conclusion !== 'success') {
      console.error(
        `Error: CI Run ${latestRun.id} is not successful (status: ${latestRun.status}, conclusion: ${latestRun.conclusion})`
      );
      process.exit(1);
    }

    const jobs = await fetchAllJobsForRun(repo, latestRun.id, token, latestRun.run_attempt);
    console.log(
      `Fetched total ${jobs.length} jobs for attempt ${latestRun.run_attempt}. Verifying 4 required jobs...`
    );

    const result = verifyWorkflowJobs(jobs, REQUIRED_CI_JOB_NAMES, latestRun.run_attempt);
    if (!result.isSuccess) {
      console.error(`CI Verification Failed: ${result.error}`);
      process.exit(1);
    }

    console.log(
      'All 4 required CI jobs verified successfully in attempt',
      latestRun.run_attempt,
      ':'
    );
    for (const name of result.foundJobNames) {
      console.log(`- [OK] ${name}`);
    }
  } catch (err) {
    console.error(`Error verifying CI status:`, err.message);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  runCli();
}
