import type Token from 'markdown-it/lib/token.mjs';
import type {
  BlockElement,
  HeadingBlock,
  ParagraphBlock,
  ListBlock,
  ListItem,
  CodeBlock,
  TableBlock,
} from '../types/ir.js';
import { parseInlineTokens } from './inline-parser.js';

export interface BlockParseResult {
  readonly elements: readonly BlockElement[];
  readonly nextIndex: number;
}

export function parseList(tokens: readonly Token[], startIndex: number): { block: ListBlock; nextIndex: number } {
  const openToken = tokens[startIndex];
  if (!openToken) {
    throw new Error('Unexpected end of tokens while parsing list.');
  }

  const ordered = openToken.type === 'ordered_list_open';
  const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close';

  const items: ListItem[] = [];
  let i = startIndex + 1;

  while (i < tokens.length) {
    const current = tokens[i];
    if (!current) {
      break;
    }

    if (current.type === closeType) {
      i++;
      break;
    }

    if (current.type === 'list_item_open') {
      i++;
      let spans: ListItem['spans'] = [];
      const children: ListItem[] = [];

      while (i < tokens.length) {
        const itemChild = tokens[i];
        if (!itemChild) {
          break;
        }

        if (itemChild.type === 'list_item_close') {
          i++;
          break;
        }

        if (itemChild.type === 'bullet_list_open' || itemChild.type === 'ordered_list_open') {
          const nested = parseList(tokens, i);
          children.push(...nested.block.items);
          i = nested.nextIndex;
        } else if (itemChild.type === 'paragraph_open') {
          const nextToken = tokens[i + 1];
          if (nextToken && nextToken.type === 'inline') {
            const inlineRes = parseInlineTokens(nextToken.children);
            spans = spans.concat(inlineRes.spans);
            i += 3; // paragraph_open, inline, paragraph_close
          } else {
            i++;
          }
        } else if (itemChild.type === 'inline') {
          const inlineRes = parseInlineTokens(itemChild.children);
          spans = spans.concat(inlineRes.spans);
          i++;
        } else {
          i++;
        }
      }

      items.push({
        spans,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      i++;
    }
  }

  return {
    block: {
      type: 'list',
      ordered,
      items,
    },
    nextIndex: i,
  };
}

export function parseTable(tokens: readonly Token[], startIndex: number): { block: TableBlock; nextIndex: number } {
  let i = startIndex + 1;
  const headers: string[] = [];
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let inHeader = false;

  while (i < tokens.length) {
    const current = tokens[i];
    if (!current) {
      break;
    }

    if (current.type === 'table_close') {
      i++;
      break;
    }

    if (current.type === 'thead_open') {
      inHeader = true;
      i++;
    } else if (current.type === 'thead_close') {
      inHeader = false;
      i++;
    } else if (current.type === 'tr_open') {
      currentRow = [];
      i++;
    } else if (current.type === 'tr_close') {
      if (!inHeader && currentRow.length > 0) {
        rows.push(currentRow);
      }
      i++;
    } else if (current.type === 'th_open' || current.type === 'td_open') {
      const nextToken = tokens[i + 1];
      if (nextToken && nextToken.type === 'inline') {
        const text = nextToken.content;
        if (inHeader) {
          headers.push(text);
        } else {
          currentRow.push(text);
        }
        i += 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return {
    block: {
      type: 'table',
      headers,
      rows,
    },
    nextIndex: i,
  };
}

export function parseSingleBlock(tokens: readonly Token[], index: number): { elements: readonly BlockElement[]; nextIndex: number } {
  const token = tokens[index];
  if (!token) {
    return { elements: [], nextIndex: index };
  }

  switch (token.type) {
    case 'heading_open': {
      const level = parseInt(token.tag.replace(/^h/, ''), 10) || 1;
      const inlineToken = tokens[index + 1];
      let text = '';
      let spans: HeadingBlock['spans'] = [];

      if (inlineToken && inlineToken.type === 'inline') {
        text = inlineToken.content;
        const inlineRes = parseInlineTokens(inlineToken.children);
        spans = inlineRes.spans;
      }

      const heading: HeadingBlock = {
        type: 'heading',
        level,
        text,
        spans,
      };

      // heading_open, inline, heading_close
      return { elements: [heading], nextIndex: index + 3 };
    }

    case 'paragraph_open': {
      const inlineToken = tokens[index + 1];
      if (inlineToken && inlineToken.type === 'inline') {
        const inlineRes = parseInlineTokens(inlineToken.children);

        // 画像のみが含まれている場合は ImageBlock として抽出
        if (inlineRes.images.length > 0 && inlineRes.spans.length === 0) {
          return { elements: inlineRes.images, nextIndex: index + 3 };
        }

        const paragraph: ParagraphBlock = {
          type: 'paragraph',
          spans: inlineRes.spans,
        };

        const resultElements: BlockElement[] = [paragraph, ...inlineRes.images];
        return { elements: resultElements, nextIndex: index + 3 };
      }

      return { elements: [], nextIndex: index + 2 };
    }

    case 'fence':
    case 'code_block': {
      const codeBlock: CodeBlock = {
        type: 'code',
        code: token.content.replace(/\n$/, ''),
        language: token.info ? token.info.trim() : undefined,
      };
      return { elements: [codeBlock], nextIndex: index + 1 };
    }

    case 'bullet_list_open':
    case 'ordered_list_open': {
      const listRes = parseList(tokens, index);
      return { elements: [listRes.block], nextIndex: listRes.nextIndex };
    }

    case 'table_open': {
      const tableRes = parseTable(tokens, index);
      return { elements: [tableRes.block], nextIndex: tableRes.nextIndex };
    }

    default:
      return { elements: [], nextIndex: index + 1 };
  }
}
