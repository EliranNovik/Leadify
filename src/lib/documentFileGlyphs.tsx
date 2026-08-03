import {
  ArchiveBoxIcon,
  CodeBracketIcon,
  DocumentIcon,
  DocumentTextIcon,
  FilmIcon,
  MusicalNoteIcon,
  PresentationChartBarIcon,
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
  if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript')) {
    return 'code';
  }
  return 'generic';
}

export type DocumentFileGlyphProps = {
  fileType?: string;
  fileName: string;
  className?: string;
};

const DEFAULT_GLYPH_CLASS = 'h-11 w-11 shrink-0 sm:h-12 sm:w-12';

/** Microsoft Word brand-style file icon */
function WordLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#185ABD"
        d="M28.5 6H14a2 2 0 0 0-2 2v32a2 2 0 0 0 2 2h26a2 2 0 0 0 2-2V16.5L28.5 6z"
      />
      <path fill="#36C5F0" d="M28.5 6v9.5a1 1 0 0 0 1 1H42L28.5 6z" />
      <path
        fill="#041E42"
        d="M8.5 16h16A2.5 2.5 0 0 1 27 18.5v15A2.5 2.5 0 0 1 24.5 36h-16A2.5 2.5 0 0 1 6 33.5v-15A2.5 2.5 0 0 1 8.5 16z"
      />
      <path
        fill="#fff"
        d="M11.2 32.2 14.3 20h2.35l1.75 7.55L20.3 20H22.6l3.05 12.2h-2.25l-1.85-8.05L19.4 32.2h-2.2l-1.95-8.05-1.8 8.05H11.2z"
      />
    </svg>
  );
}

/** Microsoft Excel brand-style file icon */
function ExcelLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path
        fill="#107C41"
        d="M28.5 6H14a2 2 0 0 0-2 2v32a2 2 0 0 0 2 2h26a2 2 0 0 0 2-2V16.5L28.5 6z"
      />
      <path fill="#21A366" d="M28.5 6v9.5a1 1 0 0 0 1 1H42L28.5 6z" />
      <path
        fill="#185C37"
        d="M8.5 16h16A2.5 2.5 0 0 1 27 18.5v15A2.5 2.5 0 0 1 24.5 36h-16A2.5 2.5 0 0 1 6 33.5v-15A2.5 2.5 0 0 1 8.5 16z"
      />
      <path
        fill="#fff"
        d="M12.1 32.2 16.05 26l-3.7-6.2h2.55l2.45 4.35 2.45-4.35h2.5L18.6 26l3.95 6.2h-2.6l-2.65-4.55L14.7 32.2h-2.6z"
      />
    </svg>
  );
}

export function DocumentFileGlyph({ fileType = '', fileName, className }: DocumentFileGlyphProps) {
  const kind = inferDocumentFileKind(fileType, fileName);
  const cn = className ?? DEFAULT_GLYPH_CLASS;

  switch (kind) {
    case 'pdf':
      return <DocumentTextIcon className={`${cn} text-red-600 dark:text-red-400`} aria-hidden />;
    case 'word':
      return <WordLogoIcon className={cn} />;
    case 'excel':
      return <ExcelLogoIcon className={cn} />;
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
