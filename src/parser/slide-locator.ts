export function getSlideLineRanges(
  markdown: string
): readonly { readonly startLine: number; readonly endLine: number }[] {
  const lines = markdown.split(/\r?\n/);
  const delimiterRegex = /^#{8,}\s*$/;

  const delimiterLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (delimiterRegex.test(line)) {
      delimiterLines.push(i);
    }
  }

  const ranges: { startLine: number; endLine: number }[] = [];
  let currentStart = 0;

  for (const delimLine of delimiterLines) {
    ranges.push({
      startLine: currentStart,
      endLine: Math.max(currentStart, delimLine - 1),
    });
    currentStart = delimLine + 1;
  }

  // 最終スライド
  ranges.push({
    startLine: currentStart,
    endLine: Math.max(currentStart, lines.length - 1),
  });

  return ranges;
}

export function findSlideIndexByLine(markdown: string, cursorLine: number): number {
  const ranges = getSlideLineRanges(markdown);
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r && cursorLine >= r.startLine && cursorLine <= r.endLine) {
      return i;
    }
  }
  return Math.max(0, ranges.length - 1);
}

export function findSlideStartLine(markdown: string, slideIndex: number): number {
  const ranges = getSlideLineRanges(markdown);
  const target = ranges[slideIndex];
  if (target) {
    return target.startLine;
  }
  return 0;
}
