import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { createPelecardPaymentSession } from '../lib/pelecardPaymentApi';
import PelecardCheckoutFrame from '../components/PelecardCheckoutFrame';
import toast from 'react-hot-toast';
import { 
  CreditCardIcon, 
  BanknotesIcon, 
  CheckCircleIcon,
  ExclamationCircleIcon,
  ShieldCheckIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

interface PaymentLink {
  id: string;
  secure_token?: string;
  amount: number;
  vat_amount: number;
  total_amount: number;
  currency: string;
  description: string;
  status: string;
  expires_at: string;
  payment_plan_id: number;
  client_id: string;
  leads?: {
    lead_number?: string;
    topic?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  payment_plans?: {
    payment_order?: string;
  };
}

const PaymentPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  const [paymentLink, setPaymentLink] = useState<PaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string>('credit_card');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [showThankYou, setShowThankYou] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPaymentLink = async () => {
      if (!token) {
        toast.error('Invalid payment link');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('payment_links')
          .select(`
            *,
            leads!client_id(lead_number, topic, name, email, phone),
            payment_plans:payment_plan_id(payment_order)
          `)
          .eq('secure_token', token)
          .maybeSingle();

        if (error || !data) {
          console.error('Error fetching payment link:', error);
          setPageError('Payment link not found or invalid');
          return;
        }

        if (data.status === 'paid') {
          setPaymentLink(data);
          setShowThankYou(true);
          return;
        }

        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          setPageError('This payment link has expired. Please contact the office for a new link.');
          return;
        }

        if (data.status === 'expired' || data.status === 'cancelled') {
          setPageError(
            data.status === 'cancelled'
              ? 'This payment was cancelled. You can open the link again to retry.'
              : 'This payment link has expired.'
          );
          if (data.status === 'cancelled') {
            setPaymentLink(data);
          }
          return;
        }

        setPaymentLink(data);
      } catch (error) {
        console.error('Error:', error);
        toast.error('Failed to load payment information');
      } finally {
        setLoading(false);
      }
    };

    fetchPaymentLink();
  }, [token]);

  const canPay =
    paymentLink &&
    paymentLink.status !== 'paid' &&
    paymentLink.status !== 'expired' &&
    !(paymentLink.expires_at && new Date(paymentLink.expires_at) < new Date());

  const isOnlinePayment =
    selectedMethod === 'credit_card' ||
    selectedMethod === 'apple_pay' ||
    selectedMethod === 'google_pay';

  const loadPelecardSession = async () => {
    if (!token || !paymentLink || !isOnlinePayment) return;

    setSessionLoading(true);
    setSessionError(null);
    setPageError(null);

    try {
      const result = await createPelecardPaymentSession(token);
      if (!result.success || !result.paymentUrl) {
        throw new Error(result.error || 'Failed to create payment session');
      }
      setPaymentUrl(result.paymentUrl);
    } catch (error) {
      console.error('[Pelecard] Session error:', error);
      const message =
        error instanceof Error ? error.message : 'Could not start payment';
      setSessionError(message);
      setPageError(message);
      toast.error(message);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    if (!canPay || !isOnlinePayment) {
      setPaymentUrl(null);
      return;
    }
    loadPelecardSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when token or method changes
  }, [token, selectedMethod, canPay]);

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => {
    if (!currency) return '₪';
    if (currency === 'USD' || currency === '$') return '$';
    if (currency === '₪') return '₪';
    return currency;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center justify-center">
            <div className="loading loading-spinner loading-lg text-primary"></div>
            <span className="ml-3 text-lg font-medium text-gray-700">Loading payment details...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentLink && pageError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <ExclamationCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unable to load payment</h2>
            <p className="text-gray-600 mb-6">{pageError}</p>
            <button 
              onClick={() => navigate('/')}
              className="btn btn-primary"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentLink) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <ExclamationCircleIcon className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Link Not Found</h2>
            <p className="text-gray-600 mb-6">
              This payment link is invalid, expired, or has already been used.
            </p>
            <button 
              onClick={() => navigate('/')}
              className="btn btn-primary"
            >
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (showThankYou) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        {/* RMQ 2.0 Header at very top */}
        <div className="w-full py-6 flex justify-center items-center">
          <span className="text-3xl font-extrabold tracking-tight text-primary" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>
            RMQ 2.0
          </span>
        </div>
        <div className="flex flex-col items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="text-center">
              {/* Purple Tick Icon */}
              <CheckCircleIcon className="w-20 h-20 mx-auto mb-6 text-primary" style={{ color: '#3b28c7' }} />
              {/* Thank you message */}
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank you {paymentLink.leads?.name || 'Client'}!</h2>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Payment Successful!</h2>
              <p className="text-gray-600 mb-2">
                Thank you for your payment of
              </p>
              <p className="text-2xl font-bold text-green-600 mb-6">
                {getCurrencySymbol(paymentLink.currency)}{paymentLink.total_amount.toLocaleString()}
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-600">
                  A confirmation email will be sent to your email: <strong>{paymentLink.leads?.email || 'your email'}</strong>
                </p>
              </div>
              <p className="text-sm text-gray-500">
                You can safely close this window.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header with Logo */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <span className="text-2xl font-extrabold tracking-tight" style={{ color: '#3b28c7', letterSpacing: '-0.03em' }}>
              RMQ 2.0
            </span>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <ShieldCheckIcon className="w-4 h-4" />
              <span>Secure Payment</span>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Complete Your Payment</h1>
            <p className="text-gray-600">Secure and encrypted payment processing</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Payment Summary */}
            <div className="lg:col-span-1">
              <div className="card bg-base-100 shadow-xl sticky top-8">
                <div className="card-body">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <BanknotesIcon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="card-title text-lg">Payment Summary</h3>
                  </div>
                  
                  {/* Invoice Details */}
                  <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 mb-4">
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">Invoice Details</div>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Service:</span>
                        <span className="text-sm">{paymentLink.payment_plans?.payment_order || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Client:</span>
                        <span className="text-sm">{paymentLink.description?.split(' - ')[1]?.split(' (#')[0] || 'Client'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Lead #:</span>
                        <span className="text-sm font-mono">{paymentLink.leads?.lead_number || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Topic:</span>
                        <span className="badge badge-primary badge-sm">{paymentLink.leads?.topic || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Amount Breakdown */}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Subtotal:</span>
                      <span className="font-semibold">{getCurrencySymbol(paymentLink.currency)}{paymentLink.amount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">VAT (18%):</span>
                      <span className="font-semibold">{getCurrencySymbol(paymentLink.currency)}{paymentLink.vat_amount.toLocaleString()}</span>
                    </div>
                    <div className="divider my-2"></div>
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-bold text-gray-900">Total Amount:</span>
                      <span className="text-xl font-bold text-primary">{getCurrencySymbol(paymentLink.currency)}{paymentLink.total_amount.toLocaleString()}</span>
                    </div>
                  </div>

                  {paymentLink.expires_at && (
                    <div className="mt-4 flex items-center gap-2">
                      <ClockIcon className="w-4 h-4 text-yellow-600" />
                      <div className="text-xs">
                        <div className="font-semibold">Payment Link Expires</div>
                        <div>{new Date(paymentLink.expires_at).toLocaleDateString()} at {new Date(paymentLink.expires_at).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-2">
                    <ShieldCheckIcon className="w-4 h-4 text-green-600" />
                    <div className="text-xs">
                      <div className="font-semibold">Secure Payment</div>
                      <div>Protected by 256-bit SSL encryption</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Payment Method</h3>

                {/* Payment Method Selection */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <button
                    onClick={() => setSelectedMethod('credit_card')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      selectedMethod === 'credit_card'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <CreditCardIcon className="w-6 h-6 mx-auto mb-2 text-gray-700" />
                    <span className="text-sm font-medium">Credit Card</span>
                  </button>

                  <button
                    onClick={() => setSelectedMethod('bank_transfer')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      selectedMethod === 'bank_transfer'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <BanknotesIcon className="w-6 h-6 mx-auto mb-2 text-gray-700" />
                    <span className="text-sm font-medium">Bank Transfer</span>
                  </button>

                  <button
                    onClick={() => setSelectedMethod('apple_pay')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      selectedMethod === 'apple_pay'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="w-24 h-16 mx-auto mb-2 flex items-center justify-center">
                      <svg viewBox="0 0 32 32" width="48" height="48">
                        <rect width="32" height="32" rx="8" fill="black"/>
                        <text x="16" y="22" textAnchor="middle" fontSize="11" fill="white" fontWeight="bold" fontFamily="Arial"> Pay</text>
                      </svg>
                    </div>
                    <span className="text-sm font-medium">Apple Pay</span>
                  </button>

                  <button
                    onClick={() => setSelectedMethod('google_pay')}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      selectedMethod === 'google_pay'
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="w-24 h-16 mx-auto mb-2 flex items-center justify-center">
                      <svg viewBox="0 0 32 32" width="48" height="48">
                        <rect width="32" height="32" rx="8" fill="#4285F4"/>
                        <text x="16" y="22" textAnchor="middle" fontSize="11" fill="white" fontWeight="bold" fontFamily="Arial">G Pay</text>
                      </svg>
                    </div>
                    <span className="text-sm font-medium">Google Pay</span>
                  </button>
                </div>

                {isOnlinePayment && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-semibold text-gray-900">Secure checkout</h4>
                      <span className="badge badge-ghost text-xs">Pelecard · PCI DSS</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      {selectedMethod === 'apple_pay'
                        ? 'Use the Apple Pay button inside the checkout below (Safari / iOS).'
                        : selectedMethod === 'google_pay'
                          ? 'Use the Google Pay button inside the checkout below (Chrome / Android).'
                          : 'Enter your card in the secure form below. Details never touch our servers.'}
                    </p>
                    <PelecardCheckoutFrame
                      paymentUrl={paymentUrl}
                      loading={sessionLoading}
                      error={sessionError}
                      onRetry={loadPelecardSession}
                      title={
                        selectedMethod === 'apple_pay'
                          ? 'Apple Pay · Card · Google Pay'
                          : selectedMethod === 'google_pay'
                            ? 'Google Pay · Card · Apple Pay'
                            : 'Card · Apple Pay · Google Pay'
                      }
                    />
                  </div>
                )}

                {selectedMethod === 'bank_transfer' && (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-2">Bank Transfer Instructions</h4>
                    <p className="text-sm text-gray-700 mb-3">
                      Please transfer the amount to the following account:
                    </p>
                    <div className="space-y-1 text-sm">
                      <p><strong>Bank:</strong> Example Bank</p>
                      <p><strong>Account Number:</strong> 123-456-789</p>
                      <p><strong>IBAN:</strong> IL123456789012345678901</p>
                      <p><strong>Reference:</strong> {paymentLink.id}</p>
                    </div>
                  </div>
                )}

                {pageError && !isOnlinePayment && (
                  <p className="mb-4 text-sm text-red-600 text-center">{pageError}</p>
                )}

                {selectedMethod === 'bank_transfer' && (
                  <p className="text-sm text-center text-gray-500 py-4">
                    Complete the transfer using the details above, then contact the office to confirm.
                  </p>
                )}

                <div className="mt-4 text-center">
                  <p className="text-xs text-gray-500">
                    Payments are processed by Pelecard with 256-bit SSL encryption.
                    {isOnlinePayment && ' Complete payment in the secure form above.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentPage;