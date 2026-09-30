import { createHighlighter, type Highlighter, type BundledLanguage } from 'shiki';

export interface HighlightedSpanOptions {
  readonly color?: string;
  readonly fontFace?: string;
  readonly fontSize?: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
}

export interface HighlightedSpan {
  readonly text: string;
  readonly options: HighlightedSpanOptions;
}

let highlighterInstance: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterInstance) {
    highlighterInstance = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [
        'typescript',
        'javascript',
        'python',
        'json',
        'markdown',
        'html',
        'css',
        'bash',
        'yaml',
      ],
    });
  }
  return highlighterInstance;
}

export async function highlightCodeToTextProps(
  code: string,
  language: string | undefined,
  shikiTheme: string,
  fontFace: string,
  defaultTextColor: string
): Promise<readonly HighlightedSpan[]> {
  const highlighter = await getHighlighter();
  const loadedLangs = highlighter.getLoadedLanguages();
  const lang = (language && loadedLangs.includes(language) ? language : 'text') as BundledLanguage;

  const tokensResult = highlighter.codeToTokens(code, {
    lang,
    theme: shikiTheme,
  });

  const spans: HighlightedSpan[] = [];

  for (let lineIndex = 0; lineIndex < tokensResult.tokens.length; lineIndex++) {
    const line = tokensResult.tokens[lineIndex];
    if (!line) {
      continue;
    }

    for (const token of line) {
      const color = token.color ? token.color.replace('#', '') : defaultTextColor;
      spans.push({
        text: token.content,
        options: {
          color,
          fontFace,
          fontSize: 13,
          bold: (token.fontStyle ?? 0) === 1,
          italic: (token.fontStyle ?? 0) === 2,
        },
      });
    }

    // 各行末に改行を付与（最終行以外）
    if (lineIndex < tokensResult.tokens.length - 1) {
      spans.push({
        text: '\n',
        options: {
          fontFace,
          fontSize: 13,
        },
      });
    }
  }

  return spans;
}
