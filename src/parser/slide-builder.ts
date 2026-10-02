import type Token from 'markdown-it/lib/token.mjs';
import type {
  Slide,
  SlideType,
  SlideSlots,
  HeaderSlot,
  BodySlot,
  ColumnsSlot,
  Column,
  BlockElement,
} from '../types/ir.js';
import { parseSingleBlock } from './block-parser.js';

export function buildSlideFromTokens(tokens: readonly Token[], index: number): Slide {
  let header: HeaderSlot | undefined;
  let note: string | undefined;
  let pageNumber: boolean | undefined;
  let bodySlot: BodySlot = { type: 'single', elements: [] };

  const rootElements: BlockElement[] = [];
  let i = 0;

  // 最初の要素が見出し（h1 or h2）ならHeaderSlotとして扱う
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) {
      break;
    }

    // ノートブロックの検知
    if (token.type === 'container_note_open') {
      const noteRes = parseNoteContainer(tokens, i);
      note = noteRes.noteText;
      i = noteRes.nextIndex;
      continue;
    }

    // HTMLコメント形式のディレクティブ（<!-- paginate: true/false --> や <!-- note: 内容 -->）
    if (token.type === 'html_block') {
      const pagMatch = token.content.match(/<!--\s*paginate:\s*(true|false)\s*-->/i);
      if (pagMatch && pagMatch[1]) {
        pageNumber = pagMatch[1].toLowerCase() === 'true';
        i++;
        continue;
      }

      const match = token.content.match(/<!--\s*note:\s*([\s\S]*?)-->/i);
      if (match && match[1]) {
        note = match[1].trim();
        i++;
        continue;
      }
    }

    // マルチカラムブロックの検知
    if (token.type === 'container_columns_open') {
      const colsRes = parseColumnsContainer(tokens, i);
      bodySlot = colsRes.columnsSlot;
      i = colsRes.nextIndex;
      continue;
    }

    // 先頭見出しのHeaderSlot判定（まだHeader未設定かつカラム開始前）
    if (!header && token.type === 'heading_open') {
      const level = parseInt(token.tag.replace(/^h/, ''), 10) || 1;
      if (level <= 2 && rootElements.length === 0) {
        const inlineToken = tokens[i + 1];
        const title = inlineToken ? inlineToken.content : '';
        header = { title };
        i += 3; // heading_open, inline, heading_close
        continue;
      }
    }

    // 通常のブロック要素
    const blockRes = parseSingleBlock(tokens, i);
    rootElements.push(...blockRes.elements);
    i = blockRes.nextIndex;
  }

  // マルチカラムが設定されていなければSingleSlotにする
  if (bodySlot.type === 'single') {
    bodySlot = {
      type: 'single',
      elements: rootElements,
    };
  }

  const slots: SlideSlots = {
    header,
    body: bodySlot,
    footer: pageNumber !== undefined ? { pageNumber } : undefined,
  };

  const slideType: SlideType = index === 0 ? 'title' : 'content';

  return {
    index,
    type: slideType,
    slots,
    note,
  };
}

function parseNoteContainer(
  tokens: readonly Token[],
  startIndex: number
): { noteText: string; nextIndex: number } {
  let i = startIndex + 1;
  const lines: string[] = [];

  while (i < tokens.length) {
    const current = tokens[i];
    if (!current) {
      break;
    }

    if (current.type === 'container_note_close') {
      i++;
      break;
    }

    if (current.type === 'inline') {
      lines.push(current.content);
    } else if (current.content) {
      lines.push(current.content);
    }

    i++;
  }

  return {
    noteText: lines.join('\n').trim(),
    nextIndex: i,
  };
}

function parseColumnsContainer(
  tokens: readonly Token[],
  startIndex: number
): { columnsSlot: ColumnsSlot; nextIndex: number } {
  const openToken = tokens[startIndex];
  const info = openToken ? openToken.info : '';
  const ratioMatch = info.match(/ratio=["']?([^"'\s]+)["']?/);
  const ratio = ratioMatch ? ratioMatch[1] : undefined;

  const columns: Column[] = [];
  let i = startIndex + 1;
  let columnIndex = 0;

  while (i < tokens.length) {
    const current = tokens[i];
    if (!current) {
      break;
    }

    if (current.type === 'container_columns_close') {
      i++;
      break;
    }

    if (current.type === 'container_column_open') {
      columnIndex++;
      i++;
      const colElements: BlockElement[] = [];

      while (i < tokens.length) {
        const colToken = tokens[i];
        if (!colToken) {
          break;
        }

        if (colToken.type === 'container_column_close') {
          i++;
          break;
        }

        const blockRes = parseSingleBlock(tokens, i);
        colElements.push(...blockRes.elements);
        i = blockRes.nextIndex;
      }

      columns.push({
        id: `col-${columnIndex}`,
        elements: colElements,
      });
    } else {
      i++;
    }
  }

  return {
    columnsSlot: {
      type: 'columns',
      ratio,
      columns,
    },
    nextIndex: i,
  };
}
