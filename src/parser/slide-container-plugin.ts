import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';

const SUPPORTED_CONTAINERS = ['columns', 'column', 'note'] as const;
type SupportedContainer = (typeof SUPPORTED_CONTAINERS)[number];

function getContainerName(params: string): SupportedContainer | null {
  const trimmed = params.trim();
  for (const name of SUPPORTED_CONTAINERS) {
    if (trimmed === name || trimmed.startsWith(`${name} `) || trimmed.startsWith(`${name}=`)) {
      return name;
    }
  }
  return null;
}

function getLineStart(state: StateBlock, line: number): number {
  const bMark = state.bMarks[line] ?? 0;
  const tShift = state.tShift[line] ?? 0;
  return bMark + tShift;
}

function getLineEnd(state: StateBlock, line: number): number {
  return state.eMarks[line] ?? 0;
}

export function slideContainerPlugin(md: MarkdownIt): void {
  function container(
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean
  ): boolean {
    const start = getLineStart(state, startLine);
    const max = getLineEnd(state, startLine);

    // 先頭が ':' かチェック
    if (state.src.charCodeAt(start) !== 0x3a /* ':' */) {
      return false;
    }

    // 連続する ':' をカウント（最低3つ）
    let pos = start;
    while (pos < max && state.src.charCodeAt(pos) === 0x3a) {
      pos++;
    }
    const markerCount = pos - start;
    if (markerCount < 3) {
      return false;
    }

    const params = state.src.slice(pos, max);
    const containerName = getContainerName(params);
    if (!containerName) {
      return false;
    }

    if (silent) {
      return true;
    }

    // ネストを考慮して対応する閉じタグを探索
    let nextLine = startLine;
    let nesting = 1;
    let autoClosed = false;

    while (nextLine < endLine - 1) {
      nextLine++;
      const currentStart = getLineStart(state, nextLine);
      const currentMax = getLineEnd(state, nextLine);
      const sCount = state.sCount[nextLine] ?? 0;

      if (currentStart < currentMax && sCount < state.blkIndent) {
        break;
      }

      if (state.src.charCodeAt(currentStart) !== 0x3a) {
        continue;
      }

      let currentPos = currentStart;
      while (currentPos < currentMax && state.src.charCodeAt(currentPos) === 0x3a) {
        currentPos++;
      }
      if (currentPos - currentStart < 3) {
        continue;
      }

      const rest = state.src.slice(currentPos, currentMax).trim();
      if (rest.length === 0) {
        // 閉じタグ ':::'
        nesting--;
        if (nesting === 0) {
          autoClosed = true;
          break;
        }
      } else {
        // ネストした別のコンテナ開始タグ
        const nestedName = getContainerName(rest);
        if (nestedName) {
          nesting++;
        }
      }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;
    // container 型として親スコープを一時的に上書き
    (state as { parentType: unknown }).parentType = 'container';
    state.lineMax = nextLine;

    const tokenOpen = state.push(`container_${containerName}_open`, 'div', 1);
    tokenOpen.markup = ':::';
    tokenOpen.block = true;
    tokenOpen.info = params;
    tokenOpen.map = [startLine, nextLine];

    state.md.block.tokenize(state, startLine + 1, nextLine);

    const tokenClose = state.push(`container_${containerName}_close`, 'div', -1);
    tokenClose.markup = ':::';
    tokenClose.block = true;

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  }

  md.block.ruler.before('fence', 'slide_containers', container, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}
