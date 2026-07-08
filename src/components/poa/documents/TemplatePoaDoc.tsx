import React, { useMemo } from 'react';
import { PoaField, PoaInlineField, PoaSignatureBox, type PoaDocController } from '../PoaFormPrimitives';
import {
  parsePoaBody,
  poaFieldInstanceIdBySegment,
  type PoaTemplateField,
  type PoaFieldType,
} from '../../../lib/poaTemplateFields';
import { renderPoaInlineMarkup } from '../../../lib/poaBodyMarkup';

interface Props {
  ctrl: PoaDocController;
  body: string;
  fields: PoaTemplateField[];
  direction?: 'ltr' | 'rtl';
  fontFamily?: string | null;
  fontSize?: string | null;
}

const INLINE_TYPES: PoaFieldType[] = ['text', 'date', 'email', 'tel'];

function fieldInput(
  field: PoaTemplateField,
  ctrl: PoaDocController,
  dir: 'ltr' | 'rtl',
  inline: boolean,
  valueId: string,
) {
  if (field.type === 'signature') {
    return <PoaSignatureBox ctrl={ctrl} id={valueId} label={field.label} className="my-3" />;
  }
  if (field.type === 'textarea') {
    return <PoaField ctrl={ctrl} id={valueId} label={field.label} multiline dir={dir} className="my-3" />;
  }
  const inputType = field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text';
  if (inline) {
    return (
      <PoaInlineField
        ctrl={ctrl}
        id={valueId}
        type={inputType}
        dir={dir}
        placeholder={field.label}
      />
    );
  }
  return <PoaField ctrl={ctrl} id={valueId} label={field.label} type={inputType} dir={dir} className="my-3" />;
}

/**
 * Renders a staff-authored template: free text with {{key}} tokens turned into
 * the matching inputs / signature pads. Fields defined but not placed in the
 * body are appended at the end.
 */
const TemplatePoaDoc: React.FC<Props> = ({
  ctrl,
  body,
  fields,
  direction = 'ltr',
  fontFamily,
  fontSize,
}) => {
  const byKey = useMemo(() => {
    const m = new Map<string, PoaTemplateField>();
    for (const f of fields) m.set(f.key, f);
    return m;
  }, [fields]);

  const segments = useMemo(() => parsePoaBody(body), [body]);
  const instanceIdBySegment = useMemo(() => poaFieldInstanceIdBySegment(body), [body]);
  const placedKeys = useMemo(
    () => new Set(segments.filter((s) => s.kind === 'field').map((s) => (s as { key: string }).key)),
    [segments],
  );
  const orphanFields = useMemo(
    () => fields.filter((f) => !placedKeys.has(f.key)),
    [fields, placedKeys],
  );

  const docStyle: React.CSSProperties = { fontSize: fontSize || '15px' };
  if (fontFamily) docStyle.fontFamily = fontFamily;

  return (
    <div className="poa-doc text-gray-900" dir={direction} style={docStyle}>
      <div className="leading-relaxed whitespace-pre-wrap break-words">
        {segments.map((seg, idx) => {
          if (seg.kind === 'text') {
            return (
              <span key={`t-${idx}`}>
                {renderPoaInlineMarkup(seg.text, `t-${idx}`)}
              </span>
            );
          }
          const def: PoaTemplateField =
            byKey.get(seg.key) || { key: seg.key, label: seg.key, type: 'text', required: false, prefill: '' };
          const inline = INLINE_TYPES.includes(def.type);
          const valueId = instanceIdBySegment.get(idx) || seg.key;
          return (
            <React.Fragment key={`f-${idx}`}>
              {fieldInput(def, ctrl, direction, inline, valueId)}
            </React.Fragment>
          );
        })}
      </div>

      {orphanFields.length > 0 && (
        <div className="mt-6 space-y-3 border-t border-gray-200 pt-5">
          {orphanFields.map((f) => (
            <div key={f.key}>{fieldInput(f, ctrl, direction, false)}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TemplatePoaDoc;
