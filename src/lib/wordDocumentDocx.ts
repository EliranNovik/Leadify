import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type FileChild,
  type IBorderOptions,
} from 'docx';
import {
  DEFAULT_COMPANY_SIGNATURE_SETTINGS,
  type CompanySignatureSettings,
} from './companyEmailSignature';

type TiptapMark = { type: string; attrs?: Record<string, unknown> };
type TiptapNode = {
  type?: string;
  text?: string;
  marks?: TiptapMark[];
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
};

export type WordLetterhead = {
  companyName: string;
  address: string;
  website: string;
  logoUrl: string | null;
};

const BODY_FONT = 'Arial';
const BODY_SIZE = 24; // 12pt
const BODY_COLOR = '1C1917';
const MUTED_COLOR = '57534E';
const FOOTER_COLOR = '78716C';
const RULE_COLOR = 'E7E5E4';
const PAGE_CONTENT_DXA = 10091; // 178mm
const LOGO_DISPLAY_HEIGHT = 40;

const NONE_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = {
  top: NONE_BORDER,
  bottom: NONE_BORDER,
  left: NONE_BORDER,
  right: NONE_BORDER,
};

export function formatWordDocumentHeaderDate(date: Date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function letterheadFromSettings(settings?: CompanySignatureSettings | null): WordLetterhead {
  const src = settings ?? DEFAULT_COMPANY_SIGNATURE_SETTINGS;
  return {
    companyName: src.company_name?.trim() || DEFAULT_COMPANY_SIGNATURE_SETTINGS.company_name,
    address: src.office_address?.trim() || DEFAULT_COMPANY_SIGNATURE_SETTINGS.office_address || '',
    website: src.website_url?.trim() || DEFAULT_COMPANY_SIGNATURE_SETTINGS.website_url || '',
    logoUrl: src.logo_url || '/DPL-LOGO1.png',
  };
}

function hexColor(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  const hex = value.match(/^#?([0-9a-fA-F]{6})$/);
  if (hex) return hex[1].toUpperCase();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return undefined;
  return [rgb[1], rgb[2], rgb[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function halfPointsFromFontSize(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim();
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (value.endsWith('pt')) return Math.round(n * 2);
  if (value.endsWith('px') || n > 32) return Math.round(n * 1.5);
  return Math.round(n * 2);
}

function firstFontName(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const name = String(raw)
    .split(',')[0]
    ?.replace(/['"]/g, '')
    .trim();
  return name || undefined;
}

function textRunsFromInline(nodes: TiptapNode[] | undefined, extras?: { bold?: boolean; size?: number }): TextRun[] {
  if (!nodes?.length) {
    return [new TextRun({ text: '', font: BODY_FONT, size: extras?.size ?? BODY_SIZE, color: BODY_COLOR })];
  }
  const runs: TextRun[] = [];

  const walk = (node: TiptapNode) => {
    if (node.type === 'hardBreak') {
      runs.push(new TextRun({ break: 1 }));
      return;
    }
    if (node.type === 'text' && node.text != null) {
      const marks = node.marks ?? [];
      const style = marks.find((m) => m.type === 'textStyle')?.attrs ?? {};
      const highlight = marks.find((m) => m.type === 'highlight')?.attrs?.color;
      runs.push(
        new TextRun({
          text: node.text,
          font: firstFontName(style.fontFamily) || BODY_FONT,
          size: halfPointsFromFontSize(style.fontSize) ?? extras?.size ?? BODY_SIZE,
          color: hexColor(style.color) || BODY_COLOR,
          bold: extras?.bold || marks.some((m) => m.type === 'bold'),
          italics: marks.some((m) => m.type === 'italic'),
          underline: marks.some((m) => m.type === 'underline') ? {} : undefined,
          strike: marks.some((m) => m.type === 'strike'),
          shading: hexColor(highlight) ? { type: 'clear', fill: hexColor(highlight) } : undefined,
        }),
      );
      return;
    }
    node.content?.forEach(walk);
  };

  nodes.forEach(walk);
  return runs.length
    ? runs
    : [new TextRun({ text: '', font: BODY_FONT, size: extras?.size ?? BODY_SIZE, color: BODY_COLOR })];
}

function alignmentFromNode(node: TiptapNode) {
  const align = String(node.attrs?.textAlign || 'left');
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function paragraphSpacing(after = 200) {
  return { after, line: 360, lineRule: 'auto' as const };
}

function paragraphsFromNode(
  node: TiptapNode,
  list?: { reference: string; level: number },
): Paragraph[] {
  if (node.type === 'bulletList') {
    return (node.content || []).flatMap((item) =>
      paragraphsFromNode(item, { reference: 'word-doc-bullets', level: list ? list.level + 1 : 0 }),
    );
  }
  if (node.type === 'orderedList') {
    return (node.content || []).flatMap((item) =>
      paragraphsFromNode(item, { reference: 'word-doc-numbers', level: list ? list.level + 1 : 0 }),
    );
  }
  if (node.type === 'listItem') {
    const inner = node.content?.length ? node.content : [{ type: 'paragraph', content: [] }];
    return inner.flatMap((child, idx) => {
      const numbering = idx === 0 && list ? { reference: list.reference, level: Math.min(list.level, 2) } : undefined;
      if (child.type === 'paragraph' || child.type === 'heading') {
        return [
          new Paragraph({
            alignment: alignmentFromNode(child),
            spacing: paragraphSpacing(120),
            numbering,
            children: textRunsFromInline(child.content),
          }),
        ];
      }
      return paragraphsFromNode(child, numbering);
    });
  }

  if (node.type === 'heading') {
    const level = Number(node.attrs?.level) || 1;
    const size = level <= 1 ? 38 : 30;
    return [
      new Paragraph({
        alignment: alignmentFromNode(node),
        spacing: { before: 200, after: 160, line: 360, lineRule: 'auto' },
        children: textRunsFromInline(node.content, { bold: true, size }),
      }),
    ];
  }

  if (node.type === 'paragraph' || node.type === 'blockquote') {
    return [
      new Paragraph({
        alignment: alignmentFromNode(node),
        spacing: paragraphSpacing(200),
        children: textRunsFromInline(node.content),
      }),
    ];
  }

  return (node.content || []).flatMap((child) => paragraphsFromNode(child, list));
}

function bodyParagraphsFromTiptap(doc: unknown): Paragraph[] {
  const root = doc as TiptapNode;
  const blocks = root?.type === 'doc' ? root.content || [] : [];
  const paragraphs = blocks.flatMap((block) => paragraphsFromNode(block));
  return paragraphs.length
    ? paragraphs
    : [new Paragraph({ children: [new TextRun({ text: '', font: BODY_FONT, size: BODY_SIZE })] })];
}

function detectImageType(bytes: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' | 'unknown' {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return 'unknown';
}

function absoluteAssetUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

function logoCandidateUrls(logoUrl: string): string[] {
  const primary = absoluteAssetUrl(logoUrl);
  const extras: string[] = [primary];
  if (logoUrl.includes('DPL-LOGO1')) extras.push(absoluteAssetUrl('/DPLOGO1.png'));
  if (logoUrl.includes('DPLOGO1') && !logoUrl.includes('DPL-LOGO1')) extras.push(absoluteAssetUrl('/DPL-LOGO1.png'));
  return [...new Set(extras)];
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load logo'));
    img.src = src;
  });
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode logo'));
        return;
      }
      void blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}

function displaySize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const height = LOGO_DISPLAY_HEIGHT;
  const width = Math.max(1, Math.round((naturalWidth / naturalHeight) * height));
  return { width: Math.min(width, 220), height };
}

async function prepareLogo(logoUrl: string | null): Promise<{
  data: Uint8Array;
  type: 'png' | 'jpg' | 'gif';
  width: number;
  height: number;
} | null> {
  if (!logoUrl) return null;

  for (const url of logoCandidateUrls(logoUrl)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const blobUrl = URL.createObjectURL(new Blob([bytes]));
      try {
        const img = await loadHtmlImage(blobUrl);
        if (!img.naturalWidth || !img.naturalHeight) continue;
        const size = displaySize(img.naturalWidth, img.naturalHeight);
        const kind = detectImageType(bytes);
        if (kind === 'png' || kind === 'jpg' || kind === 'gif') {
          return { data: bytes, type: kind, ...size };
        }

        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, 0, 0);
        return { data: await canvasToPngBytes(canvas), type: 'png', ...size };
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function emptyCell(width: number): TableCell {
  return new TableCell({
    borders: NO_BORDERS,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [new Paragraph({ children: [] })],
  });
}

async function letterheadBlock(letterhead: WordLetterhead): Promise<FileChild[]> {
  const logo = await prepareLogo(letterhead.logoUrl);
  const dateCellWidth = 2600;
  const logoCellWidth = logo ? Math.min(Math.max(logo.width * 15 + 80, 900), 3600) : 0;
  const nameCellWidth = PAGE_CONTENT_DXA - dateCellWidth - logoCellWidth;

  const nameRun = new TextRun({
    text: letterhead.companyName,
    bold: true,
    font: BODY_FONT,
    size: 22,
    color: BODY_COLOR,
  });
  const dateRun = new TextRun({
    text: formatWordDocumentHeaderDate(),
    font: BODY_FONT,
    size: 20,
    color: MUTED_COLOR,
  });

  const cells: TableCell[] = [];
  if (logo) {
    cells.push(
      new TableCell({
        borders: NO_BORDERS,
        width: { size: logoCellWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 0, bottom: 0, left: 0, right: 80 },
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                type: logo.type,
                data: logo.data,
                transformation: { width: logo.width, height: logo.height },
              }),
            ],
          }),
        ],
      }),
    );
  }
  cells.push(
    new TableCell({
      borders: NO_BORDERS,
      width: { size: nameCellWidth, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 0, bottom: 0, left: 0, right: 120 },
      children: [new Paragraph({ children: [nameRun] })],
    }),
  );
  cells.push(
    new TableCell({
      borders: NO_BORDERS,
      width: { size: dateCellWidth, type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [dateRun] })],
    }),
  );

  const columnWidths = [logoCellWidth, nameCellWidth, dateCellWidth].filter((width) => width > 0);
  return [
    new Table({
      width: { size: PAGE_CONTENT_DXA, type: WidthType.DXA },
      columnWidths,
      rows: [new TableRow({ children: cells.length ? cells : [emptyCell(PAGE_CONTENT_DXA)] })],
    }),
    new Paragraph({
      spacing: { before: 80, after: 280 },
      border: {
        bottom: { color: RULE_COLOR, space: 1, style: BorderStyle.SINGLE, size: 6 },
      },
      children: [],
    }),
  ];
}

export async function buildWordDocumentBlob(params: {
  title: string;
  content: unknown;
  letterhead: WordLetterhead;
}): Promise<Blob> {
  const headerChildren = await letterheadBlock(params.letterhead);
  const footerLine = [params.letterhead.address, params.letterhead.website]
    .filter(Boolean)
    .join('  ·  ');

  const doc = new Document({
    title: params.title,
    styles: {
      default: {
        document: {
          run: {
            font: BODY_FONT,
            size: BODY_SIZE,
            color: BODY_COLOR,
          },
          paragraph: {
            spacing: paragraphSpacing(200),
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'word-doc-bullets',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
        {
          reference: 'word-doc-numbers',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1020, right: 907, bottom: 1134, left: 907 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: {
                  top: { color: RULE_COLOR, space: 8, style: BorderStyle.SINGLE, size: 6 },
                },
                children: [
                  new TextRun({
                    text: footerLine ? `${footerLine}  ·  ` : '',
                    font: BODY_FONT,
                    size: 16,
                    color: FOOTER_COLOR,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: BODY_FONT,
                    size: 16,
                    color: FOOTER_COLOR,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...headerChildren, ...bodyParagraphsFromTiptap(params.content)] as FileChild[],
      },
    ],
  });

  return Packer.toBlob(doc);
}

export function wordFileName(title: string): string {
  const safe = title.replace(/[^\w.\-()+\s]/g, '_').trim() || 'document';
  return safe.toLowerCase().endsWith('.docx') ? safe : `${safe}.docx`;
}
