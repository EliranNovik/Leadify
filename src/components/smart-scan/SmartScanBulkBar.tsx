type Props = {
  selectedCount: number;
  canApprove: boolean;
  canRetry: boolean;
  canAssign: boolean;
  canComplete: boolean;
  onApprove: () => void;
  onRetry: () => void;
  onAssign: () => void;
  onComplete: () => void;
  onRemove: () => void;
  onClear: () => void;
};

export function SmartScanBulkBar({
  selectedCount,
  canApprove,
  canRetry,
  canAssign,
  canComplete,
  onApprove,
  onRetry,
  onAssign,
  onComplete,
  onRemove,
  onClear,
}: Props) {
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-gray-900">
        {selectedCount} selected
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm rounded-xl btn-primary" disabled={!canApprove} onClick={onApprove}>
          Approve
        </button>
        <button type="button" className="btn btn-sm rounded-xl" disabled={!canRetry} onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="btn btn-sm rounded-xl" disabled={!canAssign} onClick={onAssign}>
          Assign Lead
        </button>
        <button type="button" className="btn btn-sm rounded-xl" disabled={!canComplete} onClick={onComplete}>
          Mark Completed
        </button>
        <button type="button" className="btn btn-ghost btn-sm text-rose-600" onClick={onRemove}>
          Delete
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}
