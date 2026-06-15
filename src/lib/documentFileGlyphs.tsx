import {
  ArchiveBoxIcon,
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  FilmIcon,
  MusicalNoteIcon,
  PresentationChartBarIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';

export type DocumentFileKind =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'text'
  | 'code'
  | 'generic';

export function inferDocumentFileKind(fileType: string, fileName: string): DocumentFileKind {
  const mime = (fileType || '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : '';

  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf') || ext === '.pdf') return 'pdf';
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['.doc', '.docx', '.docm', '.odt'].includes(ext)
  ) {
    return 'word';
  }
  if (
    mime.includes('spreadsheetml') ||
    mime.includes('ms-excel') ||
    mime.includes('csv') ||
    ['.xls', '.xlsx', '.xlsm', '.csv', '.ods'].includes(ext)
  ) {
    return 'excel';
  }
  if (
    mime.includes('presentationml') ||
    mime.includes('powerpoint') ||
    ['.ppt', '.pptx', '.pptm', '.odp'].includes(ext)
  ) {
    return 'powerpoint';
  }
  if (
    mime.includes('zip') ||
    mime.includes('rar') ||
    mime.includes('x-7z') ||
    mime.includes('compressed') ||
    ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz'].includes(ext)
  ) {
    return 'archive';
  }
  if (mime.startsWith('text/') || ['.txt', '.md', '.rtf', '.log'].includes(ext)) return 'text';
  if (
    [
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.json',
      '.html',
      '.htm',
      '.css',
      '.xml',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.go',
      '.rb',
      '.php',
      '.sql',
      '.yml',
      '.yaml',
    ].includes(ext)
  ) {
    return 'code';
  }
  if (mime.includes('json')) return 'code';
  return 'generic';
}

export type DocumentFileGlyphProps = {
  fileType?: string;
  fileName: string;
  className?: string;
};

const DEFAULT_GLYPH_CLASS = 'h-11 w-11 shrink-0 sm:h-12 sm:w-12';

export function DocumentFileGlyph({ fileType = '', fileName, className }: DocumentFileGlyphProps) {
  const kind = inferDocumentFileKind(fileType, fileName);
  const cn = className ?? DEFAULT_GLYPH_CLASS;

  switch (kind) {
    case 'pdf':
      return <DocumentTextIcon className={`${cn} text-red-600 dark:text-red-400`} aria-hidden />;
    case 'word':
      return <DocumentIcon className={`${cn} text-blue-700 dark:text-blue-400`} aria-hidden />;
    case 'excel':
      return <TableCellsIcon className={`${cn} text-emerald-700 dark:text-emerald-400`} aria-hidden />;
    case 'powerpoint':
      return <PresentationChartBarIcon className={`${cn} text-orange-600 dark:text-orange-400`} aria-hidden />;
    case 'image':
      return <DocumentIcon className={`${cn} text-violet-600 dark:text-violet-400`} aria-hidden />;
    case 'video':
      return <FilmIcon className={`${cn} text-fuchsia-700 dark:text-fuchsia-400`} aria-hidden />;
    case 'audio':
      return <MusicalNoteIcon className={`${cn} text-indigo-600 dark:text-indigo-400`} aria-hidden />;
    case 'archive':
      return <ArchiveBoxIcon className={`${cn} text-amber-800 dark:text-amber-500`} aria-hidden />;
    case 'text':
      return <DocumentTextIcon className={`${cn} text-slate-600 dark:text-slate-400`} aria-hidden />;
    case 'code':
      return <CodeBracketIcon className={`${cn} text-cyan-700 dark:text-cyan-400`} aria-hidden />;
    default:
      return <DocumentIcon className={`${cn} text-gray-500 dark:text-gray-400`} aria-hidden />;
  }
}
