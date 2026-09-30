import type Token from 'markdown-it/lib/token.mjs';
import type { TextSpan, ImageBlock } from '../types/ir.js';

export interface InlineParseResult {
  readonly spans: readonly TextSpan[];
  readonly images: readonly ImageBlock[];
}

export function parseInlineTokens(tokens: readonly Token[] | null): InlineParseResult {
  if (!tokens || tokens.length === 0) {
    return { spans: [], images: [] };
  }

  const spans: TextSpan[] = [];
  const images: ImageBlock[] = [];

  let isBold = false;
  let isItalic = false;
  let currentLink: string | undefined;

  for (const token of tokens) {
    switch (token.type) {
      case 'strong_open':
        isBold = true;
        break;
      case 'strong_close':
        isBold = false;
        break;
      case 'em_open':
        isItalic = true;
        break;
      case 'em_close':
        isItalic = false;
        break;
      case 'link_open': {
        const href = token.attrGet('href');
        if (href) {
          currentLink = href;
        }
        break;
      }
      case 'link_close':
        currentLink = undefined;
        break;
      case 'code_inline':
        spans.push({
          text: token.content,
          code: true,
          bold: isBold ? true : undefined,
          italic: isItalic ? true : undefined,
          link: currentLink,
        });
        break;
      case 'text':
        if (token.content.length > 0) {
          spans.push({
            text: token.content,
            bold: isBold ? true : undefined,
            italic: isItalic ? true : undefined,
            link: currentLink,
          });
        }
        break;
      case 'image': {
        const src = token.attrGet('src') ?? '';
        const alt = token.content || '';
        images.push({
          type: 'image',
          src,
          alt,
        });
        break;
      }
      default:
        // その他のトークン（softbreak, hardbreak 等）
        if (token.type === 'softbreak' || token.type === 'hardbreak') {
          spans.push({ text: '\n' });
        }
        break;
    }
  }

  return { spans, images };
}
