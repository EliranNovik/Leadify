import React, { useCallback, useEffect, useRef, useState } from 'react';
import SignaturePad from 'react-signature-canvas';

/** Shared controller passed to every POA document renderer. */
export interface PoaDocController {
  values: Record<string, string>;
  signatures: Record<string, string>;
  readOnly: boolean;
  setValue: (id: string, value: string) => void;
  setSignature: (id: string, dataUrl: string) => void;
  /** ids that failed validation on the last submit attempt (highlighted red). */
  invalid?: Set<string>;
}

// -----------------------------------------------------------------------------
// Block field: a label on its own line with an underlined fill-in below.
// -----------------------------------------------------------------------------
interface FieldProps {
  ctrl: PoaDocController;
  id: string;
  label?: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'date';
  multiline?: boolean;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

export const PoaField: React.FC<FieldProps> = ({
  ctrl,
  id,
  label,
  placeholder,
  type = 'text',
  multiline = false,
  className = '',
  dir,
}) => {
  const value = ctrl.values[id] ?? '';
  const isInvalid = ctrl.invalid?.has(id);

  return (
    <div className={`poa-field ${className}`.trim()}>
      {label && (
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
          {label}
        </label>
      )}
      {ctrl.readOnly ? (
        <div
          dir={dir}
          className="min-h-[1.75rem] border-b border-gray-400 pb-1 text-[15px] text-gray-900 whitespace-pre-wrap break-words"
        >
          {value || '\u00A0'}
        </div>
      ) : multiline ? (
        <textarea
          dir={dir}
          rows={2}
          value={value}
          placeholder={placeholder}
          onChange={(e) => ctrl.setValue(id, e.target.value)}
          className={`w-full resize-none rounded-md border bg-white px-2.5 py-1.5 text-[15px] text-gray-900 outline-none focus:ring-2 focus:ring-blue-300 ${
            isInvalid ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'
          }`}
        />
      ) : (
        <input
          dir={dir}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => ctrl.setValue(id, e.target.value)}
          className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-[15px] text-gray-900 outline-none focus:ring-2 focus:ring-blue-300 ${
            isInvalid ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'
          }`}
        />
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Inline field: an underlined fill-in that flows within a sentence.
// -----------------------------------------------------------------------------
interface InlineFieldProps {
  ctrl: PoaDocController;
  id: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'date';
  widthClass?: string;
  dir?: 'ltr' | 'rtl';
}

export const PoaInlineField: React.FC<InlineFieldProps> = ({
  ctrl,
  id,
  placeholder,
  type = 'text',
  widthClass = 'min-w-[10rem]',
  dir,
}) => {
  const value = ctrl.values[id] ?? '';
  const isInvalid = ctrl.invalid?.has(id);

  if (ctrl.readOnly) {
    return (
      <span
        dir={dir}
        className={`inline-block border-b border-gray-500 px-1 text-[15px] font-medium text-gray-900 ${widthClass}`}
      >
        {value || '\u00A0'}
      </span>
    );
  }

  return (
    <input
      dir={dir}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => ctrl.setValue(id, e.target.value)}
      className={`inline-block border-0 border-b bg-transparent px-1 text-[15px] text-gray-900 outline-none focus:border-blue-700 ${widthClass} ${
        isInvalid ? 'border-red-400' : 'border-gray-400'
      }`}
    />
  );
};

// -----------------------------------------------------------------------------
// Signature box: react-signature-canvas with display mode for saved signatures.
// -----------------------------------------------------------------------------
interface SignatureProps {
  ctrl: PoaDocController;
  id: string;
  label?: string;
  className?: string;
}

export const PoaSignatureBox: React.FC<SignatureProps> = ({ ctrl, id, label, className = '' }) => {
  const padRef = useRef<SignaturePad | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(320);
  const existing = ctrl.signatures[id] || '';
  const isInvalid = ctrl.invalid?.has(id);
  const CANVAS_HEIGHT = 150;

  // Keep the canvas drawing surface in sync with its CSS width so strokes land
  // under the cursor (SignaturePad does not auto-resize).
  useEffect(() => {
    if (ctrl.readOnly) return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      setCanvasWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ctrl.readOnly]);

  const handleEnd = useCallback(() => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) return;
    try {
      const dataUrl = pad.getTrimmedCanvas().toDataURL('image/png');
      ctrl.setSignature(id, dataUrl);
    } catch {
      ctrl.setSignature(id, pad.toDataURL('image/png'));
    }
  }, [ctrl, id]);

  const handleClear = useCallback(() => {
    padRef.current?.clear();
    ctrl.setSignature(id, '');
  }, [ctrl, id]);

  return (
    <div className={`poa-signature ${className}`.trim()}>
      {label && (
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
          {label}
        </label>
      )}

      {ctrl.readOnly || existing ? (
        <div className="flex h-[120px] items-end justify-center rounded-md border border-gray-300 bg-white px-2 pb-1">
          {existing ? (
            <img src={existing} alt="Signature" className="max-h-[110px] max-w-full object-contain" />
          ) : (
            <span className="mb-2 text-xs text-gray-400">Not signed</span>
          )}
        </div>
      ) : (
        <>
          <div
            ref={wrapRef}
            className={`poa-sig-edit relative w-full overflow-hidden rounded-md border bg-white ${
              isInvalid ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300'
            }`}
            style={{ height: CANVAS_HEIGHT }}
          >
            <SignaturePad
              ref={padRef}
              onEnd={handleEnd}
              canvasProps={{
                width: canvasWidth,
                height: CANVAS_HEIGHT,
                className: 'touch-none',
              }}
            />
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-2 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-200"
            >
              Clear
            </button>
            <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-gray-300">
              Sign here
            </span>
          </div>
          {/* Print-only blank signing line (the live canvas can't print). */}
          <div className="poa-sig-line hidden h-[70px] rounded-md border border-gray-400" aria-hidden />
        </>
      )}
    </div>
  );
};

/** Visual checkbox option (e.g. Herr / Frau). Stored as the option value string. */
export const PoaRadioRow: React.FC<{
  ctrl: PoaDocController;
  id: string;
  options: { value: string; label: string }[];
}> = ({ ctrl, id, options }) => {
  const value = ctrl.values[id] ?? '';
  return (
    <div className="flex flex-wrap items-center gap-4">
      {options.map((opt) => {
        const checked = value === opt.value;
        return (
          <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-[15px] text-gray-900">
            <span
              className={`flex h-4 w-4 items-center justify-center border ${
                checked ? 'border-gray-800' : 'border-gray-400'
              }`}
            >
              {checked && <span className="h-2 w-2 bg-gray-800" />}
            </span>
            {!ctrl.readOnly ? (
              <input
                type="radio"
                name={id}
                className="sr-only"
                checked={checked}
                onChange={() => ctrl.setValue(id, opt.value)}
              />
            ) : null}
            {opt.label}
          </label>
        );
      })}
    </div>
  );
};
