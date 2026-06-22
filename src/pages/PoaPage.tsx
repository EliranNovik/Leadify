import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  ShareIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import PublicContractFooter from '../components/public/PublicContractFooter';
import { fetchPoaByToken, submitPoa, type PoaPublicData } from '../lib/poaApi';
import { getPoaTypeMeta } from '../lib/poaTypes';
import { getPoaDocRenderer } from '../components/poa/documents';
import type { PoaDocController } from '../components/poa/PoaFormPrimitives';

const PAGE_BG: React.CSSProperties = { background: '#f3f4f6' };

const LAW_OFFICE_TITLE = 'Decker, Pex & Co. Law Office';

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={PAGE_BG}>
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 max-w-md w-full text-center">
          {children}
        </div>
      </div>
      <PublicContractFooter variant="payment" />
    </div>
  );
}

const PoaPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PoaPublicData | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [justSigned, setJustSigned] = useState(false);

  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
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
  const meta = getPoaTypeMeta(data?.type.key);
  const Renderer = getPoaDocRenderer(data?.type.key);
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
    if (!token || !meta || !data) return;

    const missing = new Set<string>();
    for (const fieldId of meta.requiredFields) {
      if (!(values[fieldId] && values[fieldId].trim())) missing.add(fieldId);
    }
    for (const sigId of meta.requiredSignatures) {
      const v = signatures[sigId];
      if (!(typeof v === 'string' && v.startsWith('data:image/'))) missing.add(sigId);
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
          values.full_name || values.full_name_he || values.applicant_first_name || data.contact.name || null,
        signerEmail: values.email || values.rep_email || data.contact.email || null,
      });
      setJustSigned(true);
      toast.success('Power of attorney signed successfully.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [token, meta, data, values, signatures]);

  const handleShare = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = data ? `${LAW_OFFICE_TITLE} — ${data.type.name}` : 'Power of Attorney';
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      /* user cancelled share or clipboard unavailable */
    }
  }, [data]);

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

    const dir = meta?.direction || 'ltr';
    const title = data ? `${LAW_OFFICE_TITLE} — ${data.type.name}` : 'Power of Attorney';

    win.document.open();
    win.document.write(`<!doctype html>
<html dir="${dir}" lang="${meta?.language || 'en'}">
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
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="mt-4 text-gray-600">Loading power of attorney…</p>
      </CenteredCard>
    );
  }

  if (error || !data || !Renderer) {
    return (
      <CenteredCard>
        <ExclamationCircleIcon className="w-14 h-14 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Unable to load document</h2>
        <p className="text-gray-600">{error || 'This power of attorney link is invalid or no longer available.'}</p>
      </CenteredCard>
    );
  }

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

      {/* Header — clean white */}
      <header className="poa-print-hide sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-8 sm:py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <ShieldCheckIcon className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
                  {LAW_OFFICE_TITLE}
                </h1>
                <p className="text-xs text-gray-500 sm:text-sm">
                  {data.type.name}
                  {data.type.jurisdiction ? ` · ${data.type.jurisdiction}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="btn btn-sm btn-ghost gap-1.5 text-gray-600 hover:text-gray-900"
              >
                <ShareIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Share</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="btn btn-sm btn-outline gap-1.5 border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
              >
                <PrinterIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Save / Print</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="poa-print-main flex-1 w-full">
        <div
          className={`mx-auto w-full max-w-3xl px-3 py-6 sm:px-6 sm:py-8${
            hasSideHelp ? ' lg:max-w-[64rem]' : ''
          }`}
        >
         <div className={hasSideHelp ? 'lg:max-w-[44rem]' : ''}>
          {isSigned && (
            <div className="poa-print-hide mb-5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-600" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-900">This power of attorney has been signed.</p>
                {data.poa.signed_at && (
                  <p className="text-xs text-emerald-700">
                    Signed on {new Date(data.poa.signed_at).toLocaleString()}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handlePrint}
                className="btn btn-sm btn-outline border-emerald-300 text-emerald-700 hover:bg-emerald-100 gap-1.5"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                Save / Print
              </button>
            </div>
          )}

          {!isSigned && (
            <p
              className="poa-print-hide mb-5 text-sm text-gray-600"
              dir={meta?.direction || 'ltr'}
            >
              {meta?.language === 'he'
                ? 'אנא עיינו במסמך שלהלן, מלאו את השדות הנדרשים, חתמו ושלחו.'
                : 'Please review the document below, fill in the required fields, sign, and submit.'}
            </p>
          )}

          {/* Document */}
          <div
            id="poa-print-root"
            ref={docRef}
            dir={meta?.direction || 'ltr'}
            className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8${
              isRoomyPrint ? ' poa-print--roomy' : ''
            }`}
          >
            <Renderer ctrl={ctrl} />
          </div>

          {/* Actions */}
          {!isSigned && (
            <div className="poa-print-hide sticky bottom-0 mt-6 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500">
                By signing, you confirm the information is correct and grant the power of attorney described above.
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="btn btn-primary gap-2 sm:min-w-[200px]"
              >
                {submitting ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Submitting…
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-5 w-5" />
                    Sign &amp; Submit
                  </>
                )}
              </button>
            </div>
          )}
         </div>
        </div>
      </main>

      <div className="poa-print-hide">
        <PublicContractFooter variant="payment" />
      </div>
    </div>
  );
};

export default PoaPage;
