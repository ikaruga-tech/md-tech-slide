# Release Process and Operations Guide

This document describes the end-to-end release process for `md-tech-slide`, including versioning policies, tag conventions, automated release workflows, verification requirements, and rollback procedures.

## 1. Versioning and Tagging Conventions

`md-tech-slide` adheres strictly to [Semantic Versioning 2.0.0](https://semver.org/).

### 1.1 Tag Formats

| Release Type                  | Tag Pattern               | Example       | GitHub Release State                   |
| ----------------------------- | ------------------------- | ------------- | -------------------------------------- |
| Release Candidate (RC)        | `vMAJOR.MINOR.PATCH-rc.N` | `v0.1.0-rc.1` | Pre-release (`prerelease: true`)       |
| General Availability (Stable) | `vMAJOR.MINOR.PATCH`      | `v0.1.0`      | Official Release (`prerelease: false`) |

- Any tag not strictly matching either pattern (e.g., `v0.1.0-beta`, `0.1.0`, `v0.1.0-rc.0`) is rejected by release verification gates.
- The base version in the tag must match the `version` field in `package.json` exactly.

### 1.2 Channel Separation

1. Release Candidate (RC):
   - Published only as a GitHub Pre-release.
   - Intended for manual validation, multi-OS smoke testing, and acceptance verification.
   - Not published to the VS Code Marketplace.
2. Stable GA Release:
   - Published as a regular GitHub Release.
   - Requires completed RC acceptance checklist with 0 P0 defects.
3. Visual Studio Code Marketplace:
   - Kept strictly separate from the GitHub Release workflow.
   - Marketplace publishing (`vsce publish`) requires explicit maintainer approval and separate credential management.

## 2. Release Automation Workflow

The release pipeline is defined in `.github/workflows/release.yml`.

### 2.1 Pre-publish Verification Job (`build-and-verify`)

- Runs on `ubuntu-latest` with minimal permissions (`contents: read, actions: read`).
- Verifies:
  1. Release tag regex and `package.json` version match (`scripts/verify-release-tag.js`).
  2. Prior successful 4-job CI execution on the target commit SHA (`scripts/verify-ci-status.js`).
     - Note on partial re-runs: `verify-ci-status.js` strictly requires all 4 required CI jobs to be present and successful within the latest run attempt of the workflow run. If a job fails and partial re-run ("Re-run failed jobs") is performed in GitHub Actions, maintainers must ensure that all 4 jobs are successful in that latest attempt, or trigger a full re-run ("Re-run all jobs") before running release verification. Mixing successful jobs from previous attempts is not permitted.
  3. Clean execution of the complete local test suite (`npm run verify`).
  4. Generation of sample presentations (`sample.pptx`, `sample.pdf`).
  5. SHA-256 calculation for binary artifacts and generation of `release-manifest.json` (`scripts/generate-release-manifest.js`).
- Uploads verified artifacts to a temporary GitHub Actions artifact store.

### 2.2 Publishing Job (`publish-release`)

- Runs on `ubuntu-latest` with write permission (`contents: write`).
- Execution controls:
  - `concurrency`: Concurrency group per tag ref avoids race conditions.
  - Package identity and version alignment: Checks out the target commit SHA, reads both `name` and `version` from `package.json`, and verifies alignment against the release tag. Adheres strictly to the non-scoped package naming contract (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) and non-leading-zero `X.Y.Z` version contract (`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$`). Rejects invalid names, versions, or tag base version mismatches with exit code 1 prior to any file read.
  - Pre-read artifact safety verification: Inspects the artifacts directory itself with `lstat` before calling `readdirSync` (immediately aborting with exit code 1 if the directory itself is a symlink, not a directory, or inaccessible). Subsequently inspects all directory entries using `lstat` prior to reading files; immediately rejects symlinks, directories, non-regular files, hidden files, or path traversals (`scripts/verify-downloaded-artifacts.js`).
  - Artifact integrity and non-leaking diagnostic verification: After directory and entry safety checks pass, independently reads and verifies the 5 required artifacts (`${packageName}-${packageVersion}.vsix`, sample PPTX, sample PDF, `checksums.txt`, `release-manifest.json`), parses and checks all 3 binary entries in `checksums.txt`, validates manifest metadata without skipping, and ensures hash consistency across all files. All diagnostic messages throughout CLI execution, file reading, and validation are strictly non-leaking: local absolute paths, raw stack traces, raw error messages (`err.message`), unverified environment variables, and arbitrary filenames are completely omitted. Filesystem errors are sanitized to an allowlist of error codes (`ENOENT`, `EACCES`, `EISDIR`, `EPERM`, `ENOTDIR`, `EEXIST`, `EBUSY`, `EIO`) or normalized to generic codes.
  - Publishes VSIX, sample PPTX, sample PDF, checksums, and manifest via `softprops/action-gh-release@v2`.

## 3. Post-Release Verification

After release publication:

1. Download the published VSIX from the GitHub Release page.
2. Verify checksum:
   ```bash
   sha256sum md-tech-slide-0.1.0.vsix
   ```
   Compare against `checksums.txt` published in the release assets.
3. Install the VSIX manually:
   ```bash
   code --install-extension md-tech-slide-0.1.0.vsix
   ```
4. Perform acceptance checks according to [RC Verification Checklist](rc-verification-checklist.md).

## 4. Rollback and Incident Handling

If a critical flaw (P0) is discovered after publishing:

1. Release Candidate:
   - Do NOT modify or overwrite the existing tag or release assets.
   - Fix the issue on a new branch, merge to `main`, and issue the next RC tag (e.g., `v0.1.0-rc.2`).
2. Stable Release:
   - Edit the GitHub Release notes to add a prominent warning banner marking the release as revoked.
   - Prepare a hotfix release (e.g., `v0.1.1`) immediately.
