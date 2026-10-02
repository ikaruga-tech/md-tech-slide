import JSZip from 'jszip';
import * as fs from 'node:fs';

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

      return {
        slideNumber: slideNum,
        xml,
        hasTable,
        hasImage,
        hasNotes: Boolean(notesXml),
        notesText,
        textContents: textMatches,
      };
    })
  );

  return {
    slideCount: slides.length,
    slideDimensions: {
      cx,
      cy,
      widthInches,
      heightInches,
    },
    slides,
  };
}
