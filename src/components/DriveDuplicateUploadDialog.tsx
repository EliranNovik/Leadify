import React, { useEffect, useRef, useState } from 'react';
import { formatDocumentSize } from '../lib/documentIndex';
import type { DriveClashChoice, DriveUploadClash } from '../lib/documentDriveUpload';

/**
 * The same document found twice: one sheet behind another, with an alert on the corner. Drawn here
 * because the icon set has a duplicate mark and a warning sign but nothing that says both.
 */
const DuplicateDetectedIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 48 48"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* The copy already filed, sitting behind the one that has just arrived. */}
    <rect x="18" y="6" width="22" height="26" rx="3.5" opacity="0.35" />
    <rect x="8" y="14" width="22" height="27" rx="3.5" />
    <path d="M14 24h10M14 30h7" />
    <circle cx="37" cy="34" r="9" fill="currentColor" stroke="none" />
    <path d="M37 30v4.5" stroke="white" />
    <path d="M37 38.4h.01" stroke="white" />
  </svg>
);

/**
 * Asked once, at the end of an upload, about the files whose names were already taken.
 *
 * One question for the whole batch rather than one per file: tick the ones to single out, then
 * either button decides both halves at once, so the usual answer — all of them, one way — is a
 * single click, and a mixed answer is still possible without a second round of questions.
 *
 * Sits below the upload panel rather than over it, so what has already landed stays in sight while
 * the question is read.
 */
type Props = {
  clashes: DriveUploadClash[];
  /** Where the files were going, as the drive names it. */
  destinationLabel?: string | null;
  onDecide: (choices: Map<number, DriveClashChoice>) => void;
};

function whenAdded(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const DriveDuplicateUploadDialog: React.FC<Props> = ({
  clashes,
  destinationLabel,
  onDecide,
}) => {
  const card = useRef<HTMLDivElement>(null);
  const [ticked, setTicked] = useState<Set<number>>(() => new Set());
  const total = clashes.length;
  const picked = ticked.size;
  const rest = total - picked;
  const allTicked = picked === total && total > 0;

  /**
   * Singling nothing out is the usual case and means the whole list, so one click still answers
   * for everything. Tick a few and each button then says what happens to the other half too.
   */
  const answersForAll = picked === 0 || allTicked;

  const decide = (forTicked: DriveClashChoice) => {
    const forTheRest: DriveClashChoice = forTicked === 'replace' ? 'skip' : 'replace';
    const choices = new Map<number, DriveClashChoice>();
    for (const clash of clashes) {
      choices.set(
        clash.index,
        answersForAll || ticked.has(clash.index) ? forTicked : forTheRest,
      );
    }
    onDecide(choices);
  };

  // Backing out means changing nothing, which is the safe half of this question.
  const skipEverything = () => {
    onDecide(new Map(clashes.map((clash) => [clash.index, 'skip' as DriveClashChoice])));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skipEverything();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clashes]);

  // Below the upload it belongs to, which on a short window means off the bottom of it.
  useEffect(() => {
    card.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const toggle = (index: number) => {
    const next = new Set(ticked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setTicked(next);
  };

  const toggleAll = () => {
    setTicked(allTicked ? new Set() : new Set(clashes.map((clash) => clash.index)));
  };

  // Replacing still means uploading the new file, which the label says so it is not read as a
  // choice between uploading and replacing.
  const replaceLabel = answersForAll
    ? total === 1
      ? 'Upload and replace'
      : `Upload and replace all ${total}`
    : `Upload and replace ${picked} · skip ${rest}`;
  const skipLabel = answersForAll
    ? total === 1
      ? 'Skip'
      : `Skip all ${total}`
    : `Skip ${picked} · replace ${rest}`;

  return (
    <div
      ref={card}
      role="group"
      aria-label="Files whose names are already taken"
      className="flex w-full flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
    >
      <div className="flex items-center gap-4 px-5 py-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <DuplicateDetectedIcon className="h-11 w-11" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-bold">
            {total === 1 ? 'Duplicate detected' : `${total} duplicates detected`}
          </h3>
          <p className="mt-0.5 text-sm text-base-content/70">
            Everything else is uploaded. Replacing swaps the file; skipping keeps what is there.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 bg-base-200/60 px-5 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={allTicked}
            // Part-way through, the box shows neither ticked nor empty.
            ref={(node) => {
              if (node) node.indeterminate = picked > 0 && !allTicked;
            }}
            onChange={toggleAll}
          />
          Select all
        </label>
        <span className="text-xs text-base-content/60">
          {picked > 0 ? `${picked} of ${total} picked` : ''}
        </span>
      </div>

      <ul className="max-h-[40vh] min-h-0 flex-1 divide-y divide-base-200 overflow-y-auto px-5">
        {clashes.map((clash) => {
          const isTicked = ticked.has(clash.index);
          return (
            <li key={clash.index}>
              <label className="flex cursor-pointer items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={isTicked}
                  onChange={() => toggle(clash.index)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{clash.fileName}</span>
                  <span className="block truncate text-xs text-base-content/60">
                    {[
                      clash.folderLabel,
                      `new ${formatDocumentSize(clash.incomingSize)}`,
                      `here ${formatDocumentSize(clash.existingSize)}`,
                      whenAdded(clash.existingCreatedAt)
                        ? `added ${whenAdded(clash.existingCreatedAt)}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-base-300 px-5 py-4">
        <button
          type="button"
          className="btn btn-ghost gap-2 rounded-full px-6"
          onClick={() => decide('skip')}
        >
          {skipLabel}
        </button>
        <button
          type="button"
          className="btn btn-primary gap-2 rounded-full px-7"
          onClick={() => decide('replace')}
        >
          {replaceLabel}
        </button>
      </div>
    </div>
  );
};

export default DriveDuplicateUploadDialog;
