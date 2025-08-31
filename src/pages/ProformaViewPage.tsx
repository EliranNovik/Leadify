import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import jsPDF from 'jspdf';
import html2pdf from 'html2pdf.js';
import { PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../msalConfig';
import toast from 'react-hot-toast';
import { createPaymentLink } from '../lib/supabase';

// To fix TypeScript linter error, add a file src/types/html2pdf.js.d.ts with: declare module 'html2pdf.js';
// And run: npm install html2pdf.js

// MinimalInvoice: style-isolated, hex/rgb only, no class names
const MinimalInvoice = React.forwardRef(({ proforma }: { proforma: any }, ref: React.Ref<HTMLDivElement>) => (
  <div ref={ref} style={{ background: '#fff', color: '#18181b', maxWidth: 800, width: '100%', margin: '0 auto', padding: 32, borderRadius: 24, boxShadow: '0 2px 8px #e5e7eb', border: '1px solid #e5e7eb', overflow: 'hidden', fontFamily: 'Inter, Arial, sans-serif' }}>
    {/* Google Fonts link for Inter */}
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 56 }}>
      <div style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#3b28c7', fontWeight: 700, fontSize: 32, fontFamily: 'Inter, Arial, sans-serif' }}>RMQ</span>
      </div>
      <div>
        <div style={{ color: '#18181b', fontWeight: 800, fontSize: 32, letterSpacing: '-0.02em', fontFamily: 'Inter, Arial, sans-serif' }}>Proforma Invoice</div>
        <div style={{ color: '#6b7280', fontWeight: 600, fontSize: 16, marginTop: 4, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.proformaName}</div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#404040', fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, Arial, sans-serif' }}>Rainmaker Queen</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>123 Main St, Tel Aviv</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>+972-3-1234567</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>info@rainmakerqueen.com</div>
        <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, width: '100%' }}>
          <div><span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Proforma #:</span> <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.proformaName}</span></div>
          <div style={{ textAlign: 'right' }}><span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Date:</span> <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{new Date(proforma.createdAt).toLocaleDateString()}</span></div>
        </div>
        <div style={{ marginBottom: 48 }}></div>
      </div>
      <div>
        <div style={{ color: '#404040', fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, Arial, sans-serif' }}>Bill To:</div>
        <div style={{ color: '#18181b', fontWeight: 700, fontSize: 18, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.client}</div>
        {proforma.phone && (
          <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.phone}</div>
        )}
        {proforma.email && (
          <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.email}</div>
        )}
        {!(proforma.phone || proforma.email) && (
          <div style={{ color: '#f87171', fontSize: 12, fontFamily: 'Inter, Arial, sans-serif' }}>No client phone/email saved in proforma.</div>
        )}
      </div>
    </div>
    <div style={{ marginBottom: 32, width: '100%', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
      <table style={{ width: '100%', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb', fontFamily: 'Inter, Arial, sans-serif' }}>
        <thead style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
          <tr>
            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#404040', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Inter, Arial, sans-serif' }}>Description</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#404040', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Inter, Arial, sans-serif' }}>Qty</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#404040', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Inter, Arial, sans-serif' }}>Rate</th>
            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#404040', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: 'Inter, Arial, sans-serif' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {proforma.rows.map((row: any, idx: number) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f3f4f6' }}>
              <td style={{ padding: '8px 16px', color: '#18181b', fontWeight: 500, fontFamily: 'Inter, Arial, sans-serif' }}>{row.description}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{row.qty}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.currency} {row.rate}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.currency} {row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24, justifyContent: 'flex-end', width: '100%', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#f3f4f6', borderRadius: 16, padding: 24, border: '1px solid #e5e7eb', fontFamily: 'Inter, Arial, sans-serif', marginLeft: 'auto', marginRight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, marginBottom: 8 }}>
          <span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Subtotal</span>
          <span style={{ color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.currency} {proforma.total}</span>
        </div>
        {proforma.addVat && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, marginBottom: 8 }}>
            <span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>VAT (18%)</span>
            <span style={{ color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.currency} {(proforma.totalWithVat - proforma.total).toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 16, fontWeight: 800 }}>
          <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>Total</span>
          <span style={{ color: '#3b28c7', fontWeight: 800, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.currency} {proforma.totalWithVat}</span>
        </div>
      </div>
    </div>
    {proforma.notes && (
      <div style={{ marginTop: 24, padding: 16, background: '#fefce8', borderRadius: 12, borderLeft: '4px solid #facc15', color: '#404040', fontStyle: 'italic', fontFamily: 'Inter, Arial, sans-serif' }}>
        <span style={{ fontWeight: 600 }}>Notes:</span> {proforma.notes}
      </div>
    )}
  </div>
));

const ProformaViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { instance, accounts } = useMsal();
  const [sendingEmail, setSendingEmail] = useState(false);
  const minimalInvoiceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchProforma = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from('payment_plans')
        .select('proforma')
        .eq('id', id)
        .single();
      if (error || !data || !data.proforma) {
        setError('Proforma not found.');
        setLoading(false);
        return;
      }
      try {
        let parsed = JSON.parse(data.proforma);
        // Patch: If email/phone missing, fetch from leads
        if ((!parsed.email || !parsed.phone) && parsed.clientId) {
          const { data: leadData } = await supabase
            .from('leads')
            .select('email, phone')
            .eq('id', parsed.clientId)
            .single();
          if (leadData) {
            if (!parsed.email) parsed.email = leadData.email || '';
            if (!parsed.phone) parsed.phone = leadData.phone || '';
          }
        }
        // Patch: If addVat true, currency is NIS/ILS/₪, and vat is 0, recalc vat
        if (
          parsed.addVat &&
          (parsed.currency === '₪') &&
          (!parsed.vat || parsed.vat === 0)
        ) {
          parsed.vat = Math.round(parsed.total * 0.18 * 100) / 100;
          parsed.totalWithVat = parsed.total + parsed.vat;
        }
        setProforma(parsed);
      } catch (e) {
        setError('Failed to parse proforma data.');
      }
      setLoading(false);
    };
    if (id) fetchProforma();
  }, [id]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = () => {
    if (!invoiceRef.current) return;
    setPdfLoading(true);
    html2pdf(invoiceRef.current, {
      margin: 0,
      filename: `${proforma?.proformaName || 'proforma'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).then(() => setPdfLoading(false)).catch(() => setPdfLoading(false));
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this proforma?')) return;
    await supabase
      .from('payment_plans')
      .update({ proforma: null })
      .eq('id', id);
    navigate(-1);
  };

  // Helper: Convert Blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(',')[1]); // Remove data URL prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Handler: Send proforma as email with PDF attachment
  const handleSendEmail = async () => {
    if (!proforma?.email) {
      toast.error('No client email found in proforma.');
      return;
    }
    if (!minimalInvoiceRef.current) {
      toast.error('Invoice not ready.');
      return;
    }
    if (!instance || !accounts[0]) {
      toast.error('Not authenticated.');
      return;
    }
    setSendingEmail(true);
    try {
      // 0. Create payment link for this proforma
      let paymentLink = '';
      try {
        paymentLink = await createPaymentLink({
          paymentPlanId: proforma.paymentRowId,
          clientId: proforma.clientId,
          value: proforma.base,
          valueVat: proforma.vat,
          currency: proforma.currency,
          order: proforma.rows[0]?.description || '',
          clientName: proforma.client,
          leadNumber: proforma.clientId // or pass lead_number if available
        });
      } catch (err) {
        toast.error('Failed to create payment link. Email not sent.');
        setSendingEmail(false);
        return;
      }
      // 1. Generate PDF Blob from minimal invoice
      const pdfBlob: Blob = await html2pdf()
        .from(minimalInvoiceRef.current)
        .set({
          margin: 0,
          filename: `${proforma?.proformaName || 'proforma'}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: true },
          jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
        })
        .outputPdf('blob');
      // 2. Convert Blob to base64
      const pdfBase64 = await blobToBase64(pdfBlob);
      // 3. Acquire Graph token
      let tokenResponse;
      try {
        tokenResponse = await instance.acquireTokenSilent({ ...loginRequest, account: accounts[0] });
      } catch (error) {
        tokenResponse = await instance.acquireTokenPopup({ ...loginRequest, account: accounts[0] });
      }
      const accessToken = tokenResponse.accessToken;
      // 4. Prepare email
      const senderName = accounts[0]?.name || 'Your Team';
      const subject = `Proforma Invoice: ${proforma.proformaName || ''}`;
      const paymentLinkHtml = paymentLink ? `<p><strong>Payment Link:</strong> <a href="${paymentLink}">${paymentLink}</a><br/>You can pay securely online using the link above.</p>` : '';
      const body = `<p>Dear ${proforma.client || 'Client'},</p><p>Please find attached your proforma invoice.</p>${paymentLinkHtml}<p>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices</p>`;
      const attachments = [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `${proforma?.proformaName || 'proforma'}.pdf`,
          contentType: 'application/pdf',
          contentBytes: pdfBase64,
        },
      ];
      const draftMessage = {
        subject,
        body: { contentType: 'HTML', content: body },
        toRecipients: [{ emailAddress: { address: proforma.email } }],
        attachments,
      };
      // 5. Send email via Graph API (draft + send)
      // Create draft
      const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(draftMessage),
      });
      if (!draftRes.ok) {
        throw new Error('Failed to create email draft.');
      }
      const createdDraft = await draftRes.json();
      const messageId = createdDraft.id;
      if (!messageId) throw new Error('Could not get message ID from draft.');
      // Send draft
      const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!sendRes.ok) {
        throw new Error('Failed to send email.');
      }
      toast.success('Proforma sent to client!');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send email.');
    }
    setSendingEmail(false);
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!proforma) return null;

  return (
    <div className="max-w-3xl mx-auto bg-white shadow-2xl rounded-2xl p-8 mt-10 print:bg-white print:shadow-none print:p-2">
      {/* Inline style override for html2pdf/html2canvas color compatibility */}
      <style>{`
        #invoice-print-area, #invoice-print-area * {
          color: #222 !important;
          background: #fff !important;
          background-color: #fff !important;
          box-shadow: none !important;
        }
        #invoice-print-area .text-primary, #invoice-print-area .text-purple-700, #invoice-print-area .text-primary-content {
          color: #3b28c7 !important;
        }
        #invoice-print-area .bg-primary, #invoice-print-area .bg-purple-700, #invoice-print-area .bg-primary-content {
          background: #3b28c7 !important;
          background-color: #3b28c7 !important;
        }
      `}</style>
      {/* Header with action buttons, visible on screen only */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 border-b pb-6 print-hide">
        <div /> {/* Empty left side, no logo/title here */}
        <div className="flex gap-2 mt-6 md:mt-0">
          <button className="btn btn-outline btn-sm gap-2" onClick={handlePrint} title="Print"><PrinterIcon className="w-5 h-5" /> Print</button>
          <button className="btn btn-outline btn-sm gap-2" onClick={handleSendEmail} disabled={sendingEmail} title="Send to Client">
            {sendingEmail ? <span className="loading loading-spinner loading-xs" /> : <EnvelopeIcon className="w-5 h-5" />} Send
          </button>
          <button className="btn btn-error btn-sm gap-2" onClick={handleDelete} title="Delete"><TrashIcon className="w-5 h-5" /> Delete</button>
        </div>
      </div>
      {/* Info section (PDF target) */}
      <div ref={invoiceRef} id="invoice-print-area" className="bg-white max-w-[1100px] w-full mx-auto p-8 rounded-2xl shadow border overflow-hidden">
        {/* Logo and Title for print and PDF */}
        <div className="flex items-center gap-4 mb-14">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200">
            <span className="text-2xl font-bold text-primary">RMQ</span>
          </div>
          <div>
            <div className="text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">Proforma Invoice</div>
            <div className="text-base text-gray-500 font-semibold mt-1">{proforma.proformaName}</div>
          </div>
        </div>
        {/* End Logo and Title */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Company Info and Proforma Number/Date Row */}
          <div className="mb-4">
            <div className="font-semibold text-gray-700 mb-1">Rainmaker Queen</div>
            <div className="text-sm text-gray-500">123 Main St, Tel Aviv</div>
            <div className="text-sm text-gray-500">+972-3-1234567</div>
            <div className="text-sm text-gray-500">info@rainmakerqueen.com</div>
            <div className="flex flex-row justify-between items-center mt-6 w-full">
              <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{proforma.proformaName}</span></div>
              <div className="text-right"><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date(proforma.createdAt).toLocaleDateString()}</span></div>
            </div>
            <div className="mb-12"></div>
          </div>
          <div>
            <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
            <div className="text-lg font-bold text-gray-900">{proforma.client}</div>
            {proforma.phone && (
              <div className="text-sm text-gray-500">{proforma.phone}</div>
            )}
            {proforma.email && (
              <div className="text-sm text-gray-500">{proforma.email}</div>
            )}
            {!(proforma.phone || proforma.email) && (
              <div className="text-xs text-red-400">No client phone/email saved in proforma.</div>
            )}
          </div>
        </div>
        {/* Table */}
        <div className="mb-8">
          <table className="min-w-full border rounded-xl overflow-hidden">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Rate</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-700 uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {proforma.rows.map((row: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                  <td className="px-4 py-2 text-right">{row.qty}</td>
                  <td className="px-4 py-2 text-right">{proforma.currency} {row.rate}</td>
                  <td className="px-4 py-2 text-right font-bold">{proforma.currency} {row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals summary */}
        <div className="flex flex-col md:flex-row md:justify-end gap-4 mb-6">
          <div className="w-full md:w-1/2 bg-gray-50 rounded-xl p-6 border border-gray-200">
            <div className="flex justify-between text-lg mb-2">
              <span className="font-semibold text-gray-700">Subtotal</span>
              <span className="font-bold text-gray-900">{proforma.currency} {proforma.total}</span>
            </div>
            {proforma.addVat && (
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">VAT (18%)</span>
                <span className="font-bold text-gray-900">{proforma.currency} {(proforma.totalWithVat - proforma.total).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
              <span>Total</span>
              <span className="text-primary">{proforma.currency} {proforma.totalWithVat}</span>
            </div>
          </div>
        </div>
        {/* Notes */}
        {proforma.notes && (
          <div className="mt-6 p-4 bg-yellow-50 rounded-lg border-l-4 border-yellow-400 text-gray-700 italic">
            <span className="font-semibold">Notes:</span> {proforma.notes}
          </div>
        )}
        {/* Created by at bottom left inside the card */}
        {/* Removed created by from print area as requested */}
      </div>
      {/* Hidden minimal invoice for PDF generation */}
      <div style={{ position: 'absolute', left: -9999, top: 0, width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        {proforma && <MinimalInvoice ref={minimalInvoiceRef} proforma={proforma} />}
      </div>
      {/* Created by, visible on screen only, hidden in print */}
      {proforma.createdBy && (
        <div className="mt-4 text-xs text-gray-400 text-left print-hide">
          Created by: {proforma.createdBy}
          {proforma.createdAt && (
            <> on {new Date(proforma.createdAt).toLocaleDateString()}, {new Date(proforma.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
          )}
        </div>
      )}
      {pdfLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 shadow-lg flex flex-col items-center">
            <span className="loading loading-spinner loading-lg text-primary mb-4"></span>
            <span className="text-lg font-medium text-gray-700">Generating PDF...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProformaViewPage; 