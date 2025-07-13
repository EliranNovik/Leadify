import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import jsPDF from 'jspdf';
import { PrinterIcon, EnvelopeIcon, ArrowDownTrayIcon, TrashIcon } from '@heroicons/react/24/outline';

const ProformaViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proforma, setProforma] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setProforma(JSON.parse(data.proforma));
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
    if (!proforma) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(proforma.proformaName, 20, 20);
    doc.setFontSize(12);
    doc.text(`Client: ${proforma.client}`, 20, 35);
    doc.text(`Date: ${new Date(proforma.createdAt).toLocaleDateString()}`, 20, 45);
    doc.text(`Created by: ${proforma.createdBy || ''}`, 20, 55);
    doc.text(`Total: ${proforma.totalWithVat} ${proforma.currency}`, 20, 65);
    let y = 80;
    proforma.rows.forEach((row: any, idx: number) => {
      doc.text(`${idx + 1}. ${row.description} - Qty: ${row.qty} - Rate: ${row.rate} - Total: ${row.total}`, 20, y);
      y += 10;
    });
    doc.save(`${proforma.proformaName.replace(/ /g, '_')}.pdf`);
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this proforma?')) return;
    await supabase
      .from('payment_plans')
      .update({ proforma: null })
      .eq('id', id);
    navigate(-1);
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!proforma) return null;

  return (
    <div className="max-w-3xl mx-auto bg-white shadow-2xl rounded-2xl p-8 mt-10 print:bg-white print:shadow-none print:p-2">
      {/* Header with logo and title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 border-b pb-6">
        <div className="flex items-center gap-4">
          {/* Logo placeholder - replace src with your logo if desired */}
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200">
            {/* <img src="/logo.png" alt="Logo" className="w-14 h-14 object-contain" /> */}
            <span className="text-2xl font-bold text-primary">RMQ</span>
          </div>
          <div>
            <div className="text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">Proforma Invoice</div>
            <div className="text-base text-gray-500 font-semibold mt-1">{proforma.proformaName}</div>
          </div>
        </div>
        <div className="flex gap-2 mt-6 md:mt-0">
          <button className="btn btn-outline btn-sm gap-2" onClick={handlePrint} title="Print"><PrinterIcon className="w-5 h-5" /> Print</button>
          <button className="btn btn-outline btn-sm gap-2" onClick={() => alert('Send to client coming soon!')} title="Send to Client"><EnvelopeIcon className="w-5 h-5" /> Send</button>
          <button className="btn btn-outline btn-sm gap-2" onClick={handleDownloadPDF} title="Download PDF"><ArrowDownTrayIcon className="w-5 h-5" /> PDF</button>
          <button className="btn btn-error btn-sm gap-2" onClick={handleDelete} title="Delete"><TrashIcon className="w-5 h-5" /> Delete</button>
        </div>
      </div>

      {/* Info section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div>
          <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
          <div className="text-lg font-bold text-gray-900">{proforma.client}</div>
          {/* Add more client info here if available */}
        </div>
        <div className="flex flex-col gap-1 md:items-end">
          <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{proforma.proformaName}</span></div>
          <div><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date(proforma.createdAt).toLocaleDateString()}</span></div>
          {/* Removed Created by from here */}
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
      <div className="mt-8 text-xs text-gray-400 text-left">
        Created by: {proforma.createdBy || ''}
      </div>
    </div>
  );
};

export default ProformaViewPage; 