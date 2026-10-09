import JSZip from 'jszip';
import * as fs from 'node:fs';

export interface PptxTextRunInfo {
  readonly text: string;
  readonly fontSizePt?: number;
  readonly latinTypeface?: string;
  readonly eaTypeface?: string;
}

export interface PptxStructureInfo {
  readonly slideCount: number;
  readonly slideDimensions: {
    readonly cx: number; // EMU (914400 EMU = 1 inch)
    readonly cy: number;
    readonly widthInches: number;
    readonly heightInches: number;
  };
  readonly slides: readonly {
    readonly slideNumber: number;
    readonly xml: string;
    readonly hasTable: boolean;
    readonly hasImage: boolean;
    readonly hasNotes: boolean;
    readonly notesText?: string;
    readonly textContents: readonly string[];
    readonly textRuns: readonly PptxTextRunInfo[];
    readonly rels: readonly {
      readonly id: string;
      readonly type: string;
      readonly target: string;
    }[];
  }[];
  readonly mediaFiles: readonly string[];
  readonly contentTypes: readonly {
    readonly extension?: string;
    readonly partName?: string;
    readonly contentType: string;
  }[];
}

const EMU_PER_INCH = 914400;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractTextRunsFromXml(xml: string): PptxTextRunInfo[] {
  const runs: PptxTextRunInfo[] = [];

  // Match text runs (<a:r> ... </a:r>) and fields (<a:fld> ... </a:fld>)
  const runMatches = xml.matchAll(/<(?:a:r|a:fld)[\s>][\s\S]*?<\/(?:a:r|a:fld)>/g);

  for (const match of runMatches) {
    const runXml = match[0];

    const tMatch = runXml.match(/<a:t>([^<]*)<\/a:t>/);
    if (!tMatch) {
      continue;
    }
    const text = decodeXml(tMatch[1] ?? '');

    let fontSizePt: number | undefined;
    let latinTypeface: string | undefined;
    let eaTypeface: string | undefined;

    const rPrMatch = runXml.match(/<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>/);
    if (rPrMatch) {
      const rPrAttrs = rPrMatch[1] ?? '';
      const rPrBody = rPrMatch[2] ?? '';

      const szMatch = rPrAttrs.match(/\bsz="(\d+)"/);
      if (szMatch) {
        fontSizePt = parseInt(szMatch[1] ?? '0', 10) / 100;
      }

      const latinMatch = rPrBody.match(/<a:latin\b[^>]*\btypeface="([^"]*)"/);
      if (latinMatch) {
        latinTypeface = decodeXml(latinMatch[1] ?? '');
      }

      const eaMatch = rPrBody.match(/<a:ea\b[^>]*\btypeface="([^"]*)"/);
      if (eaMatch) {
        eaTypeface = decodeXml(eaMatch[1] ?? '');
      }
    }

    runs.push({
      text,
      fontSizePt,
      latinTypeface,
      eaTypeface,
    });
  }

  return runs;
}

export async function inspectPptxFile(filePath: string): Promise<PptxStructureInfo> {
  const fileData = fs.readFileSync(filePath);
  return inspectPptxBuffer(fileData);
}

export async function inspectPptxBuffer(buffer: Buffer | Uint8Array): Promise<PptxStructureInfo> {
  const zip = await JSZip.loadAsync(buffer);

  // 1. presentation.xml から寸法を取得
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  let cx = 0;
  let cy = 0;
  if (presXml) {
    const sldSzMatch = presXml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
    if (sldSzMatch) {
      cx = parseInt(sldSzMatch[1] ?? '0', 10);
      cy = parseInt(sldSzMatch[2] ?? '0', 10);
    }
  }

  const widthInches = Math.round((cx / EMU_PER_INCH) * 100) / 100;
  const heightInches = Math.round((cy / EMU_PER_INCH) * 100) / 100;

  // 2. 各スライドの XML を解析
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      return numA - numB;
    });

  const slides = await Promise.all(
    slideFiles.map(async (filename, index) => {
      const slideNum = index + 1;
      const xml = (await zip.file(filename)?.async('string')) ?? '';
      const hasTable = xml.includes('<a:tbl>') || xml.includes('<a:tbl ');
      const hasImage = xml.includes('<p:pic>') || xml.includes('<p:pic ');

      // ノートの存在確認
      const notesFilename = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      const notesXml = await zip.file(notesFilename)?.async('string');
      let notesText: string | undefined;
      if (notesXml) {
        const textMatches = Array.from(notesXml.matchAll(/<a:t>([^<]+)<\/a:t>/g)).map((m) =>
          decodeXml(m[1] ?? '')
        );
        notesText = textMatches.join(' ').trim();
      }

      // テキスト内容の抽出
      const textMatches = Array.from(xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)).map((m) =>
        decodeXml(m[1] ?? '')
      );

      const textRuns = extractTextRunsFromXml(xml);

      // スライドのリレーションXMLの解析
      const relsFilename = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
      const relsXml = await zip.file(relsFilename)?.async('string');
      const rels: { id: string; type: string; target: string }[] = [];
      if (relsXml) {
        const relMatches = relsXml.matchAll(/<Relationship\b([^>]*)\/>/g);
        for (const match of relMatches) {
          const attrs = match[1] ?? '';
          const idMatch = attrs.match(/\bId="([^"]*)"/);
          const typeMatch = attrs.match(/\bType="([^"]*)"/);
          const targetMatch = attrs.match(/\bTarget="([^"]*)"/);
          if (idMatch && typeMatch && targetMatch) {
            rels.push({
              id: idMatch[1] ?? '',
              type: typeMatch[1] ?? '',
              target: targetMatch[1] ?? '',
            });
          }
        }
      }

      return {
        slideNumber: slideNum,
        xml,
        hasTable,
        hasImage,
        hasNotes: Boolean(notesXml),
        notesText,
        textContents: textMatches,
        textRuns,
        rels,
      };
    })
  );

  // 3. [Content_Types].xml からコンテンツタイプを抽出
  const contentTypesXml = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
  const contentTypes: { extension?: string; partName?: string; contentType: string }[] = [];
  if (contentTypesXml) {
    const defaultMatches = contentTypesXml.matchAll(/<Default\b([^>]*)\/>/g);
    for (const match of defaultMatches) {
      const attrs = match[1] ?? '';
      const extMatch = attrs.match(/\bExtension="([^"]*)"/);
      const ctMatch = attrs.match(/\bContentType="([^"]*)"/);
      if (ctMatch) {
        contentTypes.push({
          extension: extMatch ? extMatch[1] : undefined,
          contentType: ctMatch[1] ?? '',
        });
      }
    }
    const overrideMatches = contentTypesXml.matchAll(/<Override\b([^>]*)\/>/g);
    for (const match of overrideMatches) {
      const attrs = match[1] ?? '';
      const partMatch = attrs.match(/\bPartName="([^"]*)"/);
      const ctMatch = attrs.match(/\bContentType="([^"]*)"/);
      if (ctMatch) {
        contentTypes.push({
          partName: partMatch ? partMatch[1] : undefined,
          contentType: ctMatch[1] ?? '',
        });
      }
    }
  }

  return {
    slideCount: slides.length,
    slideDimensions: {
      cx,
      cy,
      widthInches,
      heightInches,
    },
    slides,
    mediaFiles: Object.keys(zip.files).filter((name) => name.startsWith('ppt/media/')),
    contentTypes,
  };
}
