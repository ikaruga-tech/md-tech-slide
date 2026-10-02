export interface ParsedColumnRatio {
  readonly valid: boolean;
  readonly weights?: readonly number[];
  readonly normalizedRatio?: string;
  readonly frSegments?: readonly string[];
  readonly cssClassName?: string;
  readonly error?: string;
}

// 厳密に正の10進数のみ許可（符号、指数表記、単位、CSS構文文字はすべて不許可）
const STRICT_POSITIVE_NUMBER_REGEX = /^(?:\d+|\d*\.\d+)$/;

/**
 * カラム ratio 文字列を厳密にパース・検証し、正規化された比率と CSS 安全なプロパティを返却します。
 * 入力文字列を直接 CSS や HTML に出力せず、検証済み数値配列から安全な表現を再構築します。
 */
export function parseColumnRatio(ratioStr?: string, expectedCount?: number): ParsedColumnRatio {
  if (!ratioStr || ratioStr.trim().length === 0) {
    return { valid: false, error: 'Ratio string is empty' };
  }

  const rawSegments = ratioStr.trim().split(':');
  if (rawSegments.length < 2) {
    return {
      valid: false,
      error: `Ratio must contain at least 2 segments separated by ":", got ${rawSegments.length}`,
    };
  }

  if (expectedCount !== undefined && rawSegments.length !== expectedCount) {
    return {
      valid: false,
      error: `Ratio "${ratioStr}" specifies ${rawSegments.length} parts, but column count is ${expectedCount}.`,
    };
  }

  const weights: number[] = [];
  for (const seg of rawSegments) {
    const trimmed = seg.trim();
    if (!STRICT_POSITIVE_NUMBER_REGEX.test(trimmed)) {
      return {
        valid: false,
        error: `Invalid ratio segment "${seg}". Must be a positive decimal number without units or special characters`,
      };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num <= 0) {
      return {
        valid: false,
        error: `Ratio segment value "${seg}" must be a finite positive number greater than 0`,
      };
    }
    weights.push(num);
  }

  const normalizedRatio = weights.join(':');
  const frSegments = weights.map((w) => `${w}fr`);
  // CSS クラス名は数値とアンダースコア・ハイフンのみで構成
  const cssClassName = `cols-ratio-${weights.map((w) => String(w).replace(/\./g, '_')).join('-')}`;

  return {
    valid: true,
    weights,
    normalizedRatio,
    frSegments,
    cssClassName,
  };
}
