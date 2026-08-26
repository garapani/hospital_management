// Local declarations for pdfmake's UMD build subpaths and the type-only 'pdfmake/interfaces'
// entry. pdfmake@0.2.20 ships no types and @types/pdfmake targets the 0.3.x API (whose build
// entry no longer matches this runtime), so we pin our own pragmatic surface here. Only the
// shapes our platform wrapper and report builders use are declared; the index signature keeps
// the rest of pdfmake's rich content-model permissive rather than inventing incorrect types.

declare module 'pdfmake/interfaces' {
  export interface PdfDocumentStyle {
    fontSize?: number;
    bold?: boolean;
    italics?: boolean;
    color?: string;
    fillColor?: string;
    margin?: number | [number, number, number, number];
    alignment?: 'left' | 'center' | 'right' | 'justify';
    lineHeight?: number;
    [key: string]: unknown;
  }

  export interface PdfCell {
    text?: string;
    style?: string;
    bold?: boolean;
    color?: string;
    [key: string]: unknown;
  }

  export type PdfTableRow = Array<string | PdfCell>;

  export interface PdfContentItem {
    text?: string;
    style?: string;
    bold?: boolean;
    color?: string;
    columns?: PdfContentItem[][];
    table?: {
      headerRows?: number;
      /** Absolute numbers or relative widths ('*', 'auto', '20%'). */
      widths?: Array<number | string>;
      body: PdfTableRow[];
    };
    [key: string]: unknown;
  }

  export type PdfContent = string | PdfContentItem | Array<string | PdfContentItem>;

  export interface TDocumentDefinitions {
    content: PdfContent;
    styles?: Record<string, PdfDocumentStyle>;
    defaultStyle?: PdfDocumentStyle;
    pageSize?: string;
    pageMargins?: number | [number, number, number, number];
    header?: PdfContent;
    footer?: PdfContent;
    info?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface TCreatedPdf {
    getBuffer(callback: (result: Buffer) => void): void;
    [key: string]: unknown;
  }
}

declare module 'pdfmake/build/pdfmake.js' {
  import type { TCreatedPdf, TDocumentDefinitions } from 'pdfmake/interfaces';
  const pdfMake: {
    vfs: Record<string, string>;
    createPdf(docDefinition: TDocumentDefinitions): TCreatedPdf;
  };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts.js' {
  /** Base64-encoded font files keyed by filename (e.g. 'Roboto-Regular.ttf'). */
  const vfs: Record<string, string>;
  export default vfs;
}
