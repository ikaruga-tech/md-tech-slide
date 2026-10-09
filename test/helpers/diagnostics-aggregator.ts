import type {
  SidecarFingerprintRecord,
  WorkerIntegrityManifest,
} from './browser-failure-fingerprint.js';
import type { TestDiagnosticEnvelope } from './diagnostics-collector.js';

export interface FingerprintAggregationSummary {
  loadedFingerprintFiles: number;
  validFingerprintRecords: number;
  recordsWithStderr: number;
  recordsWithoutStderr: number;
  bucketCounts: {
    none: number;
    small: number;
    medium: number;
    large: number;
  };
  indicatorCounts: Record<string, number>;
  noSpecificIndicatorOnlyCount: number;
  writerFailureCount: number;
  unflushedWorkers: number;
  invalidRecordCount: number;
  duplicateCorrelationKeyCount: number;
  missingFingerprintAttemptCount: number;
  orphanedFingerprintRecordCount: number;
}

export function aggregateFingerprintsAndCorrelate(
  fingerprintRecords: SidecarFingerprintRecord[],
  envelopes: TestDiagnosticEnvelope[],
  manifests: WorkerIntegrityManifest[],
  invalidRecordCount = 0,
  loadedFingerprintFiles = 0
): FingerprintAggregationSummary {
  const bucketCounts = {
    none: 0,
    small: 0,
    medium: 0,
    large: 0,
  };
  const indicatorCounts: Record<string, number> = {};
  let recordsWithStderr = 0;
  let recordsWithoutStderr = 0;
  let noSpecificIndicatorOnlyCount = 0;

  const seenFingerprintKeys = new Map<string, number>();

  for (const rec of fingerprintRecords) {
    if (rec.stderrPresent) {
      recordsWithStderr++;
    } else {
      recordsWithoutStderr++;
    }

    if (rec.stderrBucket in bucketCounts) {
      bucketCounts[rec.stderrBucket]++;
    }

    for (const ind of rec.fingerprintIndicators) {
      indicatorCounts[ind] = (indicatorCounts[ind] ?? 0) + 1;
    }

    if (
      rec.fingerprintIndicators.length === 1 &&
      rec.fingerprintIndicators[0] === 'no-specific-indicator'
    ) {
      noSpecificIndicatorOnlyCount++;
    }

    const currentCount = seenFingerprintKeys.get(rec.correlationKey) ?? 0;
    seenFingerprintKeys.set(rec.correlationKey, currentCount + 1);
  }

  let duplicateCorrelationKeyCount = 0;
  for (const count of seenFingerprintKeys.values()) {
    if (count > 1) {
      duplicateCorrelationKeyCount += count - 1;
    }
  }

  // Correlate with envelopes (scope: 'attempt' only)
  const attemptEnvelopeKeys = new Set<string>();
  const failedAttemptKeys = new Set<string>();

  for (const env of envelopes) {
    if (env.scope === 'attempt') {
      attemptEnvelopeKeys.add(env.correlationKey);
      if (
        env.event.stage === 'puppeteer-launch' ||
        env.event.stage.includes('fail') ||
        (env.event.exitCode !== undefined &&
          env.event.exitCode !== 0 &&
          env.event.exitCode !== 'unavailable')
      ) {
        failedAttemptKeys.add(env.correlationKey);
      }
    }
  }

  let missingFingerprintAttemptCount = 0;
  // Missing fingerprint check: for all attempt envelopes, check if fingerprint record exists
  for (const key of attemptEnvelopeKeys) {
    if (!seenFingerprintKeys.has(key)) {
      missingFingerprintAttemptCount++;
    }
  }

  let orphanedFingerprintRecordCount = 0;
  // Orphaned check: fingerprint record that has no corresponding attempt envelope
  for (const key of seenFingerprintKeys.keys()) {
    if (!attemptEnvelopeKeys.has(key)) {
      orphanedFingerprintRecordCount++;
    }
  }

  let writerFailureCount = 0;
  let unflushedWorkers = 0;

  for (const m of manifests) {
    writerFailureCount +=
      (m.diagnosticWriterFailureCount || 0) + (m.fingerprintWriterFailureCount || 0);
    if (!m.flushed) {
      unflushedWorkers++;
    }
  }

  return {
    loadedFingerprintFiles,
    validFingerprintRecords: fingerprintRecords.length,
    recordsWithStderr,
    recordsWithoutStderr,
    bucketCounts,
    indicatorCounts,
    noSpecificIndicatorOnlyCount,
    writerFailureCount,
    unflushedWorkers,
    invalidRecordCount,
    duplicateCorrelationKeyCount,
    missingFingerprintAttemptCount,
    orphanedFingerprintRecordCount,
  };
}
