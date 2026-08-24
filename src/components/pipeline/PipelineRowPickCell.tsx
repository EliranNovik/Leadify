import React from 'react';
import { PIPELINE_CELL_STYLE } from './pipelineUi';

type HeaderProps = {
  visible?: boolean;
};

export const PipelineRowPickHeader: React.FC<HeaderProps> = ({ visible }) => {
  if (!visible) return null;
  return <th className="w-10 px-2 py-3" aria-label="Choose lead" />;
};

type CellProps = {
  visible?: boolean;
  selected?: boolean;
  name: string;
  onPick: (event: React.MouseEvent) => void;
};

export const PipelineRowPickCell: React.FC<CellProps> = ({
  visible,
  selected = false,
  name,
  onPick,
}) => {
  if (!visible) return null;
  return (
    <td className="w-10 px-2 py-3.5 border-b border-gray-100 text-center" style={PIPELINE_CELL_STYLE}>
      <button
        type="button"
        title={`Choose ${name}`}
        aria-label={`Choose ${name}`}
        aria-pressed={selected}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-[4px] border-2 transition ${
          selected
            ? 'border-primary bg-primary text-white'
            : 'border-gray-400 bg-white hover:border-primary hover:bg-primary/10'
        }`}
        onClick={(event) => {
          event.stopPropagation();
          onPick(event);
        }}
      >
        {selected ? (
          <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
            <path
              fill="currentColor"
              d="M6.3 10.7 3.9 8.3l-.9.9 3.3 3.3 7-7-.9-.9z"
            />
          </svg>
        ) : null}
      </button>
    </td>
  );
};
