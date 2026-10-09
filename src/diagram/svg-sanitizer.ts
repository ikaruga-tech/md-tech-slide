import { DOMParser, XMLSerializer, type Node, type Element } from '@xmldom/xmldom';
import type { DiagramViewBox } from '../types/ir.js';

export interface SanitizedSvgResult {
  readonly svg: string;
  readonly viewBox: DiagramViewBox;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
}

export class SanitizeSvgError extends Error {
  readonly code: 'mermaid-invalid-svg' | 'mermaid-output-unsafe';

  constructor(code: 'mermaid-invalid-svg' | 'mermaid-output-unsafe', message: string) {
    super(message);
    this.name = 'SanitizeSvgError';
    this.code = code;
  }
}

const MAX_SVG_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_DOM_NODES = 10_000;
const MAX_NESTING_DEPTH = 32;
const MAX_ATTRS_PER_ELEMENT = 50;
const MAX_TOTAL_ATTRS = 2_000;
const MAX_NAMESPACES = 20;
const MAX_DIMENSION_PX = 10_000;
const MIN_ASPECT_RATIO = 0.01;
const MAX_ASPECT_RATIO = 100.0;

const FORBIDDEN_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'applet',
  'meta',
  'link',
]);

const DANGEROUS_CSS_PATTERNS = [/@import/i, /expression\s*\(/i, /-moz-binding/i, /behavior\s*:/i];

function checkDangerousCss(css: string, contextDescription: string): void {
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    if (pattern.test(css)) {
      throw new SanitizeSvgError(
        'mermaid-output-unsafe',
        `Dangerous CSS pattern detected inside ${contextDescription}.`
      );
    }
  }

  // Reject non-local url(...) references (allow only local url(#...))
  const urlRegex = /url\s*\(\s*([^)]+?)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(css)) !== null) {
    const rawTarget = match[1]!
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (!rawTarget.startsWith('#') || rawTarget.includes(':') || rawTarget.includes('//')) {
      throw new SanitizeSvgError(
        'mermaid-output-unsafe',
        `Non-local URL detected inside ${contextDescription}. Only local fragment identifiers (url(#...)) are permitted.`
      );
    }
  }
}

function checkAttributeUrl(attrName: string, value: string): void {
  const urlRegex = /url\s*\(\s*([^)]+?)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(value)) !== null) {
    const rawTarget = match[1]!
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (!rawTarget.startsWith('#') || rawTarget.includes(':') || rawTarget.includes('//')) {
      throw new SanitizeSvgError(
        'mermaid-output-unsafe',
        `Unsafe URL reference in attribute "${attrName}". Only local fragment identifiers (#...) are permitted.`
      );
    }
  }
}

function validateDomTree(root: Element): void {
  let totalNodes = 0;
  let totalAttrs = 0;
  let totalNamespaces = 0;

  function walk(node: Node, depth: number): void {
    totalNodes++;
    if (totalNodes > MAX_DOM_NODES) {
      throw new SanitizeSvgError(
        'mermaid-invalid-svg',
        `SVG exceeds maximum node limit of ${MAX_DOM_NODES}.`
      );
    }

    if (depth > MAX_NESTING_DEPTH) {
      throw new SanitizeSvgError(
        'mermaid-invalid-svg',
        `SVG exceeds maximum nesting depth of ${MAX_NESTING_DEPTH}.`
      );
    }

    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element;
      const rawTagName = el.localName || el.tagName || '';
      const localTagName = rawTagName.split(':').pop()!.toLowerCase();

      // 有害タグ検査
      if (FORBIDDEN_TAGS.has(localTagName)) {
        throw new SanitizeSvgError(
          'mermaid-output-unsafe',
          `Forbidden SVG element detected: <${rawTagName}>.`
        );
      }

      // style タグ内の CSS 検査
      if (localTagName === 'style') {
        const styleContent = el.textContent || '';
        checkDangerousCss(styleContent, '<style> element');
      }

      // 属性検査
      const attrs = el.attributes;
      if (attrs) {
        if (attrs.length > MAX_ATTRS_PER_ELEMENT) {
          throw new SanitizeSvgError(
            'mermaid-invalid-svg',
            `Element <${rawTagName}> exceeds maximum attributes per element (${MAX_ATTRS_PER_ELEMENT}).`
          );
        }

        for (let i = 0; i < attrs.length; i++) {
          const attr = attrs[i]!;
          totalAttrs++;
          if (totalAttrs > MAX_TOTAL_ATTRS) {
            throw new SanitizeSvgError(
              'mermaid-invalid-svg',
              `SVG exceeds maximum total attributes limit of ${MAX_TOTAL_ATTRS}.`
            );
          }

          const rawAttrName = attr.name || '';
          const localAttrName = (
            attr.localName ||
            rawAttrName.split(':').pop() ||
            ''
          ).toLowerCase();
          const attrValue = attr.value || '';

          // XML 名前空間宣言のカウント
          if (rawAttrName === 'xmlns' || rawAttrName.startsWith('xmlns:')) {
            totalNamespaces++;
            if (totalNamespaces > MAX_NAMESPACES) {
              throw new SanitizeSvgError(
                'mermaid-invalid-svg',
                `SVG exceeds maximum namespace declarations limit of ${MAX_NAMESPACES}.`
              );
            }
          }

          // イベントハンドラー属性の拒否（on*）
          if (localAttrName.startsWith('on')) {
            throw new SanitizeSvgError(
              'mermaid-output-unsafe',
              `Event handler attribute detected: ${rawAttrName}.`
            );
          }

          // href, xlink:href, action, formaction の検査（ローカルフラグメントのみ許可）
          if (
            localAttrName === 'href' ||
            localAttrName === 'action' ||
            localAttrName === 'formaction'
          ) {
            const trimmedVal = attrValue.trim();
            if (
              trimmedVal.length > 0 &&
              (!trimmedVal.startsWith('#') || trimmedVal.includes(':') || trimmedVal.includes('//'))
            ) {
              throw new SanitizeSvgError(
                'mermaid-output-unsafe',
                `Non-local URI target in attribute ${rawAttrName}. Only local fragment identifiers (#...) are permitted.`
              );
            }
          }

          // 全属性に対する url(...) 検査（プレゼンテーション属性 fill, stroke, filter 等を含む）
          checkAttributeUrl(rawAttrName, attrValue);

          // style 属性の検査
          if (localAttrName === 'style') {
            checkDangerousCss(attrValue, 'style attribute');
          }
        }
      }
    }

    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i]!, depth + 1);
      }
    }
  }

  walk(root, 1);
}

export function sanitizeSvg(rawSvg: string): SanitizedSvgResult {
  // 1. バイト数上限検査
  if (Buffer.byteLength(rawSvg, 'utf8') > MAX_SVG_BYTES) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `SVG size exceeds 2MB limit (size: ${Buffer.byteLength(rawSvg, 'utf8')} bytes)`
    );
  }

  // 2. DTD / エンティティ宣言の即時拒否
  if (/<!DOCTYPE/i.test(rawSvg) || /<!ENTITY/i.test(rawSvg)) {
    throw new SanitizeSvgError(
      'mermaid-output-unsafe',
      'SVG contains forbidden DOCTYPE or ENTITY declaration.'
    );
  }

  // 3. XML構文解析（エラー捕捉）
  const parseErrors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, msg: string) => {
      parseErrors.push(`[${level}] ${msg}`);
    },
  });

  let doc: ReturnType<typeof parser.parseFromString>;
  try {
    doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  } catch (err) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `XML parser syntax error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (parseErrors.length > 0) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `Malformed SVG syntax: ${parseErrors.join('; ')}`
    );
  }

  // 4. 単一 <svg> ルート検証
  const root = doc.documentElement;
  if (!root || (root.localName || root.tagName || '').toLowerCase() !== 'svg') {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      'Root element must be a single <svg> element.'
    );
  }

  // ルート直下の要素ノード数が1つであることを確認（複数ルートの拒否）
  let elementCount = 0;
  for (let i = 0; i < doc.childNodes.length; i++) {
    const node = doc.childNodes[i];
    if (node && node.nodeType === 1 /* ELEMENT_NODE */) {
      elementCount++;
    }
  }
  if (elementCount !== 1) {
    throw new SanitizeSvgError('mermaid-invalid-svg', 'SVG must contain exactly one root element.');
  }

  // 5. DOMツリー走査と資源上限・セキュリティ規則検証
  validateDomTree(root);

  // 6. viewBox および寸法の検証と正規化
  const rawViewBox = root.getAttribute('viewBox');
  let viewBox: DiagramViewBox;

  if (rawViewBox) {
    const parts = rawViewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      parts.length !== 4 ||
      parts.some((n) => !Number.isFinite(n)) ||
      parts[2]! <= 0 ||
      parts[3]! <= 0
    ) {
      throw new SanitizeSvgError(
        'mermaid-invalid-svg',
        `Invalid viewBox attribute: "${rawViewBox}". Must be 4 finite numbers with positive width and height.`
      );
    }
    viewBox = {
      minX: parts[0]!,
      minY: parts[1]!,
      width: parts[2]!,
      height: parts[3]!,
    };
  } else {
    // width / height 属性からの補完を試行
    const rawWidth = root.getAttribute('width');
    const rawHeight = root.getAttribute('height');
    const widthVal = parseDimensionPx(rawWidth);
    const heightVal = parseDimensionPx(rawHeight);

    if (widthVal === null || heightVal === null || widthVal <= 0 || heightVal <= 0) {
      throw new SanitizeSvgError(
        'mermaid-invalid-svg',
        'SVG lacks a valid viewBox and dimension attributes (width/height) cannot be resolved.'
      );
    }

    viewBox = {
      minX: 0,
      minY: 0,
      width: widthVal,
      height: heightVal,
    };
    root.setAttribute('viewBox', `0 0 ${widthVal} ${heightVal}`);
  }

  // viewBox 寸法上限およびアスペクト比の検証
  if (viewBox.width > MAX_DIMENSION_PX || viewBox.height > MAX_DIMENSION_PX) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `SVG dimension exceeds maximum allowed size of ${MAX_DIMENSION_PX}px (width: ${viewBox.width}, height: ${viewBox.height}).`
    );
  }

  const aspectRatio = viewBox.width / viewBox.height;
  if (
    !Number.isFinite(aspectRatio) ||
    aspectRatio < MIN_ASPECT_RATIO ||
    aspectRatio > MAX_ASPECT_RATIO
  ) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `SVG aspect ratio ${aspectRatio.toFixed(4)} is outside permissible range [${MIN_ASPECT_RATIO}, ${MAX_ASPECT_RATIO}].`
    );
  }

  // 6.5 インライン style="..." 属性を <style> 内のクラス定義へ昇格
  // VS Code WebviewのCSP（style-src-attr）違反を完全排除するため、
  // すべてのインライン style 属性を除去し、SVG内の <style> タグ（CSP SHA-256ハッシュ対象）へ集約する
  convertInlineStylesToClasses(doc, root);

  // 7. 再パース検証（requireWellFormed: true とセキュリティ再検査）
  const serializer = new XMLSerializer();
  let sanitizedString: string;
  try {
    const s = serializer as unknown as {
      serializeToString: (node: Node, options?: { requireWellFormed?: boolean }) => string;
    };
    sanitizedString = s.serializeToString(doc, { requireWellFormed: true });
  } catch (err) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `XMLSerializer failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const reparseErrors: string[] = [];
  const reparseParser = new DOMParser({
    onError: (level: string, msg: string) => {
      reparseErrors.push(`[${level}] ${msg}`);
    },
  });

  let reparseDoc: ReturnType<typeof reparseParser.parseFromString>;
  try {
    reparseDoc = reparseParser.parseFromString(sanitizedString, 'image/svg+xml');
  } catch (err) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `Sanitized SVG failed re-parsing: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (reparseErrors.length > 0) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      `Sanitized SVG failed re-parsing validation: ${reparseErrors.join('; ')}`
    );
  }

  const reparseRoot = reparseDoc.documentElement;
  if (
    !reparseRoot ||
    (reparseRoot.localName || reparseRoot.tagName || '').toLowerCase() !== 'svg'
  ) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      'Reparsed SVG root element must be a single <svg> element.'
    );
  }

  let reparseElementCount = 0;
  for (let i = 0; i < reparseDoc.childNodes.length; i++) {
    const node = reparseDoc.childNodes[i];
    if (node && node.nodeType === 1 /* ELEMENT_NODE */) {
      reparseElementCount++;
    }
  }
  if (reparseElementCount !== 1) {
    throw new SanitizeSvgError(
      'mermaid-invalid-svg',
      'Reparsed SVG must contain exactly one root element.'
    );
  }

  // 再パース後DOMツリーに対しても同一のセキュリティ規則・資源上限を再適用
  validateDomTree(reparseRoot);

  return {
    svg: sanitizedString,
    viewBox,
    width: viewBox.width,
    height: viewBox.height,
    aspectRatio,
  };
}

function parseDimensionPx(val: string | null): number | null {
  if (!val) {
    return null;
  }
  const trimmed = val.trim();
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function convertInlineStylesToClasses(
  doc: ReturnType<InstanceType<typeof DOMParser>['parseFromString']>,
  root: Element
): void {
  const elementsWithStyle: { el: Element; style: string }[] = [];

  function collect(node: Node): void {
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element;
      const rawStyle = el.getAttribute('style');
      if (rawStyle !== null) {
        const trimmed = rawStyle.trim();
        if (trimmed.length > 0) {
          elementsWithStyle.push({ el, style: trimmed });
        }
        el.removeAttribute('style');
      }
    }
    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        collect(children[i]!);
      }
    }
  }

  collect(root);

  if (elementsWithStyle.length === 0) {
    return;
  }

  // Find or create a <style> element
  let styleEl: Element;
  const existingStyles = root.getElementsByTagName('style');
  if (existingStyles && existingStyles.length > 0) {
    styleEl = existingStyles[0] as Element;
  } else {
    styleEl = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    if (root.firstChild) {
      root.insertBefore(styleEl, root.firstChild);
    } else {
      root.appendChild(styleEl);
    }
  }

  let generatedCss = '';
  let counter = 0;
  const styleToClass = new Map<string, string>();

  for (const item of elementsWithStyle) {
    let cls = styleToClass.get(item.style);
    if (!cls) {
      counter++;
      cls = `svg-s-${counter}`;
      styleToClass.set(item.style, cls);
      const ruleBody = item.style.endsWith(';') ? item.style : `${item.style};`;
      generatedCss += `\n.${cls} { ${ruleBody} }`;
    }
    const existingClass = item.el.getAttribute('class') || '';
    item.el.setAttribute('class', existingClass ? `${existingClass} ${cls}` : cls);
  }

  const existingContent = styleEl.textContent || '';
  styleEl.textContent = `${existingContent}${generatedCss}\n`;
}
