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

// MinimalInvoice: style-isolated, hex/rgb only, no class names
const MinimalInvoice = React.forwardRef(({ proforma, getCurrencySymbol }: { proforma: any, getCurrencySymbol: (currency?: string) => string }, ref: React.Ref<HTMLDivElement>) => {
  // Add null check to prevent rendering when proforma is null
  if (!proforma) {
    return <div ref={ref} style={{ background: '#fff', color: '#18181b', maxWidth: 800, width: '100%', margin: '0 auto', padding: 32, borderRadius: 24, boxShadow: '0 2px 8px #e5e7eb', border: '1px solid #e5e7eb', overflow: 'hidden', fontFamily: 'Inter, Arial, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>Loading proforma data...</div>
    </div>;
  }

  return (
  <div ref={ref} style={{ background: '#fff', color: '#18181b', maxWidth: 800, width: '100%', margin: '0 auto', padding: 32, borderRadius: 24, boxShadow: '0 2px 8px #e5e7eb', border: '1px solid #e5e7eb', overflow: 'hidden', fontFamily: 'Inter, Arial, sans-serif' }}>
    {/* Google Fonts link for Inter */}
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet" />
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 56 }}>
      <div style={{ width: 110, height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/dpl_logo2.jpg" alt="DPL Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
      <div>
        <div style={{ color: '#18181b', fontWeight: 800, fontSize: 32, letterSpacing: '-0.02em', fontFamily: 'Inter, Arial, sans-serif' }}>Proforma Invoice</div>
        <div style={{ color: '#6b7280', fontWeight: 600, fontSize: 16, marginTop: 4, fontFamily: 'Inter, Arial, sans-serif' }}>Proforma #{proforma.id}</div>
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginBottom: 32 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: '#404040', fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, Arial, sans-serif' }}>From:</div>
        <div style={{ color: '#18181b', fontWeight: 700, fontSize: 18, fontFamily: 'Inter, Arial, sans-serif' }}>Decker Pex Levi Law office</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>Yad Haruzim 10, Jerusalem;</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>150 Begin Rd. Tel-Aviv, Israel</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>Phone: +972737895444, +972262914009</div>
        <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>PaymentReport3@lawoffice.org.il</div>
        <div style={{ marginBottom: 48 }}></div>
      </div>
      <div>
        <div style={{ color: '#404040', fontWeight: 600, marginBottom: 4, fontFamily: 'Inter, Arial, sans-serif' }}>Bill To:</div>
        <div style={{ color: '#18181b', fontWeight: 700, fontSize: 18, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.client_name}</div>
        {proforma.client_phone && (
          <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.client_phone}</div>
        )}
        {proforma.client_email && (
          <div style={{ color: '#6b7280', fontSize: 14, fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.client_email}</div>
        )}
        {proforma.lead_number && (
          <div style={{ color: '#6b7280', fontSize: 14, fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Lead #: {proforma.lead_number}</div>
        )}
        {!(proforma.client_phone || proforma.client_email) && (
          <div style={{ color: '#f87171', fontSize: 12, fontFamily: 'Inter, Arial, sans-serif' }}>No client phone/email saved in proforma.</div>
        )}
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
      <div><span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Proforma #:</span> <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{proforma.id}</span></div>
      <div><span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Date:</span> <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{new Date(proforma.cdate).toLocaleDateString()}</span></div>
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
          {(proforma.rows || []).map((row: any, idx: number) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f3f4f6' }}>
              <td style={{ padding: '8px 16px', color: '#18181b', fontWeight: 500, fontFamily: 'Inter, Arial, sans-serif' }}>{row.description}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{row.qty}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>{getCurrencySymbol(proforma.currency_code)} {row.rate}</td>
              <td style={{ padding: '8px 16px', textAlign: 'right', color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{getCurrencySymbol(proforma.currency_code)} {row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24, justifyContent: 'flex-end', width: '100%', maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#f3f4f6', borderRadius: 16, padding: 24, border: '1px solid #e5e7eb', fontFamily: 'Inter, Arial, sans-serif', marginLeft: 'auto', marginRight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, marginBottom: 8 }}>
          <span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>Subtotal</span>
          <span style={{ color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{getCurrencySymbol(proforma.currency_code)} {proforma.sub_total || proforma.total_base}</span>
        </div>
        {proforma.add_vat === 't' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, marginBottom: 8 }}>
            <span style={{ color: '#404040', fontWeight: 600, fontFamily: 'Inter, Arial, sans-serif' }}>VAT (18%)</span>
            <span style={{ color: '#18181b', fontWeight: 700, fontFamily: 'Inter, Arial, sans-serif' }}>{getCurrencySymbol(proforma.currency_code)} {proforma.vat_value || 0}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22, marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 16, fontWeight: 800 }}>
          <span style={{ color: '#18181b', fontFamily: 'Inter, Arial, sans-serif' }}>Total</span>
          <span style={{ color: '#006BB1', fontWeight: 800, fontFamily: 'Inter, Arial, sans-serif' }}>{getCurrencySymbol(proforma.currency_code)} {proforma.total}</span>
        </div>
      </div>
    </div>
    {/* Issued by and timestamp at bottom */}
    {(proforma.issuedBy || proforma.issuedDate) && (
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#6b7280', fontFamily: 'Inter, Arial, sans-serif' }}>
        {proforma.issuedBy && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>Issued by:</span> <span>{proforma.issuedBy}</span>
          </div>
        )}
        {proforma.issuedDate && (
          <div>
            <span style={{ fontWeight: 600 }}>Date:</span> <span>{new Date(proforma.issuedDate).toLocaleDateString()}, {new Date(proforma.issuedDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
      </div>
    )}
  </div>
  );
});

const ProformaLegacyViewPage: React.FC = () => {
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

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    // Map currency codes to symbols
    if (currency === 'ILS' || currency === '₪') return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === 'EUR' || currency === '€') return '€';
    if (currency === 'GBP' || currency === '£') return '£';
    if (currency === 'CAD' || currency === 'C$') return 'C$';
    if (currency === 'AUD' || currency === 'A$') return 'A$';
    if (currency === 'JPY' || currency === '¥') return '¥';
    if (currency === 'CHF') return 'CHF';
    if (currency === 'SEK') return 'SEK';
    if (currency === 'NOK') return 'NOK';
    if (currency === 'DKK') return 'DKK';
    if (currency === 'PLN') return 'PLN';
    if (currency === 'CZK') return 'CZK';
    if (currency === 'HUF') return 'HUF';
    if (currency === 'RON') return 'RON';
    if (currency === 'BGN') return 'BGN';
    if (currency === 'HRK') return 'HRK';
    if (currency === 'RUB') return 'RUB';
    if (currency === 'UAH') return 'UAH';
    if (currency === 'TRY') return 'TRY';
    if (currency === 'ILS') return '₪';
    // If it's already a symbol, return it
    if (currency.length <= 2 && !currency.match(/^[A-Z]{3}$/)) return currency;
    // Default fallback
    return currency;
  };

  useEffect(() => {
    const fetchProforma = async () => {
      setLoading(true);
      setError(null);
      
      // Variables to store issued by information
      let issuedBy: string | null = null;
      let issuedDate: string | null = null;
      
      // Try fetching from the view first
      let { data, error } = await supabase
        .from('proforma_with_rows')
        .select('*')
        .eq('id', id)
        .single();
      
      // Fetch cxd_by_id, creator_id, cxd_date, and cdate from proformainvoice table (for both view and direct fetch paths)
      const { data: proformaData, error: proformaError } = await supabase
        .from('proformainvoice')
        .select('cxd_by_id, creator_id, cxd_date, cdate')
        .eq('id', id)
        .single();
      
      if (!proformaError && proformaData) {
        // Use cdate (creation date) as issued date (cxd_date is cancellation date, which is NULL for active proformas)
        issuedDate = proformaData.cdate || null;
        
        // Try cxd_by_id first (cancelled by), then creator_id (created by) to get employee display_name
        const employeeId = proformaData.cxd_by_id || proformaData.creator_id;
        if (employeeId) {
          const { data: employeeData, error: employeeError } = await supabase
            .from('tenants_employee')
            .select('display_name')
            .eq('id', employeeId)
            .single();
          
          if (!employeeError && employeeData?.display_name) {
            issuedBy = employeeData.display_name;
          }
        }
      }
        
      // If view fetch succeeds, also fetch client data if missing
      if (!error && data && data.lead_id && (!data.client_email || !data.client_phone)) {
        
        // First try to get basic lead info
        const { data: leadData, error: leadError } = await supabase
          .from('leads_lead')
          .select('name')
          .eq('id', data.lead_id)
          .single();
        
        
        if (!leadError && leadData) {
          data.client_name = data.client_name || leadData.name || 'Client';
        }
        
        // Try to get contact info from leads_contact via lead_leadcontact (same as ClientInformationBox)
        try {
          // First, let's check what contacts exist for this lead
          const { data: allContacts, error: allContactsError } = await supabase
            .from('lead_leadcontact')
            .select(`
              main,
              contact_id
            `)
            .eq('lead_id', data.lead_id);
          
          
          // Try to get the main contact (try different main values)
          let leadContacts = null;
          let leadContactsError = null;
          
          // Try with 'true' (string)
          const { data: contactsTrue, error: errorTrue } = await supabase
            .from('lead_leadcontact')
            .select(`
              main,
              contact_id
            `)
            .eq('lead_id', data.lead_id)
            .eq('main', 'true');
          
          if (!errorTrue && contactsTrue && contactsTrue.length > 0) {
            leadContacts = contactsTrue;
            leadContactsError = errorTrue;
          } else {
            // Try with true (boolean)
            const { data: contactsBool, error: errorBool } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', data.lead_id)
              .eq('main', true);
            
            if (!errorBool && contactsBool && contactsBool.length > 0) {
              leadContacts = contactsBool;
              leadContactsError = errorBool;
            } else {
              // Try with 1 (numeric)
              const { data: contactsNum, error: errorNum } = await supabase
                .from('lead_leadcontact')
                .select(`
                  main,
                  contact_id
                `)
                .eq('lead_id', data.lead_id)
                .eq('main', 1);
              
              leadContacts = contactsNum;
              leadContactsError = errorNum;
            }
          }
          
          if (!leadContactsError && leadContacts && leadContacts.length > 0) {
            // Get the contact details from leads_contact table
            const { data: contactData, error: contactError } = await supabase
              .from('leads_contact')
              .select('email, phone')
              .eq('id', leadContacts[0].contact_id)
              .single();
            
            if (!contactError && contactData) {
              data.client_email = data.client_email || contactData.email || '';
              data.client_phone = data.client_phone || contactData.phone || '';
            }
          } else {
            // Fallback: try to get any contact for this lead
            if (allContacts && allContacts.length > 0) {
              const { data: contactData, error: contactError } = await supabase
                .from('leads_contact')
                .select('email, phone')
                .eq('id', allContacts[0].contact_id)
                .single();
              
              if (!contactError && contactData) {
                data.client_email = data.client_email || contactData.email || '';
                data.client_phone = data.client_phone || contactData.phone || '';
              }
            }
          }
        } catch (contactError) {
          // Error handling - contact data will remain null
        }
      }
        
      // If view fails, try direct table fetch
      if (error || !data) {
        const { data: directData, error: directError } = await supabase
          .from('proformainvoice')
          .select(`
            *,
            proformainvoicerow(*)
          `)
          .eq('id', id)
          .single();
        
        if (directError) {
          setError(`Error fetching proforma: ${directError.message}`);
          setLoading(false);
          return;
        }
        
        if (!directData) {
          setError('Proforma not found.');
          setLoading(false);
          return;
        }
        
        // Fetch client information from leads_lead table
        let clientName = 'Client';
        let clientEmail = '';
        let clientPhone = '';
        
        if (directData.lead_id) {
          // First try to get basic lead info
          const { data: leadData, error: leadError } = await supabase
            .from('leads_lead')
            .select('name')
            .eq('id', directData.lead_id)
            .single();
          
          if (!leadError && leadData) {
            clientName = leadData.name || 'Client';
          }
          
          // Try to get contact info from leads_contact via lead_leadcontact (same as ClientInformationBox)
          try {
            // First, let's check what contacts exist for this lead
            const { data: allContacts, error: allContactsError } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', directData.lead_id);
            
            // Try to get the main contact (try different main values)
            let leadContacts = null;
            let leadContactsError = null;
            
            // Try with 'true' (string)
            const { data: contactsTrue, error: errorTrue } = await supabase
              .from('lead_leadcontact')
              .select(`
                main,
                contact_id
              `)
              .eq('lead_id', directData.lead_id)
              .eq('main', 'true');
            
            if (!errorTrue && contactsTrue && contactsTrue.length > 0) {
              leadContacts = contactsTrue;
              leadContactsError = errorTrue;
            } else {
              // Try with true (boolean)
              const { data: contactsBool, error: errorBool } = await supabase
                .from('lead_leadcontact')
                .select(`
                  main,
                  contact_id
                `)
                .eq('lead_id', directData.lead_id)
                .eq('main', true);
              
              if (!errorBool && contactsBool && contactsBool.length > 0) {
                leadContacts = contactsBool;
                leadContactsError = errorBool;
              } else {
                // Try with 1 (numeric)
                const { data: contactsNum, error: errorNum } = await supabase
                  .from('lead_leadcontact')
                  .select(`
                    main,
                    contact_id
                  `)
                  .eq('lead_id', directData.lead_id)
                  .eq('main', 1);
                
                leadContacts = contactsNum;
                leadContactsError = errorNum;
              }
            }
            
            if (!leadContactsError && leadContacts && leadContacts.length > 0) {
              // Get the contact details from leads_contact table
              const { data: contactData, error: contactError } = await supabase
                .from('leads_contact')
                .select('email, phone')
                .eq('id', leadContacts[0].contact_id)
                .single();
              
              if (!contactError && contactData) {
                clientEmail = contactData.email || '';
                clientPhone = contactData.phone || '';
              }
            } else {
              // Fallback: try to get any contact for this lead
              if (allContacts && allContacts.length > 0) {
                const { data: contactData, error: contactError } = await supabase
                  .from('leads_contact')
                  .select('email, phone')
                  .eq('id', allContacts[0].contact_id)
                  .single();
                
                if (!contactError && contactData) {
                  clientEmail = contactData.email || '';
                  clientPhone = contactData.phone || '';
                }
              }
            }
          } catch (contactError) {
            // Error handling - contact data will remain null
          }
        }
        
        // Transform direct table data to match view format
        data = {
          ...directData,
          rows: directData.proformainvoicerow || [],
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          currency_name: 'Israeli Shekel',
          currency_code: directData.currency_id ? getCurrencySymbol(directData.currency_id.toString()) : '₪',
          lead_number: directData.lead_id?.toString() || '',
          issuedBy: issuedBy,
          issuedDate: issuedDate
        };
      } else {
        // Add issued by information to view data
        if (data) {
          data.issuedBy = issuedBy;
          data.issuedDate = issuedDate;
        }
      }
      
      if (error && !data) {
        setError(`Error fetching proforma: ${error.message}`);
        setLoading(false);
        return;
      }
      
      if (!data) {
        setError('Proforma not found.');
        setLoading(false);
        return;
      }
      setProforma(data);
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
      filename: `proforma-legacy-${proforma?.id || 'proforma'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: true },
      jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' }
    }).then(() => setPdfLoading(false)).catch(() => setPdfLoading(false));
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this proforma?')) return;
    try {
      // Delete rows first
      const { error: rowsError } = await supabase
        .from('proformainvoicerow')
        .delete()
        .eq('invoice_id', id);
      
      if (rowsError) throw rowsError;
      
      // Delete proforma
      const { error: proformaError } = await supabase
        .from('proformainvoice')
        .delete()
        .eq('id', id);
      
      if (proformaError) throw proformaError;
      
      toast.success('Proforma deleted successfully!');
      navigate(-1);
    } catch (error) {
      console.error('Error deleting proforma:', error);
      toast.error('Failed to delete proforma.');
    }
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
    if (!proforma?.client_email) {
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
          paymentPlanId: proforma.id,
          clientId: proforma.lead_id,
          value: proforma.total_base || proforma.sub_total,
          valueVat: proforma.vat_value || 0,
          currency: getCurrencySymbol(proforma.currency_code),
          order: proforma.rows[0]?.description || '',
          clientName: proforma.client_name,
          leadNumber: proforma.lead_number
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
          filename: `proforma-legacy-${proforma?.id || 'proforma'}.pdf`,
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
      const subject = `Proforma Invoice: ${proforma.id}`;
      const paymentLinkHtml = paymentLink ? `<p><strong>Payment Link:</strong> <a href="${paymentLink}">${paymentLink}</a><br/>You can pay securely online using the link above.</p>` : '';
      const body = `<p>Dear ${proforma.client_name || 'Client'},</p><p>Please find attached your proforma invoice.</p>${paymentLinkHtml}<p>Best regards,<br>${senderName}<br>Decker Pex Levi Law Offices</p>`;
      const attachments = [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `proforma-legacy-${proforma?.id || 'proforma'}.pdf`,
          contentType: 'application/pdf',
          contentBytes: pdfBase64,
        },
      ];
      const draftMessage = {
        subject,
        body: { contentType: 'HTML', content: body },
        toRecipients: [{ emailAddress: { address: proforma.client_email } }],
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

  if (loading) return <div className="p-8 text-center">Loading proforma...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Error: {error}</div>;
  if (!proforma) return <div className="p-8 text-center text-yellow-600">No proforma data found.</div>;

  return (
    <div className="max-w-3xl mx-auto bg-white shadow-2xl rounded-2xl p-8 mt-10">
      {/* Inline style override for html2pdf/html2canvas color compatibility */}
      <style>{`
        @media print {
          * {
            visibility: hidden !important;
          }
          #invoice-print-area, #invoice-print-area * {
            visibility: visible !important;
          }
          body, html {
            margin: 0 !important;
            padding: 0 !important;
          }
          .print-hide {
            display: none !important;
          }
          #invoice-print-area {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
            color: black !important;
          }
          #invoice-print-area * {
            color: black !important;
            background: white !important;
            box-shadow: none !important;
          }
          #invoice-print-area .text-primary {
            color: #006BB1 !important;
          }
          #invoice-print-area .bg-primary {
            background: #006BB1 !important;
            color: white !important;
          }
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
          <div className="w-24 h-24 flex items-center justify-center">
            <img src="/dpl_logo2.jpg" alt="DPL Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="text-3xl font-extrabold text-gray-900 tracking-tight leading-tight">Proforma Invoice</div>
            <div className="text-base text-gray-500 font-semibold mt-1">Proforma #{proforma.id}</div>
          </div>
        </div>
        {/* End Logo and Title */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Company Info */}
          <div className="mb-4">
            <div className="font-semibold text-gray-700 mb-1">From:</div>
            <div className="text-lg font-bold text-gray-900">Decker Pex Levi Law office</div>
            <div className="text-sm text-gray-500">Yad Haruzim 10, Jerusalem;</div>
            <div className="text-sm text-gray-500">150 Begin Rd. Tel-Aviv, Israel</div>
            <div className="text-sm text-gray-500">Phone: +972737895444, +972262914009</div>
            <div className="text-sm text-gray-500">PaymentReport3@lawoffice.org.il</div>
            <div className="mb-12"></div>
          </div>
          <div>
            <div className="font-semibold text-gray-700 mb-1">Bill To:</div>
            <div className="text-lg font-bold text-gray-900">{proforma.client_name}</div>
            {proforma.client_phone && (
              <div className="text-sm text-gray-500">{proforma.client_phone}</div>
            )}
            {proforma.client_email && (
              <div className="text-sm text-gray-500">{proforma.client_email}</div>
            )}
            {proforma.lead_number && (
              <div className="text-sm text-gray-500 font-semibold">Lead #: {proforma.lead_number}</div>
            )}
            {!(proforma.client_phone || proforma.client_email) && (
              <div className="text-xs text-red-400">No client phone/email saved in proforma.</div>
            )}
          </div>
        </div>
        <div className="flex justify-between items-center mb-8">
          <div><span className="font-semibold text-gray-700">Proforma #:</span> <span className="text-gray-900">{proforma.id}</span></div>
          <div><span className="font-semibold text-gray-700">Date:</span> <span className="text-gray-900">{new Date(proforma.cdate).toLocaleDateString()}</span></div>
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
              {(proforma.rows || []).map((row: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-900 font-medium">{row.description}</td>
                  <td className="px-4 py-2 text-right">{row.qty}</td>
                  <td className="px-4 py-2 text-right">{getCurrencySymbol(proforma.currency_code)} {row.rate}</td>
                  <td className="px-4 py-2 text-right font-bold">{getCurrencySymbol(proforma.currency_code)} {row.total}</td>
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
              <span className="font-bold text-gray-900">{getCurrencySymbol(proforma.currency_code)} {proforma.sub_total || proforma.total_base}</span>
            </div>
            {proforma.add_vat === 't' && (
              <div className="flex justify-between text-lg mb-2">
                <span className="font-semibold text-gray-700">VAT (18%)</span>
                <span className="font-bold text-gray-900">{getCurrencySymbol(proforma.currency_code)} {proforma.vat_value || 0}</span>
              </div>
            )}
            <div className="flex justify-between text-xl mt-4 border-t pt-4 font-extrabold">
              <span>Total</span>
              <span style={{ color: '#006BB1' }}>{getCurrencySymbol(proforma.currency_code)} {proforma.total}</span>
            </div>
          </div>
        </div>
        {/* Issued by and timestamp at bottom */}
        {(proforma.issuedBy || proforma.issuedDate) && (
          <div className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-500">
            {proforma.issuedBy && (
              <div className="mb-1">
                <span className="font-semibold">Issued by:</span> <span>{proforma.issuedBy}</span>
              </div>
            )}
            {proforma.issuedDate && (
              <div>
                <span className="font-semibold">Date:</span> <span>{new Date(proforma.issuedDate).toLocaleDateString()}, {new Date(proforma.issuedDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Hidden minimal invoice for PDF generation */}
      <div style={{ position: 'absolute', left: -9999, top: 0, width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        {proforma && <MinimalInvoice ref={minimalInvoiceRef} proforma={proforma} getCurrencySymbol={getCurrencySymbol} />}
      </div>
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

export default ProformaLegacyViewPage;
