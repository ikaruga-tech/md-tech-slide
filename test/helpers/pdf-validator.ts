import { PDFDocument } from 'pdf-lib';
import { PDFParse } from 'pdf-parse';

export interface PdfValidationResult {
  readonly pageCount: number;
  readonly pages: readonly {
    readonly pageNumber: number;
    readonly widthPt: number;
    readonly heightPt: number;
    readonly aspectRatio: '16:9' | '4:3' | 'other';
  }[];
  readonly text: string;
}

export async function validatePdfBuffer(buffer: Buffer | Uint8Array): Promise<PdfValidationResult> {
  const pdfDoc = await PDFDocument.load(buffer);
  const pageCount = pdfDoc.getPageCount();

  const pages = pdfDoc.getPages().map((page, index) => {
    const { width, height } = page.getSize();
    const w = Math.round(width * 100) / 100;
    const h = Math.round(height * 100) / 100;

    let aspectRatio: '16:9' | '4:3' | 'other' = 'other';
    // 16:9: 960 x 540 pt (tolerance +/- 2pt)
    if (Math.abs(w - 960) <= 2 && Math.abs(h - 540) <= 2) {
      aspectRatio = '16:9';
    } else if (Math.abs(w - 720) <= 2 && Math.abs(h - 540) <= 2) {
      // 4:3: 720 x 540 pt (tolerance +/- 2pt)
      aspectRatio = '4:3';
    }

    return {
      pageNumber: index + 1,
      widthPt: w,
      heightPt: h,
      aspectRatio,
    };
  });

  const parser = new PDFParse({ data: Buffer.from(buffer) });
  const parsedTextResult = await parser.getText();
  await parser.destroy().catch(() => {});

  return {
    pageCount,
    pages,
    text: parsedTextResult.text,
  };
}
