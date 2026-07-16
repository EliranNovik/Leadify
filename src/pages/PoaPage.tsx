import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircleIcon,
  CheckIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
  ArrowRightIcon,
  ShareIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import PortalFooter from './portal/components/PortalFooter';
import {
  fetchPoaByToken,
  fetchPoaSiblings,
  submitPoa,
  type PoaPublicData,
  type PoaSiblingItem,
} from '../lib/poaApi';
import { getPoaTypeMeta } from '../lib/poaTypes';
import { getPoaDocRenderer } from '../components/poa/documents';
import TemplatePoaDoc from '../components/poa/documents/TemplatePoaDoc';
import type { PoaDocController } from '../components/poa/PoaFormPrimitives';
import { listPoaFillableInstances } from '../lib/poaTemplateFields';
import ProformaDocumentStamp from '../components/proforma/ProformaDocumentStamp';
import PublicNeedAssistanceWidget from '../components/public/PublicNeedAssistanceWidget';

const PAGE_BG: React.CSSProperties = { background: '#f3f4f6' };

const LAW_OFFICE_TITLE = 'Decker, Pex & Co. Law Office';
const POA_LOGO_SRC = '/DPL-LOGO1.png';
const POA_BTN_PRIMARY =
  'border-none bg-blue-950 text-white hover:bg-blue-900 hover:border-blue-900 disabled:bg-blue-950/70';
const POA_BTN_SIGN =
  'border-none bg-green-600 text-white hover:bg-green-700 hover:border-green-700 disabled:bg-green-600/70';
const POA_BTN_OUTLINE =
  'border-blue-200 bg-white text-blue-950 hover:border-blue-300 hover:bg-blue-50';
const POA_BTN_HEADER_BADGE =
  'inline-flex items-center gap-1.5 rounded-full border-none bg-blue-950 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-900 active:scale-[0.98]';
const POA_BTN_SHARE =
  'group inline-flex h-9 min-h-9 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 text-gray-600 transition-all duration-200 hover:border-blue-200 hover:bg-blue-50 hover:px-3.5 hover:text-blue-950 sm:px-3.5 sm:py-2';

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={PAGE_BG}>
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center">
          {children}
        </div>
      </div>
      <PortalFooter />
    </div>
  );
}

const PoaPage: React.FC<{
  kioskMode?: boolean;
  tokenOverride?: string;
  onKioskTokenChange?: (token: string) => void;
  onKioskComplete?: () => void;
}> = ({ kioskMode = false, tokenOverride, onKioskTokenChange, onKioskComplete }) => {
  const { token: routeToken } = useParams<{ token: string }>();
  const token = tokenOverride ?? routeToken;
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PoaPublicData | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [justSigned, setJustSigned] = useState(false);
  const [siblings, setSiblings] = useState<PoaSiblingItem[]>([]);
  const [advancing, setAdvancing] = useState(false);

  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Reset per-document state so chaining to the next doc starts clean.
      setLoading(true);
      setError(null);
      setJustSigned(false);
      setAdvancing(false);
      setInvalid(new Set());
      if (!token) {
        setError('Invalid link');
        setLoading(false);
        return;
      }
      try {
        const result = await fetchPoaByToken(token);
        if (cancelled) return;
        setData(result);
        setValues(result.poa.field_data || {});
        setSignatures(result.poa.signatures || {});
        // Load the contact's full signing sequence (best-effort).
        fetchPoaSiblings(token)
          .then((rows) => {
            if (!cancelled) setSiblings(rows);
          })
          .catch(() => {
            if (!cancelled) setSiblings([]);
          });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this power of attorney');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const isSigned = data?.poa.status === 'signed' || justSigned;
  const totalDocs = siblings.length;
  const signedCount = siblings.filter((s) => s.status === 'signed').length;
  const nextUnsigned =
    siblings.find((s) => s.secure_token !== token && s.status !== 'signed') || null;
  const allSigned = totalDocs > 0 && signedCount >= totalDocs;

  const goToNext = useCallback(() => {
    if (!nextUnsigned) return;
    setAdvancing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => {
      if (kioskMode && onKioskTokenChange) {
        onKioskTokenChange(nextUnsigned.secure_token);
        setAdvancing(false);
        return;
      }
      navigate(`/poa/${encodeURIComponent(nextUnsigned.secure_token)}`);
    }, 700);
  }, [nextUnsigned, navigate, kioskMode, onKioskTokenChange]);

  const goToPoa = useCallback(
    (secureToken: string) => {
      if (!secureToken || secureToken === token) return;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (kioskMode && onKioskTokenChange) {
        onKioskTokenChange(secureToken);
        return;
      }
      navigate(`/poa/${encodeURIComponent(secureToken)}`);
    },
    [token, navigate, kioskMode, onKioskTokenChange],
  );
  const meta = getPoaTypeMeta(data?.type.key);
  const Renderer = getPoaDocRenderer(data?.type.key);
  const template = data?.template || null;
  const isTemplate = !!template;
  const docDir = (meta?.direction || data?.type.direction || 'ltr') as 'ltr' | 'rtl';
  // Shorter documents (Austrian) get more generous spacing in print so they
  // don't look cramped at the top of an otherwise empty page.
  const isRoomyPrint = (data?.type.key || '').startsWith('austrian');
  // The German POA renders guidance boxes in a grey gutter to the right of the
  // document on desktop, so reserve the extra width for it.
  const hasSideHelp = data?.type.key === 'german_citizenship';

  const ctrl: PoaDocController = useMemo(
    () => ({
      values,
      signatures,
      readOnly: isSigned,
      invalid,
      setValue: (id, value) =>
        setValues((prev) => ({ ...prev, [id]: value })),
      setSignature: (id, dataUrl) =>
        setSignatures((prev) => {
          const next = { ...prev };
          if (dataUrl) next[id] = dataUrl;
          else delete next[id];
          return next;
        }),
    }),
    [values, signatures, isSigned, invalid],
  );

  const handleSubmit = useCallback(async () => {
    if (!token || !data) return;
    if (!meta && !template) return;

    const missing = new Set<string>();
    if (template) {
      for (const { instanceId, field } of listPoaFillableInstances(template.body, template.fields)) {
        if (!field.required) continue;
        if (field.type === 'signature') {
          const v = signatures[instanceId];
          if (!(typeof v === 'string' && v.startsWith('data:image/'))) missing.add(instanceId);
        } else if (!(values[instanceId] && values[instanceId].trim())) {
          missing.add(instanceId);
        }
      }
    } else if (meta) {
      for (const fieldId of meta.requiredFields) {
        if (!(values[fieldId] && values[fieldId].trim())) missing.add(fieldId);
      }
      for (const sigId of meta.requiredSignatures) {
        const v = signatures[sigId];
        if (!(typeof v === 'string' && v.startsWith('data:image/'))) missing.add(sigId);
      }
    }

    if (missing.size > 0) {
      setInvalid(missing);
      toast.error('Please complete all required fields and signatures.');
      const firstEl = docRef.current?.querySelector('.border-red-400');
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setInvalid(new Set());
    setSubmitting(true);
    try {
      await submitPoa({
        token,
        fieldData: values,
        signatures,
        signerName:
          values.full_name ||
          values.full_name_he ||
          values.applicant_first_name ||
          values.contact_name ||
          data.contact.name ||
          null,
        signerEmail: values.email || values.rep_email || data.contact.email || null,
      });
      setJustSigned(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Refresh the signing sequence and smoothly open the next unsigned doc.
      let next: PoaSiblingItem | null = null;
      try {
        const fresh = await fetchPoaSiblings(token);
        setSiblings(fresh);
        next = fresh.find((s) => s.secure_token !== token && s.status !== 'signed') || null;
      } catch {
        /* sequence is best-effort */
      }

      if (next) {
        toast.success('Signed. Opening the next document…');
        setAdvancing(true);
        window.setTimeout(() => {
          if (kioskMode && onKioskTokenChange) {
            onKioskTokenChange(next!.secure_token);
            setAdvancing(false);
            return;
          }
          navigate(`/poa/${encodeURIComponent(next!.secure_token)}`);
        }, 1100);
      } else {
        toast.success('All documents signed.');
        if (kioskMode) onKioskComplete?.();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [token, meta, template, data, values, signatures, navigate, kioskMode, onKioskTokenChange, onKioskComplete]);

  const handleShare = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = data ? `${LAW_OFFICE_TITLE} — ${data.type.name}` : 'Power of Attorney';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(docDir === 'rtl' ? 'הקישור הועתק ללוח' : 'Link copied to clipboard');
    } catch {
      /* user cancelled share or clipboard unavailable */
    }
  }, [data, docDir]);

  const handlePrint = useCallback(() => {
    // Print the document inside a clean, isolated window. Printing the live page
    // directly is fragile: the app's flex/sticky layout and a global
    // "@media print { * { background:#fff } }" rule in index.css make Chrome
    // shrink-to-fit the document to a narrow column (the "big white box") and
    // blank the coloured boxes. A dedicated window with explicit, self-contained
    // A4 styling renders predictably and still supports "Save to PDF".
    const node = docRef.current;
    if (!node) {
      window.print();
      return;
    }

    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) {
      // Pop-up blocked — fall back to native print.
      window.print();
      return;
    }

    // Bring along the app's compiled styles (Tailwind utilities live in <style>
    // tags in dev and <link> tags in prod) so the document keeps its look.
    const headStyles = Array.from(
      document.querySelectorAll('link[rel="stylesheet"], style'),
    )
      .map((el) => el.outerHTML)
      .join('\n');

    const dir = meta?.direction || data?.type.direction || 'ltr';
    const lang = meta?.language || data?.type.language || 'en';
    const title = data ? `${LAW_OFFICE_TITLE} — ${data.type.name}` : 'Power of Attorney';

    win.document.open();
    win.document.write(`<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${title}</title>
${headStyles}
<style>
  @page { size: A4; margin: 12mm; }
  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    min-width: 0 !important;
  }
  body { display: block !important; }
  #poa-print-root {
    display: block !important;
    width: 100% !important;
    max-width: none !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 11px;
    line-height: 1.3;
    color: #111 !important;
  }
  /* Neutralise any global "white background on everything" so the colour boxes
     show, then re-assert the document's coloured boxes. */
  #poa-print-root, #poa-print-root * {
    background-color: transparent !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-shadow: none !important;
  }
  #poa-print-root .bg-gray-100 { background-color: #f3f4f6 !important; }
  #poa-print-root [class*="#bcd9dd"] { background-color: #bcd9dd !important; }
  #poa-print-root .bg-yellow-200 { background-color: #fef08a !important; }
  #poa-print-root .bg-gray-800 { background-color: #1f2937 !important; }
  #poa-print-root .poa-title-box { background-color: #44546a !important; color: #fff !important; }
  /* Roomy mode (Austrian POAs): shorter document, so spread it out more. */
  #poa-print-root.poa-print--roomy { font-size: 14px !important; line-height: 1.75 !important; }
  #poa-print-root.poa-print--roomy p { margin-bottom: 18px !important; }
  #poa-print-root.poa-print--roomy li { margin-bottom: 10px !important; }
  #poa-print-root.poa-print--roomy section { margin-bottom: 28px !important; }
  #poa-print-root.poa-print--roomy .mb-8 { margin-bottom: 44px !important; }
  /* Signature: the live canvas can't print — drop it, show a blank line. */
  #poa-print-root canvas { display: none !important; }
  #poa-print-root .poa-sig-edit { display: none !important; }
  #poa-print-root .poa-sig-line { display: block !important; height: 56px !important; }
  /* On-screen guidance never prints. */
  #poa-print-root .poa-help, .poa-help { display: none !important; }
</style>
</head>
<body>${node.outerHTML}</body>
</html>`);
    win.document.close();

    const doPrint = () => {
      win.focus();
      win.print();
    };
    // Give the copied stylesheets a moment to apply before printing.
    if (win.document.readyState === 'complete') {
      win.setTimeout(doPrint, 350);
    } else {
      win.onload = () => win.setTimeout(doPrint, 350);
    }
  }, [meta, data]);

  if (loading) {
    return (
      <CenteredCard>
        <span className="loading loading-spinner loading-lg text-blue-950" />
        <p className="mt-4 text-gray-600">Loading power of attorney…</p>
      </CenteredCard>
    );
  }

  if (error || !data || (!Renderer && !template)) {
    return (
      <CenteredCard>
        <ExclamationCircleIcon className="w-14 h-14 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to load document</h2>
        <p className="text-gray-600">{error || 'This power of attorney link is invalid or no longer available.'}</p>
      </CenteredCard>
    );
  }

  const contactName = data.contact.name?.trim() || '';
  const poaHeaderTitle = [
    data.type.name,
    contactName || null,
    data.type.jurisdiction || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="poa-page min-h-screen flex flex-col" style={PAGE_BG}>
      {/* Print rules: show only the document, full page, no chrome. */}
      <style>{`
        @page { size: A4; margin: 8mm; }
        @media print {
          /* Force the whole ancestor chain to full page width. Without explicit
             widths Chrome's paginated print layout shrink-to-fits the document to
             min-content (~1 char per line) on the left, leaving the rest of the
             page blank — the "big white box". */
          html, body, #root {
            background: #fff !important;
            width: 100% !important;
            min-width: 0 !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            display: block !important;
          }
          .poa-page {
            background: #fff !important;
            min-height: 0 !important;
            display: block !important;
            width: 100% !important;
          }
          .poa-print-hide { display: none !important; }
          .poa-print-main {
            display: block !important;
            width: 100% !important;
            flex: none !important;
            padding: 0 !important;
          }
          .poa-print-main > div {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          #poa-print-root {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            font-size: 10.5px !important;
            line-height: 1.25 !important;
          }

          /* index.css has a global "@media print { * { background:#fff !important } }"
             that forces a white background on EVERY element. Inside a coloured box
             (e.g. the teal Vollmacht / Hinweise box) that means the child <p>/<ul>/
             <li>/<span> all get a white fill that covers the box interior, leaving
             colour only at the rounded corners — the "white box" the user saw.
             Reset every descendant to transparent and force colour printing, then
             re-assert the specific coloured boxes below with higher specificity. */
          #poa-print-root,
          #poa-print-root * {
            background-color: transparent !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #poa-print-root .bg-gray-100 { background-color: #f3f4f6 !important; }
          #poa-print-root [class*="#bcd9dd"] { background-color: #bcd9dd !important; }
          #poa-print-root .bg-yellow-200 { background-color: #fef08a !important; }
          #poa-print-root .bg-gray-800 { background-color: #1f2937 !important; }
          #poa-print-root .poa-title-box { background-color: #44546a !important; color: #fff !important; }

          /* Signature: hide the live canvas, print a blank signing line instead. */
          #poa-print-root .poa-sig-edit { display: none !important; }
          #poa-print-root .poa-sig-line { display: block !important; height: 56px !important; }
          #poa-print-root .poa-signature { break-inside: avoid; }

          /* On-screen guidance never prints. */
          .poa-help { display: none !important; }

          /* Compact everything so the whole document fits on one page. */
          #poa-print-root h1 { font-size: 15px !important; margin-bottom: 4px !important; }
          #poa-print-root p { margin-bottom: 4px !important; }
          #poa-print-root section { margin-bottom: 6px !important; }
          #poa-print-root .poa-field input,
          #poa-print-root .poa-field textarea,
          #poa-print-root .poa-field > div { padding-top: 2px !important; padding-bottom: 2px !important; min-height: 0 !important; }
          #poa-print-root textarea { rows: 1 !important; }
          #poa-print-root .mb-6 { margin-bottom: 6px !important; }
          #poa-print-root .mb-4 { margin-bottom: 4px !important; }
          #poa-print-root .mb-3 { margin-bottom: 3px !important; }
          #poa-print-root .mt-4 { margin-top: 5px !important; }
          #poa-print-root .mt-3 { margin-top: 3px !important; }
          #poa-print-root .mt-2 { margin-top: 2px !important; }
          #poa-print-root .gap-4 { gap: 6px !important; }
          #poa-print-root .gap-6 { gap: 8px !important; }
          #poa-print-root .p-4 { padding: 6px !important; }
          #poa-print-root .p-5 { padding: 8px !important; }
          #poa-print-root .py-5 { padding-top: 6px !important; padding-bottom: 6px !important; }
          #poa-print-root .px-10 { padding-left: 18px !important; padding-right: 18px !important; }
          #poa-print-root .text-4xl { font-size: 22px !important; }
          #poa-print-root .pt-5 { padding-top: 6px !important; }

          /* Roomy mode (Austrian POAs): shorter documents, so undo the heavy
             compaction and give the content generous, evenly spread spacing. */
          #poa-print-root.poa-print--roomy { font-size: 14px !important; line-height: 1.7 !important; }
          #poa-print-root.poa-print--roomy p { margin-bottom: 16px !important; }
          #poa-print-root.poa-print--roomy li { margin-bottom: 10px !important; }
          #poa-print-root.poa-print--roomy section { margin-bottom: 26px !important; }
          #poa-print-root.poa-print--roomy .mb-5 { margin-bottom: 22px !important; }
          #poa-print-root.poa-print--roomy .mb-6 { margin-bottom: 28px !important; }
          #poa-print-root.poa-print--roomy .mb-8 { margin-bottom: 40px !important; }
          #poa-print-root.poa-print--roomy .space-y-4 > * + * { margin-top: 18px !important; }
          #poa-print-root.poa-print--roomy .space-y-2 > * + * { margin-top: 12px !important; }
          #poa-print-root.poa-print--roomy .gap-4 { gap: 18px !important; }
          #poa-print-root.poa-print--roomy .gap-6 { gap: 26px !important; }
          #poa-print-root.poa-print--roomy .poa-field input,
          #poa-print-root.poa-print--roomy .poa-field textarea,
          #poa-print-root.poa-print--roomy .poa-field > div { padding-top: 6px !important; padding-bottom: 6px !important; }
        }
      `}</style>

      {/* Smooth transition while moving to the next document. */}
      {advancing && (
        <div className="poa-print-hide fixed inset-0 z-50 flex items-center justify-center bg-gray-900/25 px-4 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-2xl">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 ring-8 ring-blue-50/80">
              <CheckCircleIcon className="h-9 w-9 text-blue-950" />
            </span>
            <div className="space-y-1">
              <p className="text-lg font-semibold tracking-tight text-gray-900">Document signed</p>
              <p className="text-sm text-gray-500">Taking you to the next document…</p>
            </div>
            <span className="loading loading-dots loading-md text-blue-700" />
          </div>
        </div>
      )}

      {/* Header — mobile stacked; desktop: firm left, title center, actions right */}
      <header className="poa-print-hide sticky top-0 z-20 w-full bg-white/90 backdrop-blur">
        <div className="px-4 py-3 sm:hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <img
                src={POA_LOGO_SRC}
                alt="Decker Pex & Co. Law Offices"
                className="h-12 w-auto max-w-[64px] shrink-0 object-contain"
              />
              <h1 className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
                {LAW_OFFICE_TITLE}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={handleShare}
                className={POA_BTN_SHARE}
                aria-label={docDir === 'rtl' ? 'שתף' : 'Share'}
              >
                <ShareIcon className="h-4 w-4 shrink-0" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[3.5rem] group-hover:opacity-100 sm:max-w-none sm:text-sm sm:opacity-100">
                  {docDir === 'rtl' ? 'שתף' : 'Share'}
                </span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className={POA_BTN_HEADER_BADGE}
                aria-label={docDir === 'rtl' ? 'שמירה / הדפסה' : 'Save / Print'}
              >
                <PrinterIcon className="h-4 w-4 shrink-0" />
                <span className="text-xs sm:text-sm">
                  {docDir === 'rtl' ? 'שמירה / הדפסה' : 'Save / Print'}
                </span>
              </button>
            </div>
          </div>
          <p
            className={`mt-2.5 text-sm font-medium leading-snug text-gray-700 ${
              docDir === 'rtl' ? 'text-right' : 'text-center'
            }`}
            dir={docDir}
          >
            {poaHeaderTitle}
          </p>
        </div>

        <div className="relative hidden w-full items-center justify-between gap-4 px-8 py-4 md:px-10 lg:px-12 sm:flex">
          <div className="z-10 flex min-w-0 items-center justify-start gap-3">
            <img
              src={POA_LOGO_SRC}
              alt="Decker Pex & Co. Law Offices"
              className="h-16 w-auto max-w-[88px] shrink-0 object-contain sm:h-[4.5rem] sm:max-w-[104px]"
            />
            <h1 className="truncate text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
              {LAW_OFFICE_TITLE}
            </h1>
          </div>

          <p className="pointer-events-none absolute left-1/2 top-1/2 max-w-[min(52vw,42rem)] -translate-x-1/2 -translate-y-1/2 truncate px-4 text-center text-sm font-medium text-gray-700 md:text-base">
            {poaHeaderTitle}
          </p>

          <div className="z-10 flex shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleShare}
              className={POA_BTN_SHARE}
              aria-label={docDir === 'rtl' ? 'שתף' : 'Share'}
            >
              <ShareIcon className="h-4 w-4 shrink-0" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[3.5rem] group-hover:opacity-100 sm:max-w-none sm:text-sm sm:opacity-100">
                {docDir === 'rtl' ? 'שתף' : 'Share'}
              </span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className={POA_BTN_HEADER_BADGE}
            >
              <PrinterIcon className="h-4 w-4 shrink-0" />
              <span>{docDir === 'rtl' ? 'שמירה / הדפסה' : 'Save / Print'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="poa-print-main flex-1 w-full">
        <div
          className={`mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8${
            hasSideHelp ? ' lg:max-w-[72rem]' : ''
          }`}
        >
         <div className={hasSideHelp ? 'lg:max-w-[44rem]' : ''}>
          {/* Multi-document signing progress. */}
          {totalDocs > 1 && (
            <div
              className="poa-print-hide mb-6 rounded-2xl border border-gray-200/70 bg-white px-5 py-4 shadow-sm sm:px-6"
              dir={docDir}
            >
              <div
                className={`mb-4 flex items-center justify-between gap-3${
                  docDir === 'rtl' ? ' flex-row-reverse' : ''
                }`}
              >
                <p
                  className={`text-xs font-semibold tracking-[0.12em] text-gray-400 sm:text-sm${
                    docDir === 'rtl' ? ' normal-case tracking-normal' : ' uppercase'
                  }`}
                >
                  {docDir === 'rtl' ? 'התקדמות חתימה' : 'Signing progress'}
                </p>
                <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-800">
                  {docDir === 'rtl'
                    ? `${signedCount} מתוך ${totalDocs} הושלמו`
                    : `${signedCount} of ${totalDocs} complete`}
                </span>
              </div>
              <div className="flex items-center">
                {siblings.map((s, i) => {
                  const done = s.status === 'signed';
                  const isCurrent = s.secure_token === token;
                  const prevDone = i > 0 && siblings[i - 1].status === 'signed';
                  const canNavigate = !isCurrent;
                  const stepLabel =
                    s.type_name ||
                    (docDir === 'rtl' ? `מסמך ${i + 1}` : `Document ${i + 1}`);
                  const stepTitle = !canNavigate
                    ? stepLabel
                    : done
                    ? docDir === 'rtl'
                      ? `${stepLabel} — לחץ לצפייה`
                      : `${stepLabel} — Click to view`
                    : docDir === 'rtl'
                    ? `${stepLabel} — לחץ לחתימה`
                    : `${stepLabel} — Click to sign`;
                  const stepClassName = `relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold transition-all duration-300 ${
                    done
                      ? 'bg-green-600 text-white shadow-sm shadow-green-200/80'
                      : isCurrent
                      ? 'bg-blue-950 text-white ring-4 ring-blue-100'
                      : 'bg-blue-100 text-blue-950'
                  }${
                    canNavigate
                      ? done
                        ? ' cursor-pointer hover:scale-105 hover:bg-green-700 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-green-300 active:scale-95'
                        : ' cursor-pointer hover:scale-105 hover:bg-blue-200 hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 active:scale-95'
                      : ''
                  }`;
                  return (
                    <React.Fragment key={s.id}>
                      {i > 0 && (
                        <div className="mx-1.5 h-1 flex-1 overflow-hidden rounded-full bg-gray-100 sm:mx-2.5">
                          <div
                            className={`h-full rounded-full bg-green-800 transition-all duration-700 ease-out ${
                              prevDone ? 'w-full' : 'w-0'
                            }`}
                          />
                        </div>
                      )}
                      {canNavigate ? (
                        <button
                          type="button"
                          onClick={() => goToPoa(s.secure_token)}
                          className={stepClassName}
                          title={stepTitle}
                          aria-label={stepTitle}
                        >
                          {done ? <CheckIcon className="h-5 w-5 sm:h-6 sm:w-6" /> : i + 1}
                        </button>
                      ) : (
                        <span className={stepClassName} title={stepTitle}>
                          {done ? <CheckIcon className="h-5 w-5 sm:h-6 sm:w-6" /> : i + 1}
                        </span>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              {(() => {
                const idx = siblings.findIndex((s) => s.secure_token === token);
                if (idx < 0) return null;
                return (
                  <p className={`mt-3.5 text-sm text-gray-500 sm:text-base${docDir === 'rtl' ? ' text-right' : ''}`}>
                    <span className="font-semibold text-gray-700">
                      {docDir === 'rtl'
                        ? `מסמך ${idx + 1} מתוך ${totalDocs}`
                        : `Document ${idx + 1} of ${totalDocs}`}
                    </span>
                    {siblings[idx].type_name ? ` · ${siblings[idx].type_name}` : ''}
                  </p>
                );
              })()}
            </div>
          )}

          {isSigned &&
            (allSigned && totalDocs > 1 ? (
              <div className="poa-print-hide mb-6 overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 via-white to-white p-7 text-center shadow-sm">
                <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-950 shadow-md shadow-blue-200/70">
                  <CheckIcon className="h-9 w-9 text-white" />
                </span>
                <p className="text-xl font-bold tracking-tight text-blue-950">All documents signed</p>
                <p className="mx-auto mt-1.5 max-w-md text-sm text-blue-900/80">
                  All {totalDocs} documents for {data.contact.name || 'this contact'} are complete. Thank you.
                </p>
                <button
                  type="button"
                  onClick={handlePrint}
                  className={`btn btn-sm mt-5 gap-1.5 shadow-sm ${POA_BTN_OUTLINE}`}
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Save / Print
                </button>
              </div>
            ) : (
              <div className="poa-print-hide mb-5 flex flex-col gap-3 rounded-2xl border border-blue-200/80 bg-blue-50/70 px-4 py-3.5 sm:flex-row sm:items-center">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                  <CheckCircleIcon className="h-5 w-5 text-blue-950" />
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-blue-950">This document has been signed.</p>
                  <p className="text-xs text-blue-900/75">
                    {nextUnsigned
                      ? `${totalDocs - signedCount} document${totalDocs - signedCount === 1 ? '' : 's'} still to sign.`
                      : data.poa.signed_at
                      ? `Signed on ${new Date(data.poa.signed_at).toLocaleString()}`
                      : ''}
                  </p>
                </div>
                {nextUnsigned && !advancing ? (
                  <button type="button" onClick={goToNext} className={`btn btn-sm gap-1.5 ${POA_BTN_PRIMARY}`}>
                    Continue
                    <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePrint}
                    className={`btn btn-sm btn-outline gap-1.5 ${POA_BTN_OUTLINE}`}
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    Save / Print
                  </button>
                )}
              </div>
            ))}

          {!isSigned && (
            <p
              className="poa-print-hide mb-5 text-base leading-relaxed text-gray-600 sm:text-lg"
              dir={docDir}
            >
              {docDir === 'rtl'
                ? 'אנא עיינו במסמך שלהלן, מלאו את השדות הנדרשים, חתמו ושלחו.'
                : 'Please review the document below, fill in the required fields, sign, and submit.'}
            </p>
          )}

          {/* Document */}
          <div
            id="poa-print-root"
            ref={docRef}
            dir={docDir}
            className={`relative rounded-2xl border border-gray-200 bg-white p-5 pb-32 shadow-sm sm:p-8 sm:pb-40${
              isRoomyPrint ? ' poa-print--roomy' : ''
            }`}
          >
            {isTemplate && template ? (
              <TemplatePoaDoc
                ctrl={ctrl}
                body={template.body}
                fields={template.fields}
                direction={docDir}
                fontFamily={template.font_family}
                fontSize={template.font_size}
              />
            ) : Renderer ? (
              <Renderer ctrl={ctrl} />
            ) : null}
            <ProformaDocumentStamp size="lg" side={docDir === 'rtl' ? 'left' : 'right'} />
          </div>

          {/* Actions */}
          {!isSigned && (
            <div
              className={`poa-print-hide sticky bottom-0 mt-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between${
                docDir === 'rtl' ? ' sm:flex-row-reverse' : ''
              }`}
            >
              <p className={`text-sm leading-relaxed text-gray-600 sm:text-base${docDir === 'rtl' ? ' text-right' : ''}`} dir={docDir}>
                {docDir === 'rtl'
                  ? 'בחתימתך, הנך מאשר/ת כי המידע נכון ומעניק/ה את ייפוי הכוח המפורט לעיל.'
                  : 'By signing, you confirm the information is correct and grant the power of attorney described above.'}
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className={`btn inline-flex h-12 min-h-12 flex-row items-center justify-center gap-2.5 rounded-full px-8 text-base font-semibold sm:min-w-[220px] ${POA_BTN_SIGN}`}
              >
                {submitting ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    {docDir === 'rtl' ? 'שולח…' : 'Submitting…'}
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-6 w-6 shrink-0" />
                    <span>{docDir === 'rtl' ? 'חתום ושלח' : 'Sign & Submit'}</span>
                  </>
                )}
              </button>
            </div>
          )}
         </div>
        </div>
      </main>

      <div className="poa-print-hide">
        <PortalFooter />
      </div>

      <PublicNeedAssistanceWidget
        className="poa-print-hide hidden md:flex"
        dir={docDir}
        labels={
          docDir === 'rtl'
            ? {
                needAssistance: 'צריכים עזרה?',
                close: 'סגור',
                contactOptions: 'אפשרויות יצירת קשר',
              }
            : undefined
        }
      />
    </div>
  );
};

export default PoaPage;
