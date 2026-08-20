// Pull the local pdfmake ambient declarations (pdfmake.d.ts) into this program — the package
// ships no types and nothing else references the shim file directly.
/// <reference path="./pdfmake.d.ts" />
import { Injectable } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import pdfMake from 'pdfmake/build/pdfmake.js';
import pdfFonts from 'pdfmake/build/vfs_fonts.js';

// Wire the bundled Roboto family (base64 in vfs_fonts.js) into the UMD build.
pdfMake.vfs = pdfFonts;

export type PdfDocumentDefinition = TDocumentDefinitions;

/**
 * Thin pdfmake wrapper: renders a document definition to a PDF Buffer. Platform lib — domain
 * modules (Lab/Radiology report export, future Document & Print) build their own definitions and
 * call render().
 */
@Injectable()
export class PdfService {
  render(docDefinition: PdfDocumentDefinition): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const pdfDoc = pdfMake.createPdf(docDefinition);
        pdfDoc.getBuffer((buffer: Buffer) => resolve(Buffer.from(buffer)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
