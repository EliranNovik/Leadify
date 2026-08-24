import React from 'react';
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';

type StageOption = { id: string; name: string };

type ControlsProps = {
  selectedCount: number;
  stages: StageOption[];
  stageId: string;
  applying: boolean;
  onStageId: (value: string) => void;
  onApply: () => void;
  onCancel: () => void;
};

export const PipelineBulkStageFields: React.FC<ControlsProps> = ({
  selectedCount,
  stages,
  stageId,
  applying,
  onStageId,
  onApply,
  onCancel,
}) => {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Click rows to select them, then choose the stage for all selected leads.
      </p>
      <p className="text-sm font-medium text-gray-900">
        {selectedCount === 0
          ? 'No leads selected'
          : `${selectedCount} lead${selectedCount === 1 ? '' : 's'} selected`}
      </p>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Stage
        </span>
        <select
          className="select select-bordered w-full rounded-xl border-gray-200 bg-white text-sm"
          value={stageId}
          onChange={(event) => onStageId(event.target.value)}
        >
          <option value="">Choose a stage</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm flex-1"
          disabled={!stageId || selectedCount === 0 || applying}
          onClick={onApply}
        >
          {applying ? 'Updating…' : 'Change stage'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={applying}>
          Cancel
        </button>
      </div>
    </div>
  );
};

type SettingsProps = ControlsProps & {
  active: boolean;
  onStart: () => void;
};

export const PipelineBulkStageSettings: React.FC<SettingsProps> = ({
  active,
  onStart,
  ...controls
}) => {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onStart}
        aria-pressed={active}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
          active ? 'bg-white ring-2 ring-primary' : 'hover:bg-gray-50'
        }`}
      >
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          <ArrowsRightLeftIcon className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-gray-900">Change stage</span>
          <span className="block text-xs text-gray-500">Update multiple leads at once</span>
        </span>
      </button>
      {active ? <PipelineBulkStageFields {...controls} /> : null}
    </div>
  );
};

type BarProps = ControlsProps;

export const PipelineBulkStageBar: React.FC<BarProps> = (props) => {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900">Change stage</p>
        <p className="text-xs text-gray-500">
          {props.selectedCount === 0
            ? 'Click rows to select leads'
            : `${props.selectedCount} lead${props.selectedCount === 1 ? '' : 's'} selected`}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          className="select select-bordered w-full rounded-xl border-gray-200 bg-white text-sm sm:w-64"
          value={props.stageId}
          onChange={(event) => props.onStageId(event.target.value)}
        >
          <option value="">Choose a stage</option>
          {props.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!props.stageId || props.selectedCount === 0 || props.applying}
          onClick={props.onApply}
        >
          {props.applying ? 'Updating…' : 'Apply'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={props.onCancel}
          disabled={props.applying}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
