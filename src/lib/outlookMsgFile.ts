/**
 * Reading Outlook's `.msg` files in the browser.
 *
 * A `.msg` is not a mail format: it is a Compound File Binary — the same container an old `.xls`
 * lives in — holding one stream per MAPI property, with the property's number and type spelled out
 * in the stream's name. `xlsx` already ships that container reader, so what is written here is only
 * the mail-shaped layer over it: which property is the subject, which is the body, and which
 * storages are the attachments.
 */

/** Every compound file opens with these eight bytes, which is how a real `.msg` is recognised. */
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Streams in a storage, keyed by name: `__substg1.0_0037001F` and the like. */
type StreamMap = Map<string, Uint8Array>;

/** Property types, as they appear at the end of a stream's name. */
const AS_UNICODE = '001F';
const AS_ANSI = '001E';
const AS_BINARY = '0102';

/** MAPI property numbers, by the name they go under in the protocol documents. */
const PR_SUBJECT = '0037';
const PR_SENDER_NAME = '0C1A';
const PR_SENDER_EMAIL = '0C1F';
const PR_SENDER_SMTP = '5D01';
const PR_SENT_ON_BEHALF_NAME = '0042';
const PR_SENT_ON_BEHALF_EMAIL = '0065';
const PR_DISPLAY_TO = '0E04';
const PR_DISPLAY_CC = '0E03';
const PR_BODY = '1000';
const PR_HTML_BODY = '1013';
const PR_COMPRESSED_RTF = '1009';
const PR_ATTACH_LONG_FILENAME = '3707';
const PR_ATTACH_FILENAME = '3704';
const PR_ATTACH_DISPLAY_NAME = '3001';
const PR_ATTACH_MIME_TAG = '370E';
const PR_ATTACH_CONTENT_ID = '3712';
const PR_ATTACH_DATA = '3701';

/** The same, for the ones that live in the property stream rather than in a stream of their own. */
const PID_CLIENT_SUBMIT_TIME = 0x0039;
const PID_DELIVERY_TIME = 0x0e06;
const PID_CREATION_TIME = 0x3007;
const PID_INTERNET_CPID = 0x3fde;
const PID_MESSAGE_CODEPAGE = 0x3ffd;
const TYPE_LONG = 0x0003;
const TYPE_FILETIME = 0x0040;

/**
 * Eight-bit text says which code page it was written in by number. Only the ones this office is
 * ever likely to see are listed; anything else falls back to Latin-1, which at least keeps the
 * letters that are plain ASCII readable.
 */
const CODEPAGE_LABELS: Record<number, string> = {
  862: 'windows-1255',
  874: 'windows-874',
  932: 'shift_jis',
  936: 'gbk',
  1200: 'utf-16le',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  10000: 'macintosh',
  20127: 'windows-1252',
  28591: 'iso-8859-1',
  28598: 'iso-8859-8',
  28605: 'iso-8859-15',
  65000: 'utf-8',
  65001: 'utf-8',
};

export interface OutlookMsgAttachment {
  /** What Outlook called the file, its long name preferred over the shortened one. */
  name: string;
  mimeType: string;
  /** Set when the body points at this file rather than listing it, the way a signature image is. */
  contentId: string | null;
  /** Null for a message attached to a message, which is a whole file of its own and left alone. */
  bytes: Uint8Array | null;
  size: number;
}

export interface OutlookMsgEmail {
  subject: string;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  sentAt: Date | null;
  bodyHtml: string | null;
  bodyText: string | null;
  /** True when the text had to be recovered out of the message's RTF, which loses its layout. */
  bodyFromRtf: boolean;
  attachments: OutlookMsgAttachment[];
}

export function isOutlookMsgFile(fileName: string, mimeType?: string | null): boolean {
  if ((mimeType || '').toLowerCase().includes('vnd.ms-outlook')) return true;
  return /\.msg(\?|#|$)/i.test(String(fileName || ''));
}

export function looksLikeOutlookMsg(bytes: Uint8Array): boolean {
  return bytes.length > CFB_SIGNATURE.length && CFB_SIGNATURE.every((byte, at) => bytes[at] === byte);
}

function asBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (Array.isArray(content)) return Uint8Array.from(content as number[]);
  return new Uint8Array(0);
}

function readUint16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function decodeUnicode(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le').decode(bytes);
}

function decodeAnsi(bytes: Uint8Array, codepage: string): string {
  try {
    return new TextDecoder(codepage).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Trailing nulls are padding from the file, not part of what was written. */
function trimNulls(text: string): string {
  return text.replace(/\0+$/, '');
}

function readProperty(streams: StreamMap, property: string, codepage: string): string {
  const unicode = streams.get(`__substg1.0_${property}${AS_UNICODE}`);
  if (unicode) return trimNulls(decodeUnicode(unicode));
  const ansi = streams.get(`__substg1.0_${property}${AS_ANSI}`);
  if (ansi) return trimNulls(decodeAnsi(ansi, codepage));
  return '';
}

/**
 * Properties small enough to hold their own value — a date, a number — are packed into one stream
 * as sixteen byte records instead of getting a stream each. The header before them is longer at the
 * top of the message than it is inside an attachment.
 */
function readPropertyStream(
  bytes: Uint8Array | undefined,
  headerSize: number,
): Map<number, { type: number; value: Uint8Array }> {
  const properties = new Map<number, { type: number; value: Uint8Array }>();
  if (!bytes) return properties;
  for (let at = headerSize; at + 16 <= bytes.length; at += 16) {
    properties.set(readUint16(bytes, at + 2), {
      type: readUint16(bytes, at),
      value: bytes.subarray(at + 8, at + 16),
    });
  }
  return properties;
}

function readLong(
  properties: Map<number, { type: number; value: Uint8Array }>,
  id: number,
): number | null {
  const property = properties.get(id);
  if (!property || property.type !== TYPE_LONG) return null;
  return readUint32(property.value, 0);
}

/** Windows counts time in hundreds of nanoseconds since 1601; the web counts milliseconds since 1970. */
function readTimestamp(
  properties: Map<number, { type: number; value: Uint8Array }>,
  id: number,
): Date | null {
  const property = properties.get(id);
  if (!property || property.type !== TYPE_FILETIME) return null;
  const hundredNanoseconds = readUint32(property.value, 4) * 4294967296 + readUint32(property.value, 0);
  if (hundredNanoseconds === 0) return null;
  const when = new Date(hundredNanoseconds / 10000 - 11644473600000);
  return Number.isFinite(when.getTime()) && when.getTime() > 0 ? when : null;
}

type CfbContainer = { FullPaths: string[]; FileIndex: Array<{ type: number; content: unknown }> };
type CfbReader = { read(data: Uint8Array, options: { type: string }): CfbContainer };

/** A stream entry, as opposed to a storage or the root. */
const CFB_STREAM = 2;

/** Every storage in the file, keyed by its path, holding the streams directly inside it. */
async function readStorages(bytes: Uint8Array): Promise<Map<string, StreamMap>> {
  // Loaded only once a message is actually opened: it is a large library to carry otherwise.
  const { CFB } = (await import('xlsx')) as unknown as { CFB?: CfbReader };
  if (!CFB?.read) throw new Error('This browser build cannot open Outlook messages');
  const container = CFB.read(bytes, { type: 'buffer' });
  const storages = new Map<string, StreamMap>();
  container.FullPaths.forEach((path, index) => {
    const entry = container.FileIndex[index];
    if (!entry || entry.type !== CFB_STREAM) return;
    const cut = path.lastIndexOf('/');
    const storage = cut > 0 ? path.slice(0, cut) : '/';
    const name = path.slice(cut + 1);
    const streams = storages.get(storage) ?? new Map<string, Uint8Array>();
    streams.set(name, asBytes(entry.content));
    storages.set(storage, streams);
  });
  return storages;
}

function attachmentOf(streams: StreamMap, codepage: string): OutlookMsgAttachment | null {
  const data = streams.get(`__substg1.0_${PR_ATTACH_DATA}${AS_BINARY}`) ?? null;
  const name =
    readProperty(streams, PR_ATTACH_LONG_FILENAME, codepage) ||
    readProperty(streams, PR_ATTACH_FILENAME, codepage) ||
    readProperty(streams, PR_ATTACH_DISPLAY_NAME, codepage);
  if (!name && !data) return null;
  const contentId = readProperty(streams, PR_ATTACH_CONTENT_ID, codepage).replace(/^<|>$/g, '');
  return {
    name: name || 'attachment',
    mimeType: readProperty(streams, PR_ATTACH_MIME_TAG, codepage),
    contentId: contentId || null,
    bytes: data,
    size: data ? data.length : 0,
  };
}

/**
 * The HTML body is kept as raw bytes, so its own `<meta charset>` is worth more than the code page
 * the message was labelled with.
 */
function decodeHtmlBody(bytes: Uint8Array, codepage: string): string {
  const firstPass = decodeAnsi(bytes, codepage);
  const declared = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(firstPass.slice(0, 2048))?.[1];
  if (!declared || declared.toLowerCase() === codepage) return firstPass;
  try {
    return new TextDecoder(declared.toLowerCase()).decode(bytes);
  } catch {
    return firstPass;
  }
}

export async function parseOutlookMsg(bytes: Uint8Array): Promise<OutlookMsgEmail> {
  if (!looksLikeOutlookMsg(bytes)) throw new Error('This file is not an Outlook message');
  const storages = await readStorages(bytes);
  // The message itself is the one storage at the top of the file; its attachments are the storages
  // one step inside it. Depth is counted rather than matched by name, since the root is spelled
  // differently depending on which tool wrote the file.
  const depthOf = (path: string) => path.split('/').filter(Boolean).length;
  const root =
    [...storages.entries()].find(([path]) => depthOf(path) <= 1)?.[1] ?? new Map<string, Uint8Array>();

  const properties = readPropertyStream(root.get('__properties_version1.0'), 32);
  const codepageId = readLong(properties, PID_INTERNET_CPID) ?? readLong(properties, PID_MESSAGE_CODEPAGE);
  const codepage = (codepageId && CODEPAGE_LABELS[codepageId]) || 'windows-1252';

  const htmlBytes = root.get(`__substg1.0_${PR_HTML_BODY}${AS_BINARY}`);
  const htmlText = readProperty(root, PR_HTML_BODY, codepage);
  const plainText = readProperty(root, PR_BODY, codepage);

  let bodyHtml = htmlBytes ? decodeHtmlBody(htmlBytes, codepage) : htmlText || null;
  let bodyText = plainText || null;
  let bodyFromRtf = false;
  if (!bodyHtml && !bodyText) {
    // Nothing was stored as text or as HTML, which leaves the copy Outlook keeps for its own
    // editor. It carries formatting this view cannot show, so only its words are taken.
    const compressed = root.get(`__substg1.0_${PR_COMPRESSED_RTF}${AS_BINARY}`);
    const rtf = compressed ? decompressRtf(compressed) : null;
    if (rtf) {
      const recovered = rtfToPlainText(rtf, codepage);
      if (recovered.trim()) {
        bodyText = recovered;
        bodyFromRtf = true;
      }
    }
  }
  if (bodyHtml && !bodyHtml.trim()) bodyHtml = null;
  if (bodyText && !bodyText.trim()) bodyText = null;

  const attachments: OutlookMsgAttachment[] = [];
  const attachmentFolders = [...storages.entries()]
    .filter(([path]) => depthOf(path) === 2 && /__attach_version1\.0_#[0-9A-Fa-f]+$/.test(path))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [, streams] of attachmentFolders) {
    const attachment = attachmentOf(streams, codepage);
    if (attachment) attachments.push(attachment);
  }

  return {
    subject: readProperty(root, PR_SUBJECT, codepage),
    fromName:
      readProperty(root, PR_SENDER_NAME, codepage) ||
      readProperty(root, PR_SENT_ON_BEHALF_NAME, codepage),
    fromEmail:
      readProperty(root, PR_SENDER_SMTP, codepage) ||
      readProperty(root, PR_SENDER_EMAIL, codepage) ||
      readProperty(root, PR_SENT_ON_BEHALF_EMAIL, codepage),
    to: readProperty(root, PR_DISPLAY_TO, codepage),
    cc: readProperty(root, PR_DISPLAY_CC, codepage),
    sentAt:
      readTimestamp(properties, PID_CLIENT_SUBMIT_TIME) ??
      readTimestamp(properties, PID_DELIVERY_TIME) ??
      readTimestamp(properties, PID_CREATION_TIME),
    bodyHtml,
    bodyText,
    bodyFromRtf,
    attachments,
  };
}

/** Where the dictionary every compressed body starts from, which both ends must agree on exactly. */
const RTF_DICTIONARY_SEED =
  '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss ' +
  '\\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier' +
  '{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx';

const RTF_MAGIC_COMPRESSED = 0x75465a4c;
const RTF_MAGIC_PLAIN = 0x414c454d;
const RTF_DICTIONARY_SIZE = 4096;

/**
 * Outlook squeezes its RTF copy with LZFu, a back-reference scheme seeded with the boilerplate
 * above so the opening of a message costs almost nothing to store. Returns null for anything that
 * does not come out as RTF, which is the guard against reading a file this does not understand.
 */
export function decompressRtf(bytes: Uint8Array): string | null {
  if (bytes.length < 16) return null;
  const compressedSize = readUint32(bytes, 0);
  const uncompressedSize = readUint32(bytes, 4);
  const magic = readUint32(bytes, 8);
  const asText = (out: Uint8Array) => {
    const text = decodeAnsi(out, 'windows-1252');
    return text.startsWith('{\\rtf') ? text : null;
  };
  if (magic === RTF_MAGIC_PLAIN) {
    return asText(bytes.subarray(16, Math.min(bytes.length, 16 + uncompressedSize)));
  }
  if (magic !== RTF_MAGIC_COMPRESSED) return null;

  const dictionary = new Uint8Array(RTF_DICTIONARY_SIZE);
  for (let at = 0; at < RTF_DICTIONARY_SEED.length; at += 1) {
    dictionary[at] = RTF_DICTIONARY_SEED.charCodeAt(at) & 0xff;
  }
  let writeAt = RTF_DICTIONARY_SEED.length;
  const out = new Uint8Array(Math.min(uncompressedSize, 32 * 1024 * 1024));
  let written = 0;
  const put = (byte: number) => {
    if (written < out.length) out[written] = byte;
    written += 1;
    dictionary[writeAt] = byte;
    writeAt = (writeAt + 1) % RTF_DICTIONARY_SIZE;
  };

  // The size in the header counts from its own fifth byte, which is where the stream ends.
  const end = Math.min(bytes.length, compressedSize + 4);
  let at = 16;
  while (at < end && written < out.length) {
    const flags = bytes[at];
    at += 1;
    for (let bit = 0; bit < 8 && at < end && written < out.length; bit += 1) {
      if ((flags >> bit) & 1) {
        const offset = (bytes[at] << 4) | (bytes[at + 1] >> 4);
        const length = (bytes[at + 1] & 0x0f) + 2;
        at += 2;
        // A reference to where the writing head stands is how the stream says it is finished.
        if (offset === writeAt) return asText(out.subarray(0, written));
        for (let step = 0; step < length; step += 1) {
          put(dictionary[(offset + step) % RTF_DICTIONARY_SIZE]);
        }
      } else {
        put(bytes[at]);
        at += 1;
      }
    }
  }
  return asText(out.subarray(0, written));
}

/** Groups that describe the document rather than say anything, and so are skipped whole. */
const RTF_SKIPPED_GROUPS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'info',
  'pict',
  'object',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'generator',
  'filetbl',
  'rsidtable',
  'xmlnstbl',
  'mmathPr',
  'nonshppict',
  'shppict',
]);

/**
 * The words out of an RTF body, with the line breaks it asked for. This is deliberately not a
 * renderer: it is the last resort for a message that was stored no other way.
 */
export function rtfToPlainText(rtf: string, codepage: string): string {
  // Built as bytes, since RTF escapes non-English letters one byte at a time in its own code page.
  const out: number[] = [];
  const pushText = (text: string) => {
    for (let at = 0; at < text.length; at += 1) out.push(text.charCodeAt(at) & 0xff);
  };
  // Unicode runs ahead of the bytes, so it is held apart and stitched in at the end.
  const pieces: string[] = [];
  const flush = () => {
    if (out.length === 0) return;
    pieces.push(decodeAnsi(Uint8Array.from(out), codepage));
    out.length = 0;
  };

  let at = 0;
  let skipDepth = 0;
  let depth = 0;
  let skipAfterUnicode = 1;
  while (at < rtf.length) {
    const char = rtf[at];
    if (char === '{') {
      depth += 1;
      at += 1;
      continue;
    }
    if (char === '}') {
      if (skipDepth > 0 && depth <= skipDepth) skipDepth = 0;
      depth -= 1;
      at += 1;
      continue;
    }
    if (char !== '\\') {
      if (skipDepth === 0 && char !== '\r' && char !== '\n') out.push(char.charCodeAt(0) & 0xff);
      at += 1;
      continue;
    }

    const escaped = rtf[at + 1];
    if (escaped === '\\' || escaped === '{' || escaped === '}') {
      if (skipDepth === 0) out.push(escaped.charCodeAt(0) & 0xff);
      at += 2;
      continue;
    }
    if (escaped === "'") {
      const byte = parseInt(rtf.slice(at + 2, at + 4), 16);
      if (skipDepth === 0 && Number.isFinite(byte)) out.push(byte);
      at += 4;
      continue;
    }
    if (escaped === '*') {
      // `\*` marks a group a reader may ignore, and ignoring it is exactly what this does.
      if (skipDepth === 0) skipDepth = depth;
      at += 2;
      continue;
    }

    const word = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(at));
    if (!word) {
      at += 2;
      continue;
    }
    at += word[0].length;
    const name = word[1];
    const argument = word[2] ? Number(word[2]) : null;
    if (RTF_SKIPPED_GROUPS.has(name)) {
      if (skipDepth === 0) skipDepth = depth;
      continue;
    }
    if (skipDepth > 0) continue;
    if (name === 'uc') {
      skipAfterUnicode = argument ?? 1;
      continue;
    }
    if (name === 'u' && argument !== null) {
      flush();
      pieces.push(String.fromCharCode(argument < 0 ? argument + 65536 : argument));
      // The bytes that follow say the same thing for readers without Unicode, and are dropped.
      at += skipAfterUnicode;
      continue;
    }
    if (name === 'par' || name === 'line' || name === 'sect' || name === 'row') {
      out.push(10);
      continue;
    }
    if (name === 'tab') {
      out.push(9);
      continue;
    }
    if (name === 'emdash') pushText('—');
    else if (name === 'endash') pushText('–');
    else if (name === 'lquote') pushText('‘');
    else if (name === 'rquote') pushText('’');
    else if (name === 'ldblquote') pushText('“');
    else if (name === 'rdblquote') pushText('”');
    else if (name === 'bullet') pushText('•');
  }
  flush();
  return pieces.join('').replace(/\n{3,}/g, '\n\n').trim();
}
