export interface SlideSection {
  readonly content: string;
  readonly startLine: number; // 0-indexed document line index
}

export function splitSlidesWithPositions(
  content: string,
  baseStartLine: number = 0
): readonly SlideSection[] {
  const lines = content.split(/\r?\n/);
  const slideDelimiterRegex = /^#{8,}\s*$/;
  const sections: SlideSection[] = [];

  let currentLines: string[] = [];
  let sectionStartLine = baseStartLine;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (slideDelimiterRegex.test(line)) {
      addSectionIfNotEmpty(sections, currentLines, sectionStartLine);
      currentLines = [];
      sectionStartLine = baseStartLine + i + 1;
    } else {
      currentLines.push(line);
    }
  }

  addSectionIfNotEmpty(sections, currentLines, sectionStartLine);

  if (sections.length === 0) {
    return [{ content: '', startLine: baseStartLine }];
  }

  return sections;
}

function addSectionIfNotEmpty(
  sections: SlideSection[],
  lines: string[],
  sectionStartLine: number
): void {
  let leadingEmpty = 0;
  while (leadingEmpty < lines.length && lines[leadingEmpty]!.trim().length === 0) {
    leadingEmpty++;
  }

  if (leadingEmpty === lines.length) {
    return;
  }

  let trailingEmpty = 0;
  while (
    lines.length - 1 - trailingEmpty >= leadingEmpty &&
    lines[lines.length - 1 - trailingEmpty]!.trim().length === 0
  ) {
    trailingEmpty++;
  }

  const trimmedLines = lines.slice(leadingEmpty, lines.length - trailingEmpty);
  sections.push({
    content: trimmedLines.join('\n'),
    startLine: sectionStartLine + leadingEmpty,
  });
}

export function splitSlides(content: string): readonly string[] {
  return splitSlidesWithPositions(content).map((s) => s.content);
}
