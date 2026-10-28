import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DocumentSidebarThumb from './DocumentSidebarThumb';

/**
 * Resting on a file's icon shows the file, the way the documents drive does it: an image or the
 * first page of a PDF, so one of five similarly named scans can be told from the others without
 * opening any of them.
 *
 * The picture is drawn at the window's level and takes no clicks of its own, so it can hang over
 * the edge of a modal without getting in the way of the list underneath.
 */

export type FilePeek = {
  id: string;
  name: string;
  /** A signed or public URL when the screen has one. */
  url?: string | null;
  fileType?: string | null;
  /** Where the file is in storage, for the screens that let the thumbnail sign its own URL. */
  storagePath?: string | null;
  bucketName?: string | null;
  /** A line under the picture: the type of file, the folder it is in. */
  note?: React.ReactNode;
};

const PEEK_DELAY_MS = 400;

export function useFileHoverPeek() {
  const [peek, setPeek] = useState<{ file: FilePeek; top: number; left: number } | null>(null);
  const timer = useRef<number | null>(null);

  const close = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPeek(null);
  }, []);

  useEffect(() => close, [close]);

  /** Spread onto the icon, not the row: passing over a row on the way elsewhere shows nothing. */
  const peekProps = useCallback(
    (file: FilePeek) => ({
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        const element = event.currentTarget;
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          const rect = element.getBoundingClientRect();
          setPeek({
            file,
            // Below the icon and inside the window, whichever edge it is near.
            top: Math.min(rect.bottom + 6, window.innerHeight - 300),
            left: Math.min(Math.max(rect.left + 12, 8), window.innerWidth - 256),
          });
        }, PEEK_DELAY_MS);
      },
      onMouseLeave: close,
    }),
    [close],
  );

  const node = peek
    ? createPortal(
        <div
          className="pointer-events-none fixed z-[11200] w-60 overflow-hidden rounded-xl border border-base-300 bg-[#f8fafd] p-3 shadow-2xl"
          style={{ top: peek.top, left: peek.left }}
        >
          <p className="mb-2 truncate text-xs font-semibold uppercase tracking-wide text-base-content/40">
            {peek.file.name}
          </p>
          <DocumentSidebarThumb
            name={peek.file.name}
            url={peek.file.url || ''}
            fileType={peek.file.fileType || ''}
            storagePath={peek.file.storagePath ?? null}
            bucketName={peek.file.bucketName ?? null}
          />
          {peek.file.note ? (
            <p className="mt-2 truncate text-xs text-base-content/50">{peek.file.note}</p>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return { peekProps, closePeek: close, peekNode: node };
}
