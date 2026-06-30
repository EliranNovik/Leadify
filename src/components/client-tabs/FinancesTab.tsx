import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { BanknotesIcon, PencilIcon, TrashIcon, XMarkIcon, Squares2X2Icon, Bars3Icon, CurrencyDollarIcon, UserIcon, MinusIcon, CheckIcon, LinkIcon, ClipboardDocumentIcon, ArrowUturnLeftIcon, ExclamationTriangleIcon, PaperAirplaneIcon, ChevronDownIcon, ClockIcon, EllipsisVerticalIcon } from '@heroicons/react/24/outline';
import { ClientTabPageHeader } from './ClientTabPageHeader';
import {
  fetchContactPaymentHistory,
  insertPaymentLinkRecord,
  loadPaidPaymentLinkPlanIds,
  loadPaymentPlanTaxReceipts,
  type PaymentPlanTaxReceiptInfo,
} from '../../lib/paymentLinkQueries';
import { retryPayperInvoice } from '../../lib/pelecardPaymentApi';
import toast from 'react-hot-toast';
import { ClientTabProps } from '../../types/client';
import { useRealtimeRefresh, type RealtimeChangePayload } from '../../hooks/useRealtimeRefresh';
import { useContactProfileImageUrls } from '../../hooks/useContactProfileImageUrls';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../msalConfig';
import ReactDOM from 'react-dom';
import { BanknotesIcon as BanknotesIconSolid } from '@heroicons/react/24/solid';
import { PencilLine, Trash2 } from 'lucide-react';
import { DocumentTextIcon, Cog6ToothIcon, ChartPieIcon, PlusIcon, ChatBubbleLeftRightIcon, DocumentCheckIcon } from '@heroicons/react/24/outline';
import EditPaymentModal from '../modals/EditPaymentModal';
import AddPaymentModal from '../modals/AddPaymentModal';
import NotesModal from '../modals/NotesModal';
import {
  PaymentPlanSummaryCards,
  PaymentStatusPill,
  ContactPlanHeader,
  computePlanSummary,
  DueDateBadge,
  PaidPaymentDateBadge,
  getContactAccentColor,
  PAYMENT_PLAN_SUMMARY_FILTER_LABELS,
  paymentMatchesSummaryFilter,
  type PaymentPlanSummaryFilter,
} from './paymentPlanUi';

// Portal dropdown — avoids overflow:hidden / table clipping on DaisyUI dropdowns
const AnchorDropdownPortal: React.FC<{
  anchorId: string | number | null;
  buttonRefs: React.MutableRefObject<Record<string | number, HTMLButtonElement | null>>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchorId, buttonRefs, open, onClose, children }) => {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useEffect(() => {
    if (!open || anchorId == null) return;

    const updatePosition = () => {
      const anchorEl = buttonRefs.current[anchorId];
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
        zIndex: 99999,
        visibility: 'visible',
      });
    };

    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorId, buttonRefs]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('.anchor-dropdown-portal') ||
        target.closest('[data-payment-menu-trigger]')
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open, onClose]);

  if (!open) return null;

  return ReactDOM.createPortal(
    <div style={style} className="anchor-dropdown-portal">
      {children}
    </div>,
    document.body
  );
};

import { generateProformaName } from '../../lib/proforma';
import {
  currencyIdFromSymbol,
  displaySymbolForPaymentSave,
  displaySymbolFromAccountingRow,
  findAccountingCurrency,
  isNisCurrency,
  mapLeadCurrencyToSymbol as mapPaymentCurrencyToSymbol,
  resolveCurrencyIdForSave,
} from '../../lib/paymentPlanCurrency';
import { calculatePaymentPlanVatAmount, readPaymentPlanVatFromRow } from '../../lib/paymentPlanVat';
import { sumUnpaidBaseAndVatByCurrencyFromPayments } from '../../lib/financeUnpaidTotal';
import { isExpenseNoVatPayment } from '../../lib/proformaVat';
import {
  formatContractTotalNisDisplay,
  formatExpenseNoVatNisDisplay,
  formatOutstandingNisDisplay,
  sumExpenseNoVatPlanTotalsInNis,
  sumPaymentPlanTotalsInNis,
} from '../../lib/paymentPlanTotalInNis';
import { getClientContracts, getContractDetails } from '../../lib/contractAutomation';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '../../contexts/AuthContext';
import ProformaSendLanguageModal from '../proforma/ProformaSendLanguageModal';
import type { ProformaSendLanguage } from '../../lib/proformaSendLanguage';
import {
  disableInvoiceSendAutomation,
  enableInvoiceSendAutomation,
  buildSendInvoiceInputForPaymentPlan,
  paymentPlanHasProforma,
  paymentPlanSelectionKey,
  type PaymentPlanAutomationRow,
} from '../../lib/paymentPlanInvoiceAutomation';
import { ensureProformasForAutomationPayments } from '../../lib/proformaAutomationCreate';
import {
  buildProformaSendSuccessMessage,
  collectProformaSendPartialErrors,
  sendProformaInvoiceBundle,
} from '../../lib/proformaSendInvoice';
import { useMailboxReconnect } from '../../contexts/MailboxReconnectContext';

const FINANCES_TAB_CACHE_KEY_PREFIX = 'financesTab_cache_';

function getFinancesTabCacheKey(clientId: string | number): string {
  return `${FINANCES_TAB_CACHE_KEY_PREFIX}${String(clientId)}`;
}

interface PaymentPlan {
  id: string | number;
  duePercent: string;
  dueDate: string;
  value: number;
  valueVat: number;
  client: string;
  order: string;
  proforma?: string | null;
  notes: string;
  paid?: boolean;
  paid_at?: string;
  paid_by?: string;
  currency?: string;
  currency_id?: number | null;
  isLegacy?: boolean; // Flag to identify legacy payments
  ready_to_pay?: boolean; // Flag to indicate if payment is ready for collection
  ready_to_pay_by?: number | null; // Employee ID who marked it as ready to pay
  ready_to_pay_by_display_name?: string | null; // Display name of employee who marked it as ready to pay
  client_id?: number | null; // Contact ID (client_id from payment plan row)
  sent_to_finance?: boolean; // Flag to indicate if payment was sent to finance
  sent_to_finance_at?: string | null; // Timestamp when payment was sent to finance
  invoice_send_automation_active?: boolean;
  invoice_send_automation_language?: string | null;
  invoice_send_automation_at?: string | null;
  invoice_send_automation_sent_at?: string | null;
}

interface FinancePlan {
  total: number;
  vat: number;
  payments: PaymentPlan[];
}

type FinancesTabNisDisplays = {
  contractTotalNisDisplay: { primary: string; secondary?: string; loading: boolean };
  expenseNoVatNisDisplay: { primary?: string; loading: boolean };
  outstandingNisDisplay: { primary: string; loading: boolean };
  contactTotalNisByName: Record<string, { primary: string; loading: boolean }>;
};

type FinancesTabCachedState = {
  financePlan: FinancePlan | null;
  contacts: any[];
  contracts: any[];
  availableCurrencies: Array<{ id: number; name: string; iso_code: string }>;
  viewMode: 'table' | 'boxes';
  collapsedContacts: { [key: string]: boolean };
  paidMap: { [id: string]: boolean };
  // Cached NIS conversions for the summary cards so they render instantly on re-entry instead of
  // flashing back to a loading state while they are recomputed.
  nisDisplays?: FinancesTabNisDisplays;
};

/** Stable signature of the payment rows that affect NIS totals — used to skip needless recomputes. */
function financesNisSignature(payments?: PaymentPlan[]): string {
  return JSON.stringify(
    (payments ?? []).map((p) => [p.id, p.client, p.value, p.valueVat, p.paid, p.currency ?? '']),
  );
}

function restoreFinancesTabCache(clientId: string | number): FinancesTabCachedState | null {
  try {
    const key = getFinancesTabCacheKey(clientId);
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FinancesTabCachedState;
    if (parsed && Array.isArray(parsed.contacts) && Array.isArray(parsed.contracts) && Array.isArray(parsed.availableCurrencies)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function persistFinancesTabCache(clientId: string | number, state: FinancesTabCachedState): void {
  try {
    const key = getFinancesTabCacheKey(clientId);
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}

interface FinancesTabProps extends ClientTabProps {
  onPaymentMarkedPaid?: (paymentId: string | number) => void;
  onCreateFinancePlan?: () => void;
  hideTimelineHistory?: boolean; // Hide timeline and history buttons
}

const FinancesTab: React.FC<FinancesTabProps> = ({ client, onClientUpdate, onPaymentMarkedPaid, onCreateFinancePlan, hideTimelineHistory = false }) => {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { showReconnectModal } = useMailboxReconnect();

  // Helper function to format date as dd/mm/yyyy
  const formatDateDDMMYYYY = (dateString: string | null | undefined): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (date.toString() === 'Invalid Date') return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Helper function to detect Hebrew text and return RTL direction
  const getNotesTextDirection = (text: string | null | undefined): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    // Check if text contains Hebrew characters (Unicode range 0590-05FF)
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'rtl' : 'ltr';
  };

  // Helper: VAT rate by date. Use plan.date for legacy, plan.due_date for new leads.
  // 17% for dates before 2025-01-01, 18% on or after 2025-01-01. Saves correctly to vat_value / value_vat.
  const getVatRateForLegacyLead = (dateString: string | null | undefined): number => {
    if (!dateString) {
      // If no date provided, default to 18% (current rate)
      return 0.18;
    }

    const paymentDate = new Date(dateString);
    if (isNaN(paymentDate.getTime())) {
      // If date is invalid, default to 18%
      return 0.18;
    }

    // VAT rate change date: 2025-01-01
    const vatChangeDate = new Date('2025-01-01T00:00:00');

    // If payment date is before 2025-01-01, use 17% VAT
    if (paymentDate < vatChangeDate) {
      return 0.17;
    }

    // Otherwise, use 18% VAT (for dates on or after 2025-01-01)
    return 0.18;
  };
  const { instance } = useMsal();
  const [financePlan, setFinancePlan] = useState<FinancePlan | null>(null);
  const [isLoadingFinancePlan, setIsLoadingFinancePlan] = useState<boolean>(true);
  const [contractTotalNisDisplay, setContractTotalNisDisplay] = useState<{
    primary: string;
    secondary?: string;
    loading: boolean;
  }>({ primary: '—', loading: true });
  const [expenseNoVatNisDisplay, setExpenseNoVatNisDisplay] = useState<{
    primary?: string;
    loading: boolean;
  }>({ loading: true });
  const [outstandingNisDisplay, setOutstandingNisDisplay] = useState<{
    primary: string;
    loading: boolean;
  }>({ primary: '—', loading: true });
  const [contactTotalNisByName, setContactTotalNisByName] = useState<
    Record<string, { primary: string; loading: boolean }>
  >({});
  // Signature of the payments the NIS displays were last computed for. Lets us skip recomputing
  // (and the loading flash) when financePlan changes reference but the underlying values are the
  // same — e.g. a silent background sync, a focus refetch, or restoring from cache.
  const lastNisSigRef = useRef<string | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | number | null>(null);
  const [editPaymentData, setEditPaymentData] = useState<any>({});
  const [isSavingPaymentRow, setIsSavingPaymentRow] = useState(false);
  const [editingPaymentInModal, setEditingPaymentInModal] = useState<PaymentPlan | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'boxes'>('table');
  const [paymentSummaryFilter, setPaymentSummaryFilter] = useState<PaymentPlanSummaryFilter | null>(null);
  const [collapsedContacts, setCollapsedContacts] = useState<{ [key: string]: boolean }>({});
  const [openDropdownPaymentId, setOpenDropdownPaymentId] = useState<string | number | null>(null);
  const dropdownButtonRefs = useRef<{ [key: string | number]: HTMLButtonElement | null }>({});

  // Holds the latest silent reload so the realtime subscription below can call it without
  // depending on declaration order (the reload function is defined further down in this component).
  const refreshAllDataRef = useRef<(() => Promise<void> | void) | null>(null);

  // Live updates: when this lead's payment plans / rows / proformas change in the database
  // (another user, an automation, the public payment link, etc.) refresh the finances data in
  // place. Cached finances render instantly; only the changed rows update — no full page reload.
  useRealtimeRefresh({
    channelName: `finances-tab-${client?.id ?? 'none'}`,
    enabled: !!client?.id,
    tables: (() => {
      const leadIdRaw = String(client?.id ?? '');
      const leadIdStripped = leadIdRaw.replace(/^legacy_/, '').toLowerCase();
      const matchLead = (payload: RealtimeChangePayload) => {
        const row = payload?.new ?? payload?.old;
        if (!row) return true; // unknown row → refetch to be safe
        const lid = (row as Record<string, unknown>).lead_id;
        if (lid == null) return true;
        const s = String(lid).toLowerCase();
        return s === leadIdStripped || s === leadIdRaw.toLowerCase();
      };
      return [
        { table: 'payment_plans', event: '*' as const, match: matchLead },
        { table: 'finances_paymentplanrow', event: '*' as const, match: matchLead },
        { table: 'proformainvoice', event: '*' as const, match: matchLead },
        {
          table: 'payment_links',
          event: '*' as const,
          match: (payload: RealtimeChangePayload) => {
            const row = payload?.new ?? payload?.old;
            if (!row) return true;
            const r = row as Record<string, unknown>;
            const clientId = r.client_id != null ? String(r.client_id) : '';
            const legacyId = r.legacy_id != null ? String(r.legacy_id) : '';
            const leadIdRaw = String(client?.id ?? '');
            const leadIdStripped = leadIdRaw.replace(/^legacy_/, '');
            if (clientId && clientId === leadIdRaw) return true;
            if (legacyId && legacyId === leadIdStripped) return true;
            return false;
          },
        },
      ];
    })(),
    onChange: () => {
      void refreshAllDataRef.current?.();
    },
  });

  // Initialize all contacts as collapsed by default
  useEffect(() => {
    if (financePlan && financePlan.payments.length > 0) {
      const contacts = [...new Set(financePlan.payments.map(p => p.client))];

      // Only initialize if we haven't set up collapse state yet
      if (Object.keys(collapsedContacts).length === 0) {
        const initialCollapsedState = contacts.reduce((acc, contactName) => {
          acc[contactName] = false; // false means open (expanded)
          return acc;
        }, {} as { [key: string]: boolean });
        setCollapsedContacts(initialCollapsedState);
      }
    }
  }, [financePlan]);

  useEffect(() => {
    const signature = financesNisSignature(financePlan?.payments);

    if (!financePlan?.payments?.length) {
      lastNisSigRef.current = signature;
      setContractTotalNisDisplay({ primary: '—', loading: false });
      setExpenseNoVatNisDisplay({ loading: false });
      setOutstandingNisDisplay({ primary: '—', loading: false });
      setContactTotalNisByName({});
      return;
    }

    // Same payments as last computed (reference changed but values didn't) → keep the existing
    // displays so the summary cards don't flash back to a loading state on re-entry / silent sync.
    if (lastNisSigRef.current === signature) {
      return;
    }
    lastNisSigRef.current = signature;

    const contactNames = [...new Set(financePlan.payments.map((p) => p.client))];
    let cancelled = false;
    setContractTotalNisDisplay((prev) => ({ ...prev, loading: true }));
    setExpenseNoVatNisDisplay((prev) => ({ ...prev, loading: true }));
    setOutstandingNisDisplay((prev) => ({ ...prev, loading: true }));
    setContactTotalNisByName(
      contactNames.reduce(
        (acc, name) => {
          acc[name] = { primary: '…', loading: true };
          return acc;
        },
        {} as Record<string, { primary: string; loading: boolean }>,
      ),
    );

    void (async () => {
      try {
        const unpaidPayments = financePlan.payments.filter((p) => !p.paid);
        const [contractTotals, expenseTotals, outstandingTotals, ...contactResults] = await Promise.all([
          sumPaymentPlanTotalsInNis(financePlan.payments),
          sumExpenseNoVatPlanTotalsInNis(financePlan.payments),
          sumPaymentPlanTotalsInNis(unpaidPayments),
          ...contactNames.map(async (contactName) => {
            const contactPayments = financePlan.payments.filter((p) => p.client === contactName);
            const totals = await sumPaymentPlanTotalsInNis(contactPayments);
            return { contactName, totals };
          }),
        ]);
        if (cancelled) return;
        setContractTotalNisDisplay({
          ...formatContractTotalNisDisplay(contractTotals),
          loading: false,
        });
        setExpenseNoVatNisDisplay({
          primary: formatExpenseNoVatNisDisplay(expenseTotals),
          loading: false,
        });
        setOutstandingNisDisplay({
          ...formatOutstandingNisDisplay(outstandingTotals),
          loading: false,
        });
        setContactTotalNisByName(
          contactResults.reduce(
            (acc, { contactName, totals }) => {
              acc[contactName] = { ...formatOutstandingNisDisplay(totals), loading: false };
              return acc;
            },
            {} as Record<string, { primary: string; loading: boolean }>,
          ),
        );
      } catch (err) {
        console.error('[FinancesTab] NIS summary totals:', err);
        if (!cancelled) {
          setContractTotalNisDisplay({ primary: '—', loading: false });
          setExpenseNoVatNisDisplay({ loading: false });
          setOutstandingNisDisplay({ primary: '—', loading: false });
          setContactTotalNisByName({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [financePlan?.payments]);

  // Proforma drawer state
  const [showProformaDrawer, setShowProformaDrawer] = useState(false);
  const [proformaData, setProformaData] = useState<any>(null);
  const [generatedProformaName, setGeneratedProformaName] = useState<string>('');

  // Contract state
  const [contracts, setContracts] = useState<any[]>([]);
  const [selectedContract, setSelectedContract] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const contactProfileImageUrls = useContactProfileImageUrls(
    contacts.map((c) => c.portal_profile_image_path),
  );

  const resolveContactProfileImageUrl = (contactName: string, contactId?: number | null) => {
    const matched =
      contactId != null
        ? contacts.find((c) => Number(c.id) === Number(contactId))
        : contacts.find((c) => c.name === contactName);
    const path = matched?.portal_profile_image_path;
    return path ? contactProfileImageUrls[path] : undefined;
  };

  // Add state for available currencies (moved earlier to be available for useEffect)
  const [availableCurrencies, setAvailableCurrencies] = useState<Array<{ id: number; name: string; iso_code: string }>>([]);

  // Add state and handler for editing subtotal at the top of the component:
  const [isEditingSubtotal, setIsEditingSubtotal] = useState(false);
  const [editableSubtotal, setEditableSubtotal] = useState('');

  // Helper: map lead currency codes/names to the symbols used in the auto‑plan selector
  const mapLeadCurrencyToSymbol = (code?: string | null): string => {
    if (!code) return '₪';
    const normalized = String(code).trim().toUpperCase();
    if (normalized === '₪' || normalized === 'NIS' || normalized === 'ILS') return '₪';
    if (normalized === '$' || normalized === 'USD') return '$';
    if (normalized === '€' || normalized === 'EUR') return '€';
    if (normalized === '£' || normalized === 'GBP') return '£';
    return '₪';
  };

  // Helper to convert numeric order back to descriptive text (used for both legacy and new leads)
  // Must be defined before fetchPaymentPlans which uses it
  const getOrderText = (orderNumber: number | string | null | undefined): string => {
    // Handle string input (for new leads that might already be text)
    if (typeof orderNumber === 'string') {
      // If it's already a descriptive string, return it as-is
      const lowerStr = orderNumber.toLowerCase();
      if (lowerStr.includes('first') || lowerStr.includes('intermediate') || lowerStr.includes('final') || lowerStr.includes('single') || lowerStr.includes('expense')) {
        return orderNumber;
      }
      // Try to parse as number
      const num = parseInt(orderNumber, 10);
      if (!isNaN(num)) {
        orderNumber = num;
      } else {
        return orderNumber; // Return as-is if can't parse
      }
    }

    // Handle numeric input
    if (typeof orderNumber === 'number') {
      switch (orderNumber) {
        case 1: return 'First Payment';
        case 5: return 'Intermediate Payment';
        case 9: return 'Final Payment';
        case 90: return 'Single Payment';
        case 99: return 'Expense (no VAT)';
        default: return 'First Payment'; // Default fallback
      }
    }

    // Default fallback for null/undefined
    return 'First Payment';
  };

  // Distribute exact percentages to integers that sum to 100.
  // Give remainder to rows with smallest fractional part first so e.g. 9.09% rounds up to 10%.
  const distributePercentagesTo100 = (exactPercents: number[]): number[] => {
    if (exactPercents.length === 0) return [];
    const floors = exactPercents.map((p) => Math.floor(p));
    const sumFloors = floors.reduce((a, b) => a + b, 0);
    let remainder = Math.round(100 - sumFloors);
    const withIndex = exactPercents.map((p, i) => ({ i, frac: p - Math.floor(p) }));
    withIndex.sort((a, b) => a.frac - b.frac); // smallest fractional part first
    const result = [...floors];
    for (let j = 0; j < remainder && j < result.length; j++) result[withIndex[j].i]++;
    return result;
  };

  // Add state for stages dropdown and drawer
  const [showStagesDrawer, setShowStagesDrawer] = useState(false);
  /** Payment history modal — shows all paid payments across every contact for this lead. */
  const [showPaymentHistoryModal, setShowPaymentHistoryModal] = useState(false);
  const [autoPlanData, setAutoPlanData] = useState({
    totalAmount: '',
    currency: '₪',
    numberOfPayments: 3,
    // Per‑payment percentages, must always sum to 100
    paymentPercents: [50, 25, 25],
    // Payment amounts - can be edited freely
    paymentAmounts: [] as number[],
    // Payment orders for each payment
    paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
    includeVat: true,
    contact: '', // Contact name for the auto plan
  });
  const [isCustomPaymentCount, setIsCustomPaymentCount] = useState(false);
  const [customPaymentCount, setCustomPaymentCount] = useState<number>(6);

  // Add state for percentage calculation feature
  const [showPercentageModal, setShowPercentageModal] = useState(false);
  const [percentageType, setPercentageType] = useState<'total' | 'leftToPlan'>('total');
  const [percentageValue, setPercentageValue] = useState<number>(0);

  // Add state for deleted payments view
  const [showDeletedPayments, setShowDeletedPayments] = useState(false);
  const [deletedPayments, setDeletedPayments] = useState<any[]>([]);

  // Add state for legacy proformas
  const [legacyProformas, setLegacyProformas] = useState<any[]>([]);

  // Invoice send automation (schedule email + WhatsApp on due date)
  const [invoiceAutomationSelectMode, setInvoiceAutomationSelectMode] = useState(false);
  const [selectedAutomationPaymentKeys, setSelectedAutomationPaymentKeys] = useState<Set<string>>(new Set());
  const [invoiceAutomationModalOpen, setInvoiceAutomationModalOpen] = useState(false);
  const [savingInvoiceAutomation, setSavingInvoiceAutomation] = useState(false);

  // Manual send invoice (pick rows across all contacts)
  const [sendInvoiceSelectMode, setSendInvoiceSelectMode] = useState(false);
  const [selectedSendInvoicePaymentKeys, setSelectedSendInvoicePaymentKeys] = useState<Set<string>>(new Set());
  const [sendInvoiceModalOpen, setSendInvoiceModalOpen] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState(false);

  // Add state for paid date modal
  const [showPaidDateModal, setShowPaidDateModal] = useState(false);
  const [selectedPaymentForPaid, setSelectedPaymentForPaid] = useState<string | number | null>(null);
  const [paidDate, setPaidDate] = useState<string>('');

  /** Payment plan IDs settled via payment_links (Pelecard / public link), not manual mark-as-paid */
  const [linkPaidPlanIds, setLinkPaidPlanIds] = useState<Set<string | number>>(new Set());
  /** Payper tax invoice-receipt per payment plan (from paid payment_links) */
  const [taxReceiptByPlanId, setTaxReceiptByPlanId] = useState<Map<number, PaymentPlanTaxReceiptInfo>>(
    () => new Map(),
  );
  const [retryingTaxReceiptPlanIds, setRetryingTaxReceiptPlanIds] = useState<Set<number>>(
    () => new Set(),
  );

  const isPaidViaPaymentLink = (p: PaymentPlan) =>
    Boolean(p.paid) && linkPaidPlanIds.has(p.id);

  const showPaymentAdminMenu = (p: PaymentPlan, isPaid?: boolean) =>
    Boolean(isPaid) && (isSuperuser || (isCollection && !isPaidViaPaymentLink(p)));

  const showPaymentEditButton = (p: PaymentPlan, isPaid?: boolean) =>
    !isPaid || isSuperuser || isCollection || isPaidViaPaymentLink(p);

  const showPaymentDeleteButton = (p: PaymentPlan, isPaid?: boolean) =>
    !isPaid || isSuperuser || !isPaidViaPaymentLink(p);

  // Add state for notes modal
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [selectedPaymentForNotes, setSelectedPaymentForNotes] = useState<PaymentPlan | null>(null);
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Handler to open notes modal
  const handleOpenNotesModal = (payment: PaymentPlan) => {
    setSelectedPaymentForNotes(payment);
    setShowNotesModal(true);
  };

  // Handler to save notes
  const handleSaveNotes = async (notes: string) => {
    if (!selectedPaymentForNotes) return;

    setIsSavingNotes(true);
    try {
      const currentUserName = await getCurrentUserName();
      const isLegacyPayment = selectedPaymentForNotes.isLegacy;

      // Log history
      const changes = [];
      if (selectedPaymentForNotes.notes !== notes) {
        changes.push({
          payment_plan_id: selectedPaymentForNotes.id,
          field_name: 'notes',
          old_value: selectedPaymentForNotes.notes || '',
          new_value: notes || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }

      // Save changes to history (only for new payments)
      if (changes.length > 0 && !isLegacyPayment) {
        const changesWithLeadId = changes.map(change => ({
          ...change,
          lead_id: client?.id // Use UUID for new leads
        }));

        const { error: historyError } = await supabase
          .from('payment_plan_changes')
          .insert(changesWithLeadId);

        if (historyError) {
          console.error('Error logging notes change:', historyError);
        }
      }

      // Update payment notes in database
      if (isLegacyPayment) {
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ notes: notes || '' })
          .eq('id', selectedPaymentForNotes.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('payment_plans')
          .update({ notes: notes || '' })
          .eq('id', selectedPaymentForNotes.id);

        if (error) throw error;
      }

      // Update local state
      setFinancePlan((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map((p: PaymentPlan) =>
            p.id === selectedPaymentForNotes.id
              ? { ...p, notes: notes || '' }
              : p
          )
        };
      });

      toast.success('Notes updated successfully!');
      setShowNotesModal(false);
      setSelectedPaymentForNotes(null);
    } catch (error) {
      console.error('Error saving notes:', error);
      toast.error('Failed to save notes');
    } finally {
      setIsSavingNotes(false);
    }
  };


  // Helper function to get currency name from accounting_currencies table (similar to ClientHeader)
  const getCurrencyName = (currencyId: string | number | null | undefined): string => {
    if (!currencyId || currencyId === null || currencyId === undefined) {
      return '₪'; // Default fallback
    }

    // If currencies haven't loaded yet, return default
    if (!availableCurrencies || availableCurrencies.length === 0) {
      return '₪'; // Default fallback until currencies load
    }

    // Convert currencyId to number for comparison (handle bigint)
    const currencyIdNum = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
    if (isNaN(currencyIdNum)) {
      return '₪'; // Default fallback
    }

    // Find currency in loaded currencies - compare as numbers
    const currency = availableCurrencies.find((curr: any) => {
      if (!curr || !curr.id) return false;
      const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
      const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
      return !isNaN(currIdNum) && currIdNum === currencyIdNum;
    });

    if (currency && currency.name && currency.name.trim() !== '') {
      return currency.name.trim();
    }

    // Fallback to default if currency not found
    return '₪';
  };

  // Update autoPlanData currency and contact when client changes
  useEffect(() => {
    if (client) {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      let currency = '₪'; // Default
      let suggestedTotal = 0;

      if (isLegacyLead) {
        // Use the same logic as ClientHeader for legacy leads
        // 1. Currency Resolution - Always try currency_id first, then fallback to proposal_currency/balance_currency, then default to currency_id 1
        let resolvedCurrency = '';

        // Priority 1: Try currency_id (most reliable)
        if ((client as any)?.currency_id) {
          const currencyFromId = getCurrencyName((client as any).currency_id);
          if (currencyFromId && currencyFromId.trim() !== '' && currencyFromId !== '₪') {
            resolvedCurrency = currencyFromId;
          }
        }

        // Priority 2: For legacy leads, also check currency_id from legacy field
        if (!resolvedCurrency && (client as any)?.currency_id) {
          const currencyFromId = getCurrencyName((client as any).currency_id);
          if (currencyFromId && currencyFromId.trim() !== '' && currencyFromId !== '₪') {
            resolvedCurrency = currencyFromId;
          }
        }

        // Priority 3: Fallback to proposal_currency or balance_currency if currency_id didn't work
        if (!resolvedCurrency) {
          resolvedCurrency = client?.proposal_currency ?? client?.balance_currency ?? '';
        }

        // Priority 4: Default to currency_id 1 (use name column from accounting_currencies)
        if (!resolvedCurrency || resolvedCurrency.trim() === '') {
          const defaultCurrency = availableCurrencies.find((curr: any) => {
            if (!curr || !curr.id) return false;
            const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
            const currIdNum = typeof currId === 'string' ? parseInt(currId, 10) : Number(currId);
            return !isNaN(currIdNum) && currIdNum === 1;
          });
          resolvedCurrency = (defaultCurrency && defaultCurrency.name && defaultCurrency.name.trim() !== '')
            ? defaultCurrency.name.trim()
            : '₪'; // Ultimate fallback if currency_id 1 not found
        }

        currency = resolvedCurrency;

        // 2. Base Amount (Gross) - Use same logic as ClientHeader
        const currencyId = (client as any)?.currency_id;
        let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        if (!numericCurrencyId || isNaN(numericCurrencyId)) numericCurrencyId = 1;

        if (numericCurrencyId === 1) {
          suggestedTotal = Number((client as any)?.total_base ?? 0);
        } else {
          suggestedTotal = Number((client as any)?.total ?? 0);
        }
      } else {
        // For new leads, use proposal_currency and balance
        currency = mapLeadCurrencyToSymbol(client?.proposal_currency);
        suggestedTotal = Number(client?.balance || 0);
      }

      setAutoPlanData(prev => {
        const totalAmount = (!prev.totalAmount || Number(prev.totalAmount) <= 0) && suggestedTotal > 0
          ? String(suggestedTotal)
          : prev.totalAmount;

        // Recalculate payment amounts when total amount changes (to match new currency logic)
        const total = Number(totalAmount);
        const prevTotal = Number(prev.totalAmount || 0);
        const totalChanged = Math.abs(total - prevTotal) > 0.01; // Check if total actually changed

        let paymentAmounts = prev.paymentAmounts || [];

        // Recalculate if:
        // 1. Payment amounts are empty, OR
        // 2. Total amount changed (e.g., due to currency_id logic update)
        if ((paymentAmounts.length === 0 || totalChanged) && totalAmount && total > 0) {
          // Ensure paymentPercents array is long enough and matches numberOfPayments
          let percents = [...(prev.paymentPercents || [])];

          // If percents array doesn't match numberOfPayments, recalculate based on count
          if (percents.length !== prev.numberOfPayments) {
            const count = prev.numberOfPayments;
            if (count === 1) {
              percents = [100];
            } else if (count === 3) {
              percents = [50, 25, 25];
            } else {
              // Even split that sums to 100
              const base = Math.floor(100 / count);
              percents = Array.from({ length: count }, () => base);
              const remainder = 100 - base * count;
              for (let i = 0; i < remainder; i++) {
                percents[i] += 1;
              }
            }
          } else {
            // Ensure array is long enough
            while (percents.length < prev.numberOfPayments) {
              const idx = percents.length;
              const count = prev.numberOfPayments;
              let defaultPercent: number;
              if (count === 1) {
                defaultPercent = 100;
              } else if (count === 2) {
                defaultPercent = 50; // For 2 payments, each should be 50%
              } else {
                defaultPercent = idx === 0 ? 50 : idx === count - 1 ? 25 : 25;
              }
              percents.push(defaultPercent);
            }
          }

          // Calculate amounts from percentages based on new total
          paymentAmounts = percents.slice(0, prev.numberOfPayments).map(percent => (total * percent) / 100);
        } else if (paymentAmounts.length === 0 && totalAmount && total > 0) {
          // Fallback: if no amounts but we have total, calculate from percentages
          const percents = prev.paymentPercents || [];
          paymentAmounts = percents.slice(0, prev.numberOfPayments).map(percent => (total * percent) / 100);
        }

        return {
          ...prev,
          currency,
          totalAmount,
          paymentAmounts,
          // Set default contact to main client name if not set
          contact: prev.contact || client?.name || '',
        };
      });
    }
  }, [client, availableCurrencies]);

  const saveSubtotal = () => {
    // Update the first row's total to match the edited subtotal
    if (proformaData && proformaData.rows && proformaData.rows.length > 0) {
      const diff = parseFloat(editableSubtotal) - proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
      const newRows = [...proformaData.rows];
      newRows[0].total = parseFloat(editableSubtotal);
      setProformaData((prev: any) => ({ ...prev, rows: newRows }));
    }
    setIsEditingSubtotal(false);
  };

  // Add paid state for each payment row
  const [paidMap, setPaidMap] = useState<{ [id: string]: boolean }>({});
  const [editingValueVatId, setEditingValueVatId] = useState<string | number | null>(null);
  const [editPaymentIncludeVat, setEditPaymentIncludeVat] = useState<boolean>(true); // Track if VAT should be included for the payment being edited

  // Handler to generate and copy payment link
  const handleGeneratePaymentLink = async (payment: PaymentPlan) => {
    try {
      // Generate secure token
      const secureToken = `payment_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Set expiration date (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Create payment link in database
      const planRowId = Number(payment.id);
      if (!Number.isFinite(planRowId)) {
        toast.error('Invalid payment row id. Refresh and try again.');
        return;
      }

      const { error } = await insertPaymentLinkRecord({
        paymentPlanId: planRowId,
        leadId: client.id,
        leadType: client.lead_type,
        isLegacyPaymentPlan: Boolean(payment.isLegacy),
        planContactId: payment.client_id ?? null,
        secureToken,
        amount: payment.value,
        vatAmount: payment.valueVat,
        totalAmount: payment.value + payment.valueVat,
        currency: payment.currency || '₪',
        description: `${payment.order} - ${client?.name} (#${client?.lead_number})`,
        expiresAt: expiresAt.toISOString(),
      });

      if (error) throw error;

      // Generate the payment URL
      const paymentUrl = `${window.location.origin}/payment/${secureToken}`;

      // Copy to clipboard
      await navigator.clipboard.writeText(paymentUrl);

      toast.success('Payment link copied to clipboard!');
    } catch (error: any) {
      console.error('Error generating payment link:', error);
      const code = error?.code || '';
      if (code === '23503' || code === 'PGRST204') {
        toast.error(
          'Legacy payment links need sql/2026-05-20_payment_links_legacy.sql run in Supabase.',
        );
      } else if (code === '22003') {
        toast.error(
          'Payment row id is too large for payment_links.payment_plan_id — run the BIGINT line in sql/2026-05-20_payment_links_legacy.sql.',
        );
      } else if (code === '42501') {
        toast.error(
          'Permission denied on payment_links. Run sql/2026-05-20_payment_links_rls.sql in Supabase.',
        );
      } else if (code === '22P02') {
        toast.error('Invalid lead id for payment link. Refresh the page and try again.');
      } else {
        toast.error('Failed to generate payment link');
      }
    }
  };

  // Handler to mark a payment as ready to pay
  const handleMarkAsReadyToPay = async (payment: PaymentPlan) => {
    try {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
      const currentUserEmployeeId = await getCurrentUserEmployeeId();
      const currentUserName = await getCurrentUserName();

      let error;
      if (isLegacyLead) {
        // For legacy leads, update finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            ready_to_pay: true,
            ready_to_pay_by: currentUserEmployeeId,
            due_by_id: currentUserEmployeeId,
            date: currentDate,
            due_date: currentDate
          })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new leads, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            ready_to_pay: true,
            ready_to_pay_by: currentUserEmployeeId,
            due_date: currentDate // Set due date to current date
          })
          .eq('id', payment.id);
        error = newError;
      }

      if (error) {
        console.error('Error marking payment as ready to pay:', error);
        toast.error('Failed to mark payment as ready to pay');
        return;
      }

      // Log to finance_changes_history (only for new leads)
      if (!isLegacyLead && client?.id) {
        const { error: historyError } = await supabase
          .from('finance_changes_history')
          .insert({
            lead_id: client.id,
            change_type: 'payment_marked_ready_to_pay',
            table_name: 'payment_plans',
            record_id: payment.id,
            old_values: { ready_to_pay: false },
            new_values: { ready_to_pay: true, ready_to_pay_by: currentUserEmployeeId },
            changed_by: currentUserName,
            notes: `Payment marked as ready to pay by ${currentUserName}`
          });

        if (historyError) console.error('Error logging payment marked as ready to pay:', historyError);
      }

      // Get current user's display name for immediate UI update
      let currentUserDisplayName = currentUserName;
      try {
        if (currentUserEmployeeId) {
          const { data: employeeData } = await supabase
            .from('tenants_employee')
            .select('display_name')
            .eq('id', currentUserEmployeeId)
            .single();
          if (employeeData?.display_name) {
            currentUserDisplayName = employeeData.display_name;
          }
        }
      } catch (err) {
        console.warn('Could not fetch employee display name, using username:', err);
      }

      // Update the local state immediately to reflect the change
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p =>
            p.id === payment.id
              ? {
                ...p,
                ready_to_pay: true,
                dueDate: currentDate,
                ready_to_pay_by: currentUserEmployeeId,
                ready_to_pay_by_display_name: currentUserDisplayName,
              }
              : p
          )
        };
      });

      toast.success('Payment marked as ready to pay! Due date set to today. It will now appear in the collection page.');
      // Notify Clients/ClientHeader banner listeners to refresh nextDuePayment
      if (client?.id) {
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
      // Refresh to ensure data is in sync, but UI is already updated
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error marking payment as ready to pay:', error);
      toast.error('Failed to mark payment as ready to pay');
    }
  };

  // Handler to revert ready to pay
  const handleRevertReadyToPay = async (payment: PaymentPlan) => {
    if (!window.confirm('Are you sure you want to revert this payment from ready to pay?')) return;

    const currentUserName = await getCurrentUserName();
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    // Update local state immediately
    setFinancePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map(p =>
          p.id === payment.id
            ? { ...p, ready_to_pay: false } as PaymentPlan
            : p
        )
      };
    });

    try {
      let error;
      if (isLegacyLead) {
        // For legacy leads, update finances_paymentplanrow table
        // Also clear due_date and due_by_id since they indicate ready_to_pay status
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            ready_to_pay: false,
            ready_to_pay_by: null,
            due_date: null,
            due_by_id: null,
          })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new leads, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            ready_to_pay: false,
            ready_to_pay_by: null,
          })
          .eq('id', payment.id);
        error = newError;
      }

      if (error) {
        console.error('Error reverting ready to pay:', error);
        // Revert the UI state if database update fails
        setFinancePlan(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            payments: prev.payments.map(p =>
              p.id === payment.id
                ? { ...p, ready_to_pay: true } as PaymentPlan
                : p
            )
          };
        });
        toast.error('Failed to revert ready to pay');
        return;
      }

      // Log to finance_changes_history (only for new leads)
      if (!isLegacyLead && client?.id) {
        const { error: historyError } = await supabase
          .from('finance_changes_history')
          .insert({
            lead_id: client.id,
            change_type: 'payment_reverted_from_ready_to_pay',
            table_name: 'payment_plans',
            record_id: payment.id,
            old_values: { ready_to_pay: true },
            new_values: { ready_to_pay: false, ready_to_pay_by: null },
            changed_by: currentUserName,
            notes: `Payment reverted from ready to pay by ${currentUserName}`
          });

        if (historyError) console.error('Error logging payment reverted from ready to pay:', historyError);
      }

      toast.success('Payment reverted from ready to pay');
      // Notify Clients/ClientHeader banner listeners to refresh nextDuePayment
      if (client?.id) {
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error reverting ready to pay:', error);
      // Revert the UI state if there's an error
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p =>
            p.id === payment.id
              ? { ...p, ready_to_pay: true } as PaymentPlan
              : p
          )
        };
      });
      toast.error('Failed to revert ready to pay');
    }
  };

  // Handler to open paid date modal
  const handleOpenPaidDateModal = (id: string | number) => {
    setSelectedPaymentForPaid(id);
    setPaidDate(new Date().toISOString().split('T')[0]); // Set default to today
    setShowPaidDateModal(true);
  };

  // Handler to confirm mark as paid with date
  const handleConfirmMarkAsPaid = async () => {
    if (!selectedPaymentForPaid || !paidDate) {
      toast.error('Please select a date');
      return;
    }

    const id = selectedPaymentForPaid;
    // Find the payment to check if it's legacy
    const payment = financePlan?.payments.find(p => p.id === id);
    const isLegacyPayment = payment?.isLegacy;

    // Immediately update the UI state
    setPaidMap(prev => ({ ...prev, [id]: true }));

    // Update the finance plan state to immediately show paid status
    setFinancePlan(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        payments: prev.payments.map(payment =>
          payment.id === id
            ? { ...payment, paid: true, paid_at: new Date(paidDate).toISOString() }
            : payment
        )
      };
    });

    if (onPaymentMarkedPaid) onPaymentMarkedPaid(id);

    try {
      const currentUserName = await getCurrentUserName();
      const paidAtDate = new Date(paidDate).toISOString();

      if (isLegacyPayment) {
        // For legacy payments, update finances_paymentplanrow table
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            actual_date: paidDate, // Set actual_date to selected date
          })
          .eq('id', id);

        if (!error) {
          toast.success('Legacy payment marked as paid!');
          setShowPaidDateModal(false);
          setSelectedPaymentForPaid(null);
          setPaidDate('');
          await refreshPaymentPlans();
        } else {
          // Revert the UI state if database update fails
          setPaidMap(prev => ({ ...prev, [id]: false }));
          setFinancePlan(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map(payment =>
                payment.id === id
                  ? { ...payment, paid: false, paid_at: undefined }
                  : payment
              )
            };
          });
          toast.error('Failed to mark legacy payment as paid.');
        }
      } else {
        // For regular payments, log the payment marked as paid (only for new payments)
        // Legacy payments don't use this table since lead_id has NOT NULL constraint
        if (!(client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_'))) {
          const { error: historyError } = await supabase
            .from('finance_changes_history')
            .insert({
              lead_id: client?.id, // Use UUID for new leads
              change_type: 'payment_marked_paid',
              table_name: 'payment_plans',
              record_id: id,
              old_values: { paid: false },
              new_values: { paid: true, paid_at: paidAtDate, paid_by: currentUserName },
              changed_by: currentUserName,
              notes: `Payment marked as paid by ${currentUserName} on ${paidDate}`
            });

          if (historyError) console.error('Error logging payment marked as paid:', historyError);
        } else {
          // Legacy payment marked as paid - skipping change logging
        }

        // Check if this is a legacy lead
        const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

        // Update DB based on lead type
        let error = null;
        if (isLegacyLead) {
          // For legacy leads, update finances_paymentplanrow table
          const { error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .update({
              actual_date: paidDate, // Use actual_date for legacy
            })
            .eq('id', id);
          error = legacyError;
        } else {
          // For new leads, update payment_plans table
          const { error: newError } = await supabase
            .from('payment_plans')
            .update({
              paid: true,
              paid_at: paidAtDate,
              paid_by: currentUserName,
            })
            .eq('id', id);
          error = newError;
        }

        if (!error) {
          toast.success('Payment marked as paid!');
          setShowPaidDateModal(false);
          setSelectedPaymentForPaid(null);
          setPaidDate('');
          await refreshPaymentPlans();
          if (typeof window !== 'undefined' && client?.id) {
            window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
          }
        } else {
          // Revert the UI state if database update fails
          setPaidMap(prev => ({ ...prev, [id]: false }));
          setFinancePlan(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              payments: prev.payments.map(payment =>
                payment.id === id
                  ? { ...payment, paid: false, paid_at: undefined }
                  : payment
              )
            };
          });
          toast.error('Failed to mark as paid.');
        }
      }
    } catch (error) {
      console.error('Error marking payment as paid:', error);
      // Revert the UI state if there's an error
      setPaidMap(prev => ({ ...prev, [id]: false }));
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(payment =>
            payment.id === id
              ? { ...payment, paid: false, paid_at: undefined }
              : payment
          )
        };
      });
      toast.error('Failed to mark as paid.');
    }
  };

  // Handler to mark payment as sent to finance
  const handleSentToFinance = async (payment: PaymentPlan) => {
    try {
      const isLegacy = payment.isLegacy;
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

      let error = null;

      if (isLegacy || isLegacyLead) {
        // For legacy payments, update finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ sent_to_finance: true, sent_to_finance_at: new Date().toISOString() })
          .eq('id', payment.id);
        error = legacyError;
      } else {
        // For new payments, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ sent_to_finance: true, sent_to_finance_at: new Date().toISOString() })
          .eq('id', payment.id);
        error = newError;
      }

      if (error) throw error;

      toast.success('Payment marked as sent to finance');

      // Refresh payment plans
      await refreshPaymentPlans();

      // Notify Clients/ClientHeader banner listeners to refresh nextDuePayment
      if (client?.id) {
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }

      // Close dropdown
      setOpenDropdownPaymentId(null);
    } catch (error: any) {
      console.error('Error marking payment as sent to finance:', error);
      toast.error(`Failed to mark as sent to finance: ${error?.message || 'Unknown error'}`);
    }
  };

  // Handler to revert marked as paid
  const handleRevertMarkedAsPaid = async (payment: PaymentPlan) => {
    try {
      const isLegacy = payment.isLegacy;
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const paymentId = payment.id;

      let error = null;

      if (isLegacy || isLegacyLead) {
        // For legacy payments, update finances_paymentplanrow table
        // Set actual_date to null to revert paid status
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            actual_date: null
          })
          .eq('id', paymentId);
        error = legacyError;
      } else {
        // For new payments, update payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            paid: false,
            paid_at: null,
            paid_by: null
          })
          .eq('id', paymentId);
        error = newError;
      }

      if (error) throw error;

      toast.success('Payment reverted from paid status');

      // Update local state
      setPaidMap(prev => {
        const newMap = { ...prev };
        delete newMap[paymentId];
        return newMap;
      });

      // Update finance plan state
      setFinancePlan(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map(p =>
            p.id === paymentId
              ? { ...p, paid: false, paid_at: undefined, paid_by: undefined }
              : p
          )
        };
      });

      // Refresh payment plans
      await refreshPaymentPlans();

      // Close dropdown
      setOpenDropdownPaymentId(null);
    } catch (error: any) {
      console.error('Error reverting payment from paid status:', error);
      toast.error(`Failed to revert payment: ${error?.message || 'Unknown error'}`);
    }
  };

  // Fetch current user's superuser status and collection status
  useEffect(() => {
    const fetchUserPermissions = async () => {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
          setIsSuperuser(false);
          setIsCollection(false);
          return;
        }

        // Try to find user by auth_id first
        let { data: userData, error } = await supabase
          .from('users')
          .select('is_superuser, employee_id')
          .eq('auth_id', user.id)
          .maybeSingle();

        // If not found by auth_id, try by email
        if (!userData && user.email) {
          const { data: userByEmail, error: emailError } = await supabase
            .from('users')
            .select('is_superuser, employee_id')
            .eq('email', user.email)
            .maybeSingle();

          userData = userByEmail;
          error = emailError;
        }

        if (!error && userData) {
          // Check if user is superuser (handle boolean, string, or number)
          const superuserStatus = userData.is_superuser === true ||
            userData.is_superuser === 'true' ||
            userData.is_superuser === 1;
          setIsSuperuser(superuserStatus);

          // Check if user has is_collection = true in tenants_employee table
          if (userData.employee_id) {
            const { data: employeeData, error: employeeError } = await supabase
              .from('tenants_employee')
              .select('is_collection')
              .eq('id', userData.employee_id)
              .maybeSingle();

            if (!employeeError && employeeData) {
              // Check if is_collection is true (handle boolean, string 't', or number)
              const collectionStatus = employeeData.is_collection === true ||
                employeeData.is_collection === 't' ||
                employeeData.is_collection === 'true' ||
                employeeData.is_collection === 1;
              setIsCollection(collectionStatus);
            } else {
              setIsCollection(false);
            }
          } else {
            setIsCollection(false);
          }
        } else {
          setIsSuperuser(false);
          setIsCollection(false);
        }
      } catch (error) {
        console.error('Error fetching user permissions:', error);
        setIsSuperuser(false);
        setIsCollection(false);
      }
    };

    fetchUserPermissions();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.dropdown') && !target.closest('.anchor-dropdown-portal')) {
        setOpenDropdownPaymentId(null);
      }
    };

    if (openDropdownPaymentId !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [openDropdownPaymentId]);

  // Define fetchContacts at component level so it can be called from multiple places
  // Returns the contacts array so it can be used immediately without waiting for state update
  const fetchContacts = async (): Promise<any[]> => {
    if (!client?.id) return [];

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      // For legacy leads, fetch contacts from leads_contact and lead_leadcontact tables
      const legacyId = client.id.toString().replace('legacy_', '');

      try {
        // Fetch contacts from lead_leadcontact and leads_contact tables
        const { data: leadContacts, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select(`
            id,
            main,
            contact_id,
            lead_id,
            leads_contact!inner(
              id,
              name,
              email,
              phone,
              mobile,
              portal_profile_image_path
            )
          `)
          .eq('lead_id', legacyId);

        if (leadContactsError) {
          console.error('Error fetching legacy lead contacts:', leadContactsError);
          setContacts([]);
          return [];
        }

        if (leadContacts && leadContacts.length > 0) {
          // Transform contacts to include the contact data
          const contactsWithData = leadContacts.map((leadContact: any) => {
            const contactData = Array.isArray(leadContact.leads_contact)
              ? leadContact.leads_contact[0]
              : leadContact.leads_contact;

            return {
              id: contactData?.id || leadContact.contact_id,
              name: contactData?.name || '',
              email: contactData?.email || '',
              phone: contactData?.phone || '',
              mobile: contactData?.mobile || '',
              portal_profile_image_path: contactData?.portal_profile_image_path ?? null,
              isMain: leadContact.main === 'true' || leadContact.main === true,
            };
          });

          setContacts(contactsWithData);
          console.log('✅ fetchContacts: Loaded contacts', contactsWithData.map(c => ({ id: c.id, name: c.name })));
          return contactsWithData;
        } else {
          setContacts([]);
          return [];
        }
      } catch (error) {
        console.error('Error fetching legacy contacts:', error);
        setContacts([]);
        return [];
      }
    }

    // For new leads, fetch contacts from lead_leadcontact and leads_contact tables using newlead_id
    try {
      console.log('🔍 fetchContacts: Fetching contacts for new lead with leadId:', client.id);

      const { data: leadContacts, error: leadContactsError } = await supabase
        .from('lead_leadcontact')
        .select(`
          id,
          main,
          contact_id,
          newlead_id,
          leads_contact!inner(
            id,
            name,
            email,
            phone,
            mobile,
            portal_profile_image_path
          )
        `)
        .eq('newlead_id', client.id);

      console.log('🔍 leadContacts query result:', { leadContacts, leadContactsError, leadId: client.id });

      if (leadContactsError) {
        console.error('Error fetching new lead contacts:', leadContactsError);
        setContacts([]);
        return [];
      }

      if (leadContacts && leadContacts.length > 0) {
        // Transform contacts to include the contact data
        const contactsWithData = leadContacts.map((leadContact: any) => {
          const contactData = Array.isArray(leadContact.leads_contact)
            ? leadContact.leads_contact[0]
            : leadContact.leads_contact;

          return {
            id: contactData?.id || leadContact.contact_id,
            name: contactData?.name || '',
            email: contactData?.email || '',
            phone: contactData?.phone || '',
            mobile: contactData?.mobile || '',
            portal_profile_image_path: contactData?.portal_profile_image_path ?? null,
            isMain: leadContact.main === 'true' || leadContact.main === true,
          };
        });

        console.log('✅ Processed contacts:', contactsWithData);
        console.log('✅ Setting contacts state with', contactsWithData.length, 'contacts');
        setContacts(contactsWithData);
        return contactsWithData;
      } else {
        console.warn('⚠️ No contacts found for new lead, leadId:', client.id);
        setContacts([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching new lead contacts:', error);
      setContacts([]);
      return [];
    }
  };

  // Use a ref to track if we're currently fetching to prevent infinite loops
  const isFetchingRef = React.useRef(false);
  const contactsLoadedRef = React.useRef<string | null>(null);
  const cacheRestoredRef = React.useRef(false);
  const restoredContactsRef = React.useRef<any[] | null>(null);

  // Fetch payment plans when component mounts or client changes
  useEffect(() => {
    cacheRestoredRef.current = false;
    restoredContactsRef.current = null;
    if (!client?.id) {
      setIsLoadingFinancePlan(false);
      return;
    }

    const clientIdKey = client.id.toString();
    const cached = restoreFinancesTabCache(clientIdKey);
    if (cached) {
      setFinancePlan(cached.financePlan);
      setContacts(cached.contacts);
      setContracts(cached.contracts);
      setAvailableCurrencies(cached.availableCurrencies);
      setViewMode(cached.viewMode);
      setCollapsedContacts(cached.collapsedContacts);
      setPaidMap(cached.paidMap || {});
      // Restore the NIS conversions too (instant render) and mark this payment set as already
      // computed so the NIS effect doesn't flash them back to a loading state on mount. Only seed
      // the signature when the cached values were settled (not mid-load), otherwise let it recompute.
      if (cached.nisDisplays && !cached.nisDisplays.contractTotalNisDisplay?.loading) {
        setContractTotalNisDisplay(cached.nisDisplays.contractTotalNisDisplay);
        setExpenseNoVatNisDisplay(cached.nisDisplays.expenseNoVatNisDisplay ?? { loading: false });
        setOutstandingNisDisplay(cached.nisDisplays.outstandingNisDisplay);
        setContactTotalNisByName(cached.nisDisplays.contactTotalNisByName || {});
        lastNisSigRef.current = financesNisSignature(cached.financePlan?.payments);
      }
      setIsLoadingFinancePlan(false);
      cacheRestoredRef.current = true;
      if (cached.contacts.length > 0) {
        contactsLoadedRef.current = clientIdKey;
        restoredContactsRef.current = cached.contacts;
      }
    }

    const loadPaymentLinkMeta = async (
      leadId: string | number,
      leadType: string | null | undefined,
      paymentPlanIds?: Array<number | string>,
    ) => {
      try {
        const [paidIds, taxReceipts] = await Promise.all([
          loadPaidPaymentLinkPlanIds({
            leadId,
            leadType,
            paymentPlanIds,
          }),
          loadPaymentPlanTaxReceipts({
            leadId,
            leadType,
            paymentPlanIds,
          }),
        ]);
        setLinkPaidPlanIds(paidIds);
        setTaxReceiptByPlanId(taxReceipts);
      } catch (err) {
        console.error('Error loading payment link metadata:', err);
        setLinkPaidPlanIds(new Set());
        setTaxReceiptByPlanId(new Map());
      }
    };

    const loadLinkPaidPlanIds = async (
      clientId: string | number,
      paymentPlanIds?: Array<number | string>,
    ) => {
      await loadPaymentLinkMeta(clientId, client.lead_type, paymentPlanIds);
    };

    const fetchPaymentPlans = async () => {
      if (!client?.id) {
        setIsLoadingFinancePlan(false);
        return;
      }

      await loadLinkPaidPlanIds(client.id);

      // Prevent duplicate fetches
      if (isFetchingRef.current) {
        return;
      }

      // Use restored contacts from cache if available to avoid double fetch
      const contactsAlreadyLoaded = contactsLoadedRef.current === clientIdKey && (contacts.length > 0 || (restoredContactsRef.current && restoredContactsRef.current.length > 0));

      isFetchingRef.current = true;
      if (!cacheRestoredRef.current) setIsLoadingFinancePlan(true);

      // CRITICAL: Ensure contacts are loaded BEFORE fetching payment plans
      let currentContacts = contacts;
      if (restoredContactsRef.current && restoredContactsRef.current.length > 0) {
        currentContacts = restoredContactsRef.current;
        restoredContactsRef.current = null;
      } else if (!contactsAlreadyLoaded) {
        currentContacts = await fetchContacts();
        contactsLoadedRef.current = clientIdKey;
      }

      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      try {
        let data = null;
        let error = null;

        if (isLegacyLead) {
          // For legacy leads, fetch from finances_paymentplanrow table
          const legacyIdStr = client.id.toString().replace('legacy_', '');
          const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;

          if (!legacyId || isNaN(legacyId)) {
            console.error('Invalid legacy lead ID:', client.id);
            setIsLoadingFinancePlan(false);
            isFetchingRef.current = false;
            return;
          }

          // For legacy leads, fetch payments by lead_id
          // Contacts are now guaranteed to be loaded before this function runs (via await fetchContacts())
          const contactIds = currentContacts.length > 0 ? currentContacts.map(c => c.id).filter(id => id != null && !isNaN(Number(id))).map(id => Number(id)) : [];

          console.log('🔍 fetchPaymentPlans (legacy): Starting fetch', {
            legacyId,
            clientId: client.id,
            contactsCount: currentContacts.length,
            contactIds,
            contactNames: currentContacts.map(c => ({ id: c.id, name: c.name }))
          });

          // Build query to fetch payments for this specific lead
          // CRITICAL: FIRST match by lead_id to id in leads_lead
          // THEN match by client_id to contact_id (done in filter below)
          let { data: legacyData, error: legacyError } = await supabase
            .from('finances_paymentplanrow')
            .select(`
              *,
              accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                name,
                iso_code
              ),
              tenants_employee:ready_to_pay_by (
                id,
                display_name
              )
            `)
            .eq('lead_id', legacyId) // Use numeric lead_id to ensure correct matching for this specific lead
            .is('cancel_date', null)
            .order('date', { ascending: true });

          // No fallback by client_id - we must match by lead_id only
          // Multiple leads can share the same contact, so matching by client_id would include payments from other leads

          console.log('🔍 fetchPaymentPlans (legacy): Query result', {
            legacyId,
            dataCount: legacyData?.length || 0,
            error: legacyError,
            rawPayments: legacyData?.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id, date: p.date })) || []
          });

          // DIAGNOSTIC: Check if there are ANY payment plans for this lead_id (including canceled ones)
          // This helps diagnose why no payments are being returned
          if ((!legacyData || legacyData.length === 0) && !legacyError) {
            const { data: diagnosticData } = await supabase
              .from('finances_paymentplanrow')
              .select('id, lead_id, client_id, cancel_date, date')
              .eq('lead_id', legacyId)
              .order('date', { ascending: true })
              .limit(10);

            console.log('🔍 DIAGNOSTIC: All payment plans for lead_id (including canceled):', {
              legacyId,
              contactIds,
              diagnosticCount: diagnosticData?.length || 0,
              diagnosticPayments: diagnosticData?.map((p: any) => ({
                id: p.id,
                lead_id: p.lead_id,
                client_id: p.client_id,
                cancel_date: p.cancel_date,
                date: p.date,
                clientIdMatches: p.client_id ? contactIds.includes(Number(p.client_id)) : 'null'
              })) || []
            });

            // DIAGNOSTIC: Check if payment plans exist with client_id matching contact_id but different/missing lead_id
            // This helps identify if payment plans are stored with wrong lead_id
            if (contactIds.length > 0) {
              const { data: diagnosticByClientId } = await supabase
                .from('finances_paymentplanrow')
                .select('id, lead_id, client_id, cancel_date, date')
                .in('client_id', contactIds)
                .order('date', { ascending: true })
                .limit(20);

              console.log('🔍 DIAGNOSTIC: Payment plans by client_id (contact_id):', {
                legacyId,
                contactIds,
                diagnosticByClientIdCount: diagnosticByClientId?.length || 0,
                diagnosticByClientIdPayments: diagnosticByClientId?.map((p: any) => ({
                  id: p.id,
                  lead_id: p.lead_id,
                  client_id: p.client_id,
                  cancel_date: p.cancel_date,
                  date: p.date,
                  leadIdMatches: p.lead_id ? Number(p.lead_id) === legacyId : 'null',
                  shouldHaveLeadId: legacyId
                })) || []
              });
            }
          }

          // CRITICAL: Only filter by lead_id - don't filter by client_id
          // Multiple leads can share the same contact (client_id), so we must match by lead_id first
          // Grouping by client_id is done later for display purposes only
          if (legacyData && !legacyError) {
            console.log('🔍 fetchPaymentPlans (legacy): Filtering payments by lead_id only', {
              legacyId,
              totalPayments: legacyData.length,
              payments: legacyData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });

            legacyData = legacyData.filter((plan: any) => {
              const planLeadId = plan.lead_id ? Number(plan.lead_id) : null;

              // Match by lead_id only - don't filter by client_id
              if (planLeadId !== legacyId) {
                console.warn('⚠️ Payment plan has incorrect lead_id:', { planLeadId, expectedLeadId: legacyId, planId: plan.id });
                return false;
              }

              console.log('✅ Including payment for lead (matched by lead_id):', {
                planId: plan.id,
                planLeadId,
                planClientId: plan.client_id,
                legacyId
              });

              return true;
            });

            console.log('✅ fetchPaymentPlans (legacy): Filtered payments (matched by lead_id only)', {
              legacyId,
              filteredCount: legacyData.length,
              filteredPayments: legacyData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
          }

          data = legacyData;
          error = legacyError;
        } else {
          // For regular leads, fetch from payment_plans table
          // Filter out canceled payments (cancel_date is null for active payments)
          // Match by BOTH lead_id AND client_id (contact_id) to ensure subleads with same contact don't show each other's plans
          const contactIds = currentContacts.length > 0 ? currentContacts.map(c => c.id).filter(id => id != null && !isNaN(Number(id))).map(id => Number(id)) : [];

          // Build query to fetch payments for this specific lead/sublead
          // CRITICAL: We must filter by BOTH lead_id AND client_id to prevent showing payments from other leads
          // First, fetch by lead_id to get all payments for this specific lead
          let { data: regularData, error: regularError } = await supabase
            .from('payment_plans')
            .select(`
              *,
              tenants_employee:ready_to_pay_by (
                id,
                display_name
              )
            `)
            .eq('lead_id', client.id) // Use the specific lead_id for this lead/sublead
            .is('cancel_date', null)
            .order('date', { ascending: true });

          // CRITICAL: Only filter by lead_id - don't filter by client_id
          // Multiple leads can share the same contact (client_id), so we must match by lead_id first
          // Grouping by client_id is done later for display purposes only
          if (regularData && !regularError) {
            console.log('🔍 fetchPaymentPlans (new): Filtering payments by lead_id only', {
              leadId: client.id,
              totalPayments: regularData.length,
              payments: regularData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });

            regularData = regularData.filter((plan: any) => {
              const planLeadId = plan.lead_id ? String(plan.lead_id) : null;

              // Match by lead_id only - don't filter by client_id
              if (planLeadId !== String(client.id)) {
                console.warn('⚠️ Payment plan has incorrect lead_id:', { planLeadId, expectedLeadId: client.id, planId: plan.id });
                return false;
              }

              console.log('✅ Including payment for lead (matched by lead_id):', {
                planId: plan.id,
                planLeadId,
                planClientId: plan.client_id,
                leadId: client.id
              });

              return true;
            });

            console.log('✅ fetchPaymentPlans (new): Filtered payments (matched by lead_id only)', {
              leadId: client.id,
              filteredCount: regularData.length,
              filteredPayments: regularData.map((p: any) => ({ id: p.id, lead_id: p.lead_id, client_id: p.client_id }))
            });
          }

          data = regularData;
          error = regularError;
        }

        if (error) {
          console.error('Error fetching payment plans:', error);
          return;
        }

        if (data && data.length > 0) {
          let total = 0;
          let vat = 0;
          let payments = [];

          if (isLegacyLead) {
            // Fetch employee display names for due_by_id values
            const dueByIds = new Set<number>();
            data.forEach((plan: any) => {
              if (plan.due_by_id) {
                dueByIds.add(plan.due_by_id);
              }
            });

            const dueByEmployeeMap = new Map<number, string>();
            if (dueByIds.size > 0) {
              const { data: employeesData } = await supabase
                .from('tenants_employee')
                .select('id, display_name')
                .in('id', Array.from(dueByIds));

              if (employeesData) {
                employeesData.forEach((emp: any) => {
                  if (emp.id && emp.display_name) {
                    dueByEmployeeMap.set(emp.id, emp.display_name);
                  }
                });
              }
            }

            // Transform legacy data to match the finance plan structure
            // First, process all payments to calculate totals and get currency info
            const processedPayments = data.map(plan => {
              const value = Number(plan.value || 0);

              // Get currency from the joined accounting_currencies table
              let currency = '₪'; // Default fallback
              let currencyId = plan.currency_id;

              if (plan.accounting_currencies && plan.accounting_currencies.name) {
                currency = displaySymbolFromAccountingRow(plan.accounting_currencies);
                currencyId = plan.accounting_currencies.id;
              } else if (plan.currency_id) {
                // If we have currency_id but no joined data, use a simple mapping
                switch (plan.currency_id) {
                  case 1: currency = '₪'; break; // NIS
                  case 2: currency = '€'; break; // EUR
                  case 3: currency = '$'; break; // USD
                  case 4: currency = '£'; break; // GBP
                  default: currency = '₪'; break;
                }
              }

              const valueVat = readPaymentPlanVatFromRow(
                {
                  value: plan.value,
                  vat_value: plan.vat_value,
                  currency,
                  currency_id: currencyId,
                  date: plan.date,
                  due_date: plan.due_date,
                  order: plan.order,
                },
                true,
              );

              const paymentTotal = value + valueVat;

              return {
                plan,
                value,
                valueVat,
                currency,
                currencyId,
                paymentTotal
              };
            });

            // Calculate totals using the same VAT logic
            let total = 0;
            let vat = 0;
            processedPayments.forEach(processed => {
              total += processed.paymentTotal;
              vat += processed.valueVat;
            });

            // Group payments by contact to calculate percentages per contact
            const paymentsByContact = new Map<string, typeof processedPayments>();
            processedPayments.forEach(processed => {
              const contactName = getContactNameFromClientId(processed.plan.client_id, currentContacts);
              if (!paymentsByContact.has(contactName)) {
                paymentsByContact.set(contactName, []);
              }
              paymentsByContact.get(contactName)!.push(processed);
            });

            // Per contact: distribute percentages so they sum to 100% (largest-remainder)
            const contactPercentsMap = new Map<string, Map<number, number>>();
            paymentsByContact.forEach((contactPayments, contactName) => {
              const contactTotal = contactPayments.reduce((sum, p) => {
                const orderText = p.plan.order ? getOrderText(p.plan.order) : 'First Payment';
                if (isExpenseNoVatPayment(p.plan.order) || isExpenseNoVatPayment(orderText)) return sum;
                return sum + p.value;
              }, 0);
              const eligible = contactPayments.filter((p) => {
                const orderText = p.plan.order ? getOrderText(p.plan.order) : 'First Payment';
                return !isExpenseNoVatPayment(p.plan.order) && !isExpenseNoVatPayment(orderText);
              });
              const exactPercents = contactTotal > 0 ? eligible.map((p) => (p.value / contactTotal) * 100) : [];
              const rounded = distributePercentagesTo100(exactPercents);
              const byPlanId = new Map<number, number>();
              eligible.forEach((p, i) => byPlanId.set(p.plan.id, rounded[i] ?? 0));
              contactPercentsMap.set(contactName, byPlanId);
            });

            // Calculate total per contact and then calculate percentages
            payments = processedPayments.map(processed => {
              const { plan, value, valueVat, currency, currencyId, paymentTotal } = processed;

              // Get contact name from client_id
              const contactName = getContactNameFromClientId(plan.client_id, currentContacts);

              const orderText = plan.order ? getOrderText(plan.order) : 'First Payment';
              const calculatedDuePercent = isExpenseNoVatPayment(plan.order) || isExpenseNoVatPayment(orderText)
                ? ''
                : (contactPercentsMap.get(contactName)?.get(plan.id) ?? 0).toString() + '%';

              // Debug: Log employee data if available
              if (plan.ready_to_pay && plan.ready_to_pay_by) {
                console.log('🔍 Payment ready_to_pay debug:', {
                  paymentId: plan.id,
                  ready_to_pay_by: plan.ready_to_pay_by,
                  tenants_employee: plan.tenants_employee,
                  display_name: plan.tenants_employee?.display_name
                });
              }

              // For legacy leads: if due_date is set (even without due_by_id), treat as ready_to_pay
              // This is because legacy leads use due_date and due_by_id instead of ready_to_pay flag
              // IMPORTANT: Show X button (revert) if due_date exists, even if due_by_id is missing
              const hasDueDate = !!plan.due_date;
              const hasDueDateAndDueBy = plan.due_date && plan.due_by_id;
              const isReadyToPay = plan.ready_to_pay || hasDueDate; // Changed: use hasDueDate instead of hasDueDateAndDueBy
              // For legacy leads, prioritize due_by_id over ready_to_pay_by
              const readyToPayBy = hasDueDateAndDueBy ? plan.due_by_id : (plan.ready_to_pay_by || null);
              // For legacy leads, get employee name from due_by_id using the map we fetched
              // If due_by_id is missing, we won't have a display name, but button should still show
              const readyToPayByDisplayName = hasDueDateAndDueBy
                ? (dueByEmployeeMap.get(plan.due_by_id) || null)
                : (plan.tenants_employee?.display_name || null);

              return {
                id: plan.id,
                duePercent: calculatedDuePercent,
                dueDate: plan.date || plan.due_date,
                value,
                valueVat,
                client: contactName, // Use contact name from client_id mapping
                order: plan.order ? getOrderText(plan.order) : 'First Payment',
                proforma: null, // Legacy doesn't have proforma
                notes: plan.notes || '',
                paid: plan.actual_date ? true : false, // If actual_date is set, consider it paid
                paid_at: plan.actual_date,
                paid_by: undefined, // Legacy doesn't track who paid
                currency,
                currency_id: currencyId ?? plan.currency_id ?? null,
                isLegacy: true, // Flag to identify legacy payments
                ready_to_pay: isReadyToPay,
                ready_to_pay_text: (plan as any).ready_to_pay_text || null,
                ready_to_pay_date: (plan as any).ready_to_pay_date || null,
                ready_to_pay_by: readyToPayBy,
                ready_to_pay_by_display_name: readyToPayByDisplayName,
                client_id: plan.client_id ? Number(plan.client_id) : null, // Include client_id (contact_id) for proforma creation
                sent_to_finance: plan.sent_to_finance || false, // Include sent_to_finance flag
                sent_to_finance_at: plan.sent_to_finance_at || null, // Include sent_to_finance_at timestamp
                original_due_date: plan.due_date || null, // Store original due_date for legacy leads to check if it exists
                invoice_send_automation_active: plan.invoice_send_automation_active || false,
                invoice_send_automation_language: plan.invoice_send_automation_language || null,
                invoice_send_automation_at: plan.invoice_send_automation_at || null,
                invoice_send_automation_sent_at: plan.invoice_send_automation_sent_at || null,
              };
            });
          } else {
            // Transform regular data to match the finance plan structure
            // First, process all payments - use vat_value directly from database (no auto-calculation)
            const processedPayments = data.map(plan => {
              const value = Number(plan.value);
              const valueVat = readPaymentPlanVatFromRow(plan, false);
              const currency = mapPaymentCurrencyToSymbol(plan.currency || '₪');

              const paymentTotal = value + valueVat;

              return {
                plan,
                value,
                valueVat,
                currency,
                paymentTotal
              };
            });

            // Calculate totals using the same VAT logic
            total = processedPayments.reduce((sum, processed) => sum + processed.paymentTotal, 0);
            vat = processedPayments.reduce((sum, processed) => sum + processed.valueVat, 0);

            // Group payments by contact to calculate percentages per contact
            const paymentsByContact = new Map<string, typeof processedPayments>();
            processedPayments.forEach(processed => {
              const contactName = processed.plan.client_name || 'Unknown Contact';
              if (!paymentsByContact.has(contactName)) {
                paymentsByContact.set(contactName, []);
              }
              paymentsByContact.get(contactName)!.push(processed);
            });

            // Per contact: distribute percentages so they sum to 100% (largest-remainder)
            const contactPercentsMap = new Map<string, Map<number, number>>();
            paymentsByContact.forEach((contactPayments, contactName) => {
              const contactTotal = contactPayments.reduce((sum, p) => {
                const orderText = typeof p.plan.payment_order === 'number' ? getOrderText(p.plan.payment_order) : (p.plan.payment_order || 'First Payment');
                if (isExpenseNoVatPayment(p.plan.payment_order) || isExpenseNoVatPayment(orderText)) return sum;
                return sum + p.value;
              }, 0);
              const eligible = contactPayments.filter((p) => {
                const orderText = typeof p.plan.payment_order === 'number' ? getOrderText(p.plan.payment_order) : (p.plan.payment_order || 'First Payment');
                return !isExpenseNoVatPayment(p.plan.payment_order) && !isExpenseNoVatPayment(orderText);
              });
              const exactPercents = contactTotal > 0 ? eligible.map((p) => (p.value / contactTotal) * 100) : [];
              const rounded = distributePercentagesTo100(exactPercents);
              const byPlanId = new Map<number, number>();
              eligible.forEach((p, i) => byPlanId.set(p.plan.id, rounded[i] ?? 0));
              contactPercentsMap.set(contactName, byPlanId);
            });

            // Calculate total per contact and then calculate percentages
            payments = processedPayments.map(processed => {
              const { plan, value, valueVat, currency, paymentTotal } = processed;

              const contactName = plan.client_name || 'Unknown Contact';
              const orderText = typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment');
              const duePercentStr = isExpenseNoVatPayment(plan.payment_order) || isExpenseNoVatPayment(orderText)
                ? ''
                : (contactPercentsMap.get(contactName)?.get(plan.id) ?? 0).toString() + '%';

              return {
                id: plan.id,
                duePercent: duePercentStr,
                dueDate: plan.due_date,
                value,
                valueVat,
                client: contactName,
                order: typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment'),
                proforma: plan.proforma || null,
                notes: plan.notes || '',
                paid: plan.paid || false,
                paid_at: plan.paid_at || null,
                paid_by: plan.paid_by || null,
                currency,
                currency_id: plan.currency_id ?? currencyIdFromSymbol(currency) ?? null,
                isLegacy: false,
                ready_to_pay: plan.ready_to_pay || false, // Include ready_to_pay field
                ready_to_pay_text: (plan as any).ready_to_pay_text || null,
                ready_to_pay_date: (plan as any).ready_to_pay_date || null,
                ready_to_pay_by: plan.ready_to_pay_by || null,
                ready_to_pay_by_display_name: plan.tenants_employee?.display_name || null,
                client_id: plan.client_id ? Number(plan.client_id) : null,
                sent_to_finance: plan.sent_to_finance || false, // Include sent_to_finance flag
                sent_to_finance_at: plan.sent_to_finance_at || null, // Include sent_to_finance_at timestamp
                invoice_send_automation_active: plan.invoice_send_automation_active || false,
                invoice_send_automation_language: plan.invoice_send_automation_language || null,
                invoice_send_automation_at: plan.invoice_send_automation_at || null,
                invoice_send_automation_sent_at: plan.invoice_send_automation_sent_at || null,
              };
            });
          }

          // Update paidMap to reflect the paid status from database
          const newPaidMap: { [id: string]: boolean } = {};
          payments.forEach(payment => {
            newPaidMap[payment.id.toString()] = payment.paid || false;
          });
          setPaidMap(newPaidMap);

          setFinancePlan({
            total: Math.round(total * 100) / 100,
            vat: Math.round(vat * 100) / 100,
            payments: payments,
          });
          void loadLinkPaidPlanIds(client.id, payments.map((p) => p.id));
        } else {
          setFinancePlan(null);
          setPaidMap({});
        }
      } catch (error) {
        console.error('Error fetching payment plans:', error);
        setFinancePlan(null);
        setPaidMap({});
      } finally {
        cacheRestoredRef.current = false;
        setIsLoadingFinancePlan(false);
        isFetchingRef.current = false;
      }
    };

    fetchPaymentPlans();
  }, [client?.id]);

  // Persist state so switching tabs doesn't reload; skip while still loading to avoid overwriting with empty
  useEffect(() => {
    if (!client?.id || isLoadingFinancePlan) return;
    persistFinancesTabCache(client.id, {
      financePlan,
      contacts,
      contracts,
      availableCurrencies,
      viewMode,
      collapsedContacts,
      paidMap,
      nisDisplays: {
        contractTotalNisDisplay,
        expenseNoVatNisDisplay,
        outstandingNisDisplay,
        contactTotalNisByName,
      },
    });
  }, [client?.id, isLoadingFinancePlan, financePlan, contacts, contracts, availableCurrencies, viewMode, collapsedContacts, paidMap, contractTotalNisDisplay, expenseNoVatNisDisplay, outstandingNisDisplay, contactTotalNisByName]);

  const fetchContracts = async () => {
    if (!client?.id || typeof client.id !== 'string' || client.id.length === 0) return;

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    if (isLegacyLead) {
      // For legacy leads, fetch contract information from lead_leadcontact table
      try {
        const legacyId = client.id.toString().replace('legacy_', '');

        // Fetch legacy contract data with lead information
        const { data: legacyContracts, error } = await supabase
          .from('lead_leadcontact')
          .select(`
            id,
            contract_html,
            signed_contract_html,
            public_token,
            main,
            contact_id,
            lead_id,
            leads_lead!inner(
              total,
              no_of_applicants
            )
          `)
          .eq('lead_id', legacyId);

        if (error) {
          console.error('Error fetching legacy contracts:', error);
          setContracts([]);
          return;
        }

        if (legacyContracts && legacyContracts.length > 0) {
          // Fetch signed date from stage 60 (agreement signed) for this lead
          const { data: signedStageData, error: stageError } = await supabase
            .from('leads_leadstage')
            .select('cdate')
            .eq('lead_id', legacyId)
            .eq('stage', 60)
            .order('cdate', { ascending: false })
            .limit(1)
            .single();

          const signedDate = signedStageData?.cdate || null;

          // Transform legacy contract data to match the expected format
          const transformedContracts = legacyContracts.map((contract, index) => {
            // Use database fields instead of parsing HTML
            const leadData = Array.isArray(contract.leads_lead) ? contract.leads_lead[0] : contract.leads_lead;
            const totalAmount = leadData?.total || 0;
            const applicantCount = leadData?.no_of_applicants || 1;
            const costPerApplicant = applicantCount > 0 ? totalAmount / applicantCount : 0;

            return {
              id: contract.id,
              status: contract.signed_contract_html ? 'signed' : 'draft',
              contract_html: contract.contract_html,
              signed_contract_html: contract.signed_contract_html,
              public_token: contract.public_token,
              contact_id: contract.contact_id,
              lead_id: contract.lead_id,
              main: contract.main,
              // Add legacy-specific fields
              contract_templates: {
                name: 'Contract'
              },
              applicant_count: applicantCount,
              total_amount: totalAmount,
              cost_per_applicant: costPerApplicant,
              signed_at: signedDate, // Use the signed date from stage 60
              client_country: 'IL', // Default for legacy
              contact_name: client.name || 'Legacy Client',
              isLegacy: true
            };
          });

          setContracts(transformedContracts);
        } else {
          setContracts([]);
        }
      } catch (error) {
        console.error('Error fetching legacy contracts:', error);
        setContracts([]);
      }
      return;
    }

    try {
      const contractData = await getClientContracts(client.id);
      setContracts(contractData || []);
    } catch (error) {
      console.error('Error fetching contracts:', error);
    }
  };

  // Separate useEffect for loading contacts, contracts, and currencies
  useEffect(() => {
    // Add event listener for payment marked as paid
    const handlePaymentMarkedPaid = (event: CustomEvent) => {
      // Refresh payment plans to reflect the updated paid status
      refreshPaymentPlans();
    };

    // Add the event listener
    window.addEventListener('paymentMarkedPaid', handlePaymentMarkedPaid as EventListener);

    // Fetch contacts first, then fetch payment plans (which needs contacts to be loaded)
    // Note: fetchPaymentPlans now ensures contacts are loaded internally via await fetchContacts()
    const loadData = async () => {
      await fetchContacts();
      // fetchPaymentPlans will be called by its own useEffect, and it will await fetchContacts() again
      // This ensures contacts are always loaded before payment plans
      fetchContracts();

      // Fetch available currencies
      try {
        const { data, error } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('id', { ascending: true });

        if (error) {
          console.error('Error fetching currencies:', error);
          // Set fallback currencies
          setAvailableCurrencies([
            { id: 1, name: '₪', iso_code: 'ILS' },
            { id: 2, name: '€', iso_code: 'EUR' },
            { id: 3, name: '$', iso_code: 'USD' },
            { id: 4, name: '£', iso_code: 'GBP' },
          ]);
        } else if (data && data.length > 0) {
          setAvailableCurrencies(data);
        } else {
          // Set fallback currencies if no data
          setAvailableCurrencies([
            { id: 1, name: '₪', iso_code: 'ILS' },
            { id: 2, name: '€', iso_code: 'EUR' },
            { id: 3, name: '$', iso_code: 'USD' },
            { id: 4, name: '£', iso_code: 'GBP' },
          ]);
        }
      } catch (error) {
        console.error('Error fetching currencies:', error);
        // Set fallback currencies
        setAvailableCurrencies([
          { id: 1, name: '₪', iso_code: 'ILS' },
          { id: 2, name: '€', iso_code: 'EUR' },
          { id: 3, name: '$', iso_code: 'USD' },
          { id: 4, name: '£', iso_code: 'GBP' },
        ]);
      }
    };
    loadData();

    // Cleanup function to remove event listener
    return () => {
      window.removeEventListener('paymentMarkedPaid', handlePaymentMarkedPaid as EventListener);
    };
  }, [client?.id]);

  // Fetch legacy proformas when client changes
  useEffect(() => {
    if (client) {
      fetchLegacyProformas();
    }
  }, [client]);

  const refreshPaymentPlans = async () => {
    if (!client?.id) return;

    try {
      const planIds = (financePlan?.payments || []).map((p) => p.id);
      await Promise.all([
        loadPaidPaymentLinkPlanIds({
          leadId: client.id,
          leadType: client.lead_type,
          paymentPlanIds: planIds,
        }).then(setLinkPaidPlanIds),
        loadPaymentPlanTaxReceipts({
          leadId: client.id,
          leadType: client.lead_type,
          paymentPlanIds: planIds,
        }).then(setTaxReceiptByPlanId),
      ]);
    } catch (err) {
      console.error('Error loading paid payment links:', err);
      setLinkPaidPlanIds(new Set());
      setTaxReceiptByPlanId(new Map());
    }

    // CRITICAL: Ensure contacts are loaded BEFORE fetching payment plans
    // This prevents payment plans from being incorrectly labeled with main client name
    // Get contacts directly from fetchContacts (returns immediately, doesn't wait for state update)
    const clientIdKey = client.id.toString();
    const contactsAlreadyLoaded = contactsLoadedRef.current === clientIdKey && contacts.length > 0;
    let currentContacts = contacts;
    if (!contactsAlreadyLoaded) {
      currentContacts = await fetchContacts();
      contactsLoadedRef.current = clientIdKey;
    }

    // Check if this is a legacy lead
    const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

    try {
      let data = null;
      let error = null;

      if (isLegacyLead) {
        // For legacy leads, fetch from finances_paymentplanrow table
        const legacyId = client.id.toString().replace('legacy_', '');

        // Query finances_paymentplanrow table with currency information
        // Filter out canceled payments (cancel_date is null for active payments)
        // Fetch payments by both lead_id (text) and client_id (bigint) for legacy leads
        const numericId = parseInt(legacyId);
        const isNumericIdValid = !isNaN(numericId);

        // Build OR condition: lead_id matches OR client_id matches main lead ID or contact IDs
        // Only use contact IDs if contacts array is loaded (non-empty)
        const contactIds = contacts.length > 0 ? contacts.map(c => c.id).filter(id => id != null) : [];
        const allClientIds = [numericId, ...contactIds].filter(id => id != null && !isNaN(Number(id)));

        // Build OR condition properly - each condition separated by comma
        let orCondition = `lead_id.eq.${legacyId}`;
        if (isNumericIdValid) {
          orCondition += `,client_id.eq.${numericId}`;
        }
        // Add contact IDs to OR condition
        contactIds.forEach(contactId => {
          if (contactId != null && !isNaN(Number(contactId))) {
            orCondition += `,client_id.eq.${contactId}`;
          }
        });

        const { data: legacyData, error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .select(`
                  *,
                  accounting_currencies!finances_paymentplanrow_currency_id_fkey (
                    name,
                    iso_code
                  ),
                  tenants_employee:ready_to_pay_by (
                    id,
                    display_name
                  )
                `)
          .or(orCondition)
          .is('cancel_date', null)
          .order('date', { ascending: true });

        data = legacyData;
        error = legacyError;
      } else {
        // For regular leads, fetch from payment_plans table
        // Filter out canceled payments (cancel_date is null for active payments)
        const { data: regularData, error: regularError } = await supabase
          .from('payment_plans')
          .select(`
            *,
            tenants_employee:ready_to_pay_by (
              id,
              display_name
            )
          `)
          .eq('lead_id', client.id)
          .is('cancel_date', null)
          .order('due_date', { ascending: true });

        data = regularData;
        error = regularError;
      }

      if (error) throw error;
      if (data && data.length > 0) {
        let total = 0;
        let vat = 0;
        let payments = [];

        if (isLegacyLead) {
          // Fetch employee display names for due_by_id values
          const dueByIds = new Set<number>();
          data.forEach((plan: any) => {
            if (plan.due_by_id) {
              dueByIds.add(plan.due_by_id);
            }
          });

          const dueByEmployeeMap = new Map<number, string>();
          if (dueByIds.size > 0) {
            const { data: employeesData } = await supabase
              .from('tenants_employee')
              .select('id, display_name')
              .in('id', Array.from(dueByIds));

            if (employeesData) {
              employeesData.forEach((emp: any) => {
                if (emp.id && emp.display_name) {
                  dueByEmployeeMap.set(emp.id, emp.display_name);
                }
              });
            }
          }

          // Transform legacy data with proper currency and VAT handling
          // First, process all payments to calculate totals and get currency info
          const processedPayments = data.map(plan => {
            const value = Number(plan.value || 0);

            // Get currency from the joined accounting_currencies table
            let currency = '₪'; // Default fallback
            let currencyId = plan.currency_id;

            if (plan.accounting_currencies && plan.accounting_currencies.name) {
              currency = displaySymbolFromAccountingRow(plan.accounting_currencies);
              currencyId = plan.accounting_currencies.id;
            } else if (plan.currency_id) {
              switch (plan.currency_id) {
                case 1: currency = '₪'; break;
                case 2: currency = '€'; break;
                case 3: currency = '$'; break;
                case 4: currency = '£'; break;
                default: currency = '₪'; break;
              }
            }

            const valueVat = readPaymentPlanVatFromRow(
              {
                value: plan.value,
                vat_value: plan.vat_value,
                currency,
                currency_id: currencyId,
                date: plan.date,
                due_date: plan.due_date,
                order: plan.order,
              },
              true,
            );

            const paymentTotal = value + valueVat;

            return {
              plan,
              value,
              valueVat,
              currency,
              currencyId,
              paymentTotal
            };
          });

          // Calculate totals using the same VAT logic
          let total = 0;
          let vat = 0;
          processedPayments.forEach(processed => {
            total += processed.paymentTotal;
            vat += processed.valueVat;
          });

          // Group payments by contact to calculate percentages per contact
          const paymentsByContact = new Map<string, typeof processedPayments>();
          processedPayments.forEach(processed => {
            const contactName = getContactNameFromClientId(processed.plan.client_id, currentContacts);
            if (!paymentsByContact.has(contactName)) {
              paymentsByContact.set(contactName, []);
            }
            paymentsByContact.get(contactName)!.push(processed);
          });

          // Per contact: distribute percentages so they sum to 100% (largest-remainder)
          const contactPercentsMap = new Map<string, Map<number, number>>();
          paymentsByContact.forEach((contactPayments, contactName) => {
            const contactTotal = contactPayments.reduce((sum, p) => {
              const orderText = p.plan.order ? getOrderText(p.plan.order) : 'First Payment';
              if (isExpenseNoVatPayment(p.plan.order) || isExpenseNoVatPayment(orderText)) return sum;
              return sum + p.value;
            }, 0);
            const eligible = contactPayments.filter((p) => {
              const orderText = p.plan.order ? getOrderText(p.plan.order) : 'First Payment';
              return !isExpenseNoVatPayment(p.plan.order) && !isExpenseNoVatPayment(orderText);
            });
            const exactPercents = contactTotal > 0 ? eligible.map((p) => (p.value / contactTotal) * 100) : [];
            const rounded = distributePercentagesTo100(exactPercents);
            const byPlanId = new Map<number, number>();
            eligible.forEach((p, i) => byPlanId.set(p.plan.id, rounded[i] ?? 0));
            contactPercentsMap.set(contactName, byPlanId);
          });

          // Calculate total per contact and then calculate percentages
          payments = processedPayments.map(processed => {
            const { plan, value, valueVat, currency, currencyId, paymentTotal } = processed;

            const contactName = getContactNameFromClientId(plan.client_id, currentContacts);
            const orderText = plan.order ? getOrderText(plan.order) : 'First Payment';
            const calculatedDuePercent = isExpenseNoVatPayment(plan.order) || isExpenseNoVatPayment(orderText)
              ? ''
              : (contactPercentsMap.get(contactName)?.get(plan.id) ?? 0).toString() + '%';

            // For legacy leads: if due_date is set (even without due_by_id), treat as ready_to_pay
            // This is because legacy leads use due_date and due_by_id instead of ready_to_pay flag
            // IMPORTANT: Show X button (revert) if due_date exists, even if due_by_id is missing
            const hasDueDate = !!plan.due_date;
            const hasDueDateAndDueBy = plan.due_date && plan.due_by_id;
            const isReadyToPay = plan.ready_to_pay || hasDueDate; // Changed: use hasDueDate instead of hasDueDateAndDueBy
            // For legacy leads, prioritize due_by_id over ready_to_pay_by
            const readyToPayBy = hasDueDateAndDueBy ? plan.due_by_id : (plan.ready_to_pay_by || null);
            // For legacy leads, get employee name from due_by_id using the map we fetched
            // If due_by_id is missing, we won't have a display name, but button should still show
            const readyToPayByDisplayName = hasDueDateAndDueBy
              ? (dueByEmployeeMap.get(plan.due_by_id) || null)
              : (plan.tenants_employee?.display_name || null);

            return {
              id: plan.id,
              duePercent: calculatedDuePercent,
              dueDate: plan.date || plan.due_date,
              value,
              valueVat,
              client: contactName, // Use contact name from client_id mapping
              order: plan.order ? getOrderText(plan.order) : 'First Payment',
              proforma: null,
              notes: plan.notes || '',
              paid: plan.actual_date ? true : false,
              paid_at: plan.actual_date,
              paid_by: null,
              currency,
              currency_id: currencyId ?? plan.currency_id ?? null,
              isLegacy: true,
              ready_to_pay: isReadyToPay,
              ready_to_pay_by: readyToPayBy,
              ready_to_pay_by_display_name: readyToPayByDisplayName,
              invoice_send_automation_active: plan.invoice_send_automation_active || false,
              invoice_send_automation_language: plan.invoice_send_automation_language || null,
              invoice_send_automation_at: plan.invoice_send_automation_at || null,
              invoice_send_automation_sent_at: plan.invoice_send_automation_sent_at || null,
            };
          });
        } else {
          // Transform regular data
          // First, process all payments to calculate totals with consistent VAT logic
          const processedPayments = data.map(plan => {
            const value = Number(plan.value);
            const valueVat = readPaymentPlanVatFromRow(plan, false);
            const currency = mapPaymentCurrencyToSymbol(plan.currency || '₪');

            const paymentTotal = value + valueVat;

            return {
              plan,
              value,
              valueVat,
              currency,
              paymentTotal
            };
          });

          // Calculate totals using the same VAT logic
          total = processedPayments.reduce((sum, processed) => sum + processed.paymentTotal, 0);
          vat = processedPayments.reduce((sum, processed) => sum + processed.valueVat, 0);

          // Group payments by contact to calculate percentages per contact
          const paymentsByContact = new Map<string, typeof processedPayments>();
          processedPayments.forEach(processed => {
            const contactName = processed.plan.client_name || 'Unknown Contact';
            if (!paymentsByContact.has(contactName)) {
              paymentsByContact.set(contactName, []);
            }
            paymentsByContact.get(contactName)!.push(processed);
          });

          // Per contact: distribute percentages so they sum to 100% (largest-remainder)
          const contactPercentsMap = new Map<string, Map<number, number>>();
          paymentsByContact.forEach((contactPayments, contactName) => {
            const contactTotal = contactPayments.reduce((sum, p) => {
              const orderText = typeof p.plan.payment_order === 'number' ? getOrderText(p.plan.payment_order) : (p.plan.payment_order || 'First Payment');
              if (isExpenseNoVatPayment(p.plan.payment_order) || isExpenseNoVatPayment(orderText)) return sum;
              return sum + p.value;
            }, 0);
            const eligible = contactPayments.filter((p) => {
              const orderText = typeof p.plan.payment_order === 'number' ? getOrderText(p.plan.payment_order) : (p.plan.payment_order || 'First Payment');
              return !isExpenseNoVatPayment(p.plan.payment_order) && !isExpenseNoVatPayment(orderText);
            });
            const exactPercents = contactTotal > 0 ? eligible.map((p) => (p.value / contactTotal) * 100) : [];
            const rounded = distributePercentagesTo100(exactPercents);
            const byPlanId = new Map<number, number>();
            eligible.forEach((p, i) => byPlanId.set(p.plan.id, rounded[i] ?? 0));
            contactPercentsMap.set(contactName, byPlanId);
          });

          // Calculate total per contact and then calculate percentages
          payments = processedPayments.map(processed => {
            const { plan, value, valueVat, currency, paymentTotal } = processed;

            const contactName = plan.client_name || 'Unknown Contact';
            const orderText = typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment');
            const duePercentStr = isExpenseNoVatPayment(plan.payment_order) || isExpenseNoVatPayment(orderText)
              ? ''
              : (contactPercentsMap.get(contactName)?.get(plan.id) ?? 0).toString() + '%';

            return {
              id: plan.id,
              duePercent: duePercentStr,
              dueDate: plan.due_date,
              value,
              valueVat,
              client: contactName,
              order: typeof plan.payment_order === 'number' ? getOrderText(plan.payment_order) : (plan.payment_order || 'First Payment'),
              proforma: plan.proforma || null,
              notes: plan.notes || '',
              paid: plan.paid || false,
              paid_at: plan.paid_at || null,
              paid_by: plan.paid_by || null,
              currency,
              currency_id: plan.currency_id ?? currencyIdFromSymbol(currency) ?? null,
              isLegacy: false,
              ready_to_pay: plan.ready_to_pay || false,
              ready_to_pay_by: plan.ready_to_pay_by || null,
              ready_to_pay_by_display_name: plan.tenants_employee?.display_name || null,
              invoice_send_automation_active: plan.invoice_send_automation_active || false,
              invoice_send_automation_language: plan.invoice_send_automation_language || null,
              invoice_send_automation_at: plan.invoice_send_automation_at || null,
              invoice_send_automation_sent_at: plan.invoice_send_automation_sent_at || null,
            };
          });
        }

        // Update paidMap to reflect the paid status from database
        const newPaidMap: { [id: string]: boolean } = {};
        payments.forEach(payment => {
          newPaidMap[payment.id.toString()] = payment.paid || false;
        });
        setPaidMap(newPaidMap);

        setFinancePlan({
          total: Math.round(total * 100) / 100,
          vat: Math.round(vat * 100) / 100,
          payments: payments,
        });
        const ids = await loadPaidPaymentLinkPlanIds({
          leadId: client.id,
          leadType: client.lead_type,
          paymentPlanIds: payments.map((p) => p.id),
        });
        setLinkPaidPlanIds(ids);
        const taxReceipts = await loadPaymentPlanTaxReceipts({
          leadId: client.id,
          leadType: client.lead_type,
          paymentPlanIds: payments.map((p) => p.id),
        });
        setTaxReceiptByPlanId(taxReceipts);
      } else {
        setFinancePlan(null);
        setPaidMap({});
      }
    } catch (error) {
      toast.error('Failed to refresh payment plans.');
    }
  };

  // Add a refresh function for contracts
  const refreshContracts = async () => {
    if (!client?.id || typeof client.id !== 'string' || client.id.length === 0) return;
    try {
      const contractData = await getClientContracts(client.id);
      setContracts(contractData || []);
    } catch (error) {
      console.error('Error refreshing contracts:', error);
    }
  };

  // Combined refresh function
  const refreshAllData = async () => {
    await Promise.all([refreshPaymentPlans(), refreshContracts()]);
  };
  // Expose the latest silent reload to the realtime subscription declared near the top.
  refreshAllDataRef.current = refreshAllData;

  // Update client balance to match finance plan total
  const updateClientBalance = async (newBalance: number) => {
    if (!client?.id) return;
    try {
      // Get the currency from the first payment in the finance plan
      const currency = financePlan?.payments?.[0]?.currency || '₪';

      // Check if this is a legacy lead
      const isLegacyLead = client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, update the leads_lead table
        const legacyId = client.id.toString().replace('legacy_', '');

        // Get currency_id from client (same logic as balance badge)
        const currencyId = (client as any).currency_id;
        // Convert to number for comparison (handle both string and number types)
        // Default to 1 (NIS) if currency_id is null/undefined/NaN
        let numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
        if (!numericCurrencyId || isNaN(numericCurrencyId)) {
          numericCurrencyId = 1; // Default to NIS
        }

        // Determine which column to update based on currency_id
        // If currency_id is 1 (NIS/ILS), save to total_base; otherwise save to total
        const updateData: any = {};
        if (numericCurrencyId === 1) {
          updateData.total_base = newBalance;
        } else {
          updateData.total = newBalance;
        }

        const { error } = await supabase
          .from('leads_lead')
          .update(updateData)
          .eq('id', legacyId);

        if (error) {
          console.error('Error updating legacy lead balance:', error);
          toast.error('Failed to update client balance');
        } else {
          // Update local client state
          if (onClientUpdate) {
            await onClientUpdate();
          }
          toast.success('Client balance updated');
        }
      } else {
        // For new leads, update the leads table
        const { error } = await supabase
          .from('leads')
          .update({
            balance: newBalance,
            balance_currency: currency
          })
          .eq('id', client.id);

        if (error) {
          console.error('Error updating client balance:', error);
          toast.error('Failed to update client balance');
        } else {
          // Update local client state
          if (onClientUpdate) {
            await onClientUpdate();
          }
          toast.success('Client balance updated');
        }
      }
    } catch (error) {
      console.error('Error updating client balance:', error);
      toast.error('Failed to update client balance');
    }
  };

  // Helper functions for percentage calculation feature
  const getTotalAmount = () => {
    if (!financePlan) return 0;

    // For legacy leads, use the contract total from leads_lead.total column
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        return legacyContract.total_amount;
      }
    }

    // For new leads, use the client's balance column
    if (!isLegacyLead && client?.balance) {
      return client.balance;
    }

    // Final fallback: Calculate total from all payments (both paid and unpaid)
    return financePlan.payments.reduce((sum, payment) => sum + payment.value + payment.valueVat, 0);
  };

  const getLeftToPlanAmount = (forContact?: string) => {
    if (!financePlan) return 0;

    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    // If a specific contact is provided, calculate left to plan for that contact only
    if (forContact) {
      // Filter payments for this specific contact
      const contactPayments = financePlan.payments.filter(p => p.client === forContact);
      const contactPlannedValue = contactPayments.reduce((sum, payment) => sum + payment.value, 0);

      // For legacy leads, use contract total_amount if available
      if (isLegacyLead && contracts.length > 0) {
        const legacyContract = contracts.find(c => c.isLegacy);
        if (legacyContract && legacyContract.total_amount > 0) {
          // For now, use the full contract amount for each contact
          // In the future, this could be split per contact if needed
          const leftToPlan = legacyContract.total_amount - contactPlannedValue;
          return Math.max(0, leftToPlan);
        }
      }

      // For new leads, use balance
      if (!isLegacyLead && client?.balance) {
        const leftToPlan = client.balance - contactPlannedValue;
        return Math.max(0, leftToPlan);
      }

      // Fallback: use total amount
      const totalAmount = getTotalAmount();
      return Math.max(0, totalAmount - contactPlannedValue);
    }

    // Global calculation (all contacts combined)
    // For legacy leads, calculate based on total column vs payment values
    if (isLegacyLead && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        // Calculate sum of payment values (without VAT) across all contacts
        const totalPlannedValue = financePlan.payments.reduce((sum, payment) => sum + payment.value, 0);
        // Left to plan = Total column - Sum of payment values
        const leftToPlan = legacyContract.total_amount - totalPlannedValue;
        return Math.max(0, leftToPlan); // Don't return negative values
      }
    }

    // For new leads, calculate based on balance vs payment values
    if (!isLegacyLead && client?.balance) {
      // Calculate sum of payment values (without VAT) across all contacts
      const totalPlannedValue = financePlan.payments.reduce((sum, payment) => sum + payment.value, 0);
      // Left to plan = Balance - Sum of payment values
      const leftToPlan = client.balance - totalPlannedValue;
      return Math.max(0, leftToPlan); // Don't return negative values
    }

    // Fallback: Use percentage-based calculation
    const totalAmount = getTotalAmount();

    // Calculate total planned amount based on due percentages (excluding "Expense (no VAT)" payments)
    const totalPlannedPercent = financePlan.payments.reduce((sum, payment) => {
      // Skip "Expense (no VAT)" payments
      if (isExpenseNoVatPayment(payment.order)) {
        return sum;
      }
      const percent = typeof payment.duePercent === 'string'
        ? parseFloat(payment.duePercent.replace('%', ''))
        : (payment.duePercent || 0);
      return sum + percent;
    }, 0);

    // If 100% is already planned, there's nothing left to plan
    if (totalPlannedPercent >= 100) {
      return 0;
    }

    // Calculate remaining percentage and convert to amount
    const remainingPercent = 100 - totalPlannedPercent;
    return Math.round((totalAmount * remainingPercent) / 100);
  };

  const handlePercentageCalculation = (percentage: number, type: 'total' | 'leftToPlan') => {
    // Get the contact name from newPaymentData or addingPaymentContact
    const contactName = newPaymentData.client || addingPaymentContact || '';
    const baseAmount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount(contactName || undefined);
    const calculatedValue = Math.round((baseAmount * percentage) / 100);
    // Calculate percentage based on the payment value vs total column
    const calculatedPercent = Math.round((calculatedValue / getTotalAmount()) * 100);

    // Get the currency from the finance plan or client data
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    let currency = '₪'; // Default
    if (isLegacyLead) {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    } else {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    }

    // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($)
    const shouldApplyVat = isNisCurrency({ currency });

    const vatRate = getVatRateForLegacyLead(newPaymentData?.dueDate);
    setNewPaymentData((prev: any) => ({
      ...prev,
      value: calculatedValue,
      duePercent: calculatedPercent,
      valueVat: shouldApplyVat ? Math.round(calculatedValue * vatRate * 100) / 100 : 0
    }));

    setShowPercentageModal(false);
    setPercentageValue(percentage);
  };

  const openPercentageModal = (type: 'total' | 'leftToPlan') => {
    setPercentageType(type);
    setPercentageValue(0);
    setShowPercentageModal(true);
  };

  const handleBoxClick = (type: 'total' | 'leftToPlan') => {
    // Get the contact name from newPaymentData or addingPaymentContact
    const contactName = newPaymentData.client || addingPaymentContact || '';
    const amount = type === 'total' ? getTotalAmount() : getLeftToPlanAmount(contactName || undefined);
    const totalAmount = getTotalAmount();

    // Calculate the percentage based on the amount
    const percentage = totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0;

    // Get the currency from the finance plan or client data
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    let currency = '₪'; // Default
    if (isLegacyLead) {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    } else {
      currency = financePlan?.payments[0]?.currency || client?.balance_currency || '₪';
    }

    // Only apply VAT for Israeli Shekels (₪), not for other currencies like USD ($); 17% before 2025-01-01, 18% on or after
    const shouldApplyVat = isNisCurrency({ currency });
    const vatRate = getVatRateForLegacyLead(newPaymentData?.dueDate);

    // Set the values in the new payment form
    setNewPaymentData((prev: any) => ({
      ...prev,
      value: amount,
      duePercent: percentage,
      valueVat: shouldApplyVat ? Math.round(amount * vatRate * 100) / 100 : 0
    }));
  };

  // Function to fetch deleted payments
  const fetchDeletedPayments = async () => {
    if (!client) return;

    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    if (isLegacyLead) {
      const legacyId = client.id.toString().replace('legacy_', '');

      try {
        // Fetch canceled payments (cancel_date is not null)
        const { data: deletedData, error } = await supabase
          .from('finances_paymentplanrow')
          .select(`
            *,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey (
              name,
              iso_code
            )
          `)
          .eq('lead_id', legacyId)
          .not('cancel_date', 'is', null)
          .order('cancel_date', { ascending: false });

        if (error) {
          console.error('Error fetching deleted payments:', error);
          return;
        }

        setDeletedPayments(deletedData || []);
      } catch (error) {
        console.error('Error fetching deleted payments:', error);
      }
    } else {
      // For new leads, fetch deleted payments from payment_plans table
      try {
        // Fetch canceled payments (cancel_date is not null)
        const { data: deletedData, error } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client.id)
          .not('cancel_date', 'is', null)
          .order('cancel_date', { ascending: false });

        if (error) {
          console.error('Error fetching deleted payments:', error);
          return;
        }

        setDeletedPayments(deletedData || []);
      } catch (error) {
        console.error('Error fetching deleted payments:', error);
      }
    }
  };

  // Function to restore a deleted payment
  const handleRestorePayment = async (paymentId: number) => {
    try {
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

      let error;
      if (isLegacyLead) {
        // Restore legacy payment in finances_paymentplanrow table
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: null })
          .eq('id', paymentId);
        error = legacyError;
      } else {
        // Restore new payment in payment_plans table
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: null })
          .eq('id', paymentId);
        error = newError;
      }

      if (error) throw error;

      toast.success('Payment restored successfully!');
      await fetchDeletedPayments(); // Refresh deleted payments list
      await refreshPaymentPlans(); // Refresh main payments list
    } catch (error) {
      console.error('Error restoring payment:', error);
      toast.error('Failed to restore payment.');
    }
  };

  // Function to fetch legacy proformas
  const fetchLegacyProformas = async () => {
    if (!client) return;

    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    if (isLegacyLead) {
      const legacyId = client.id.toString().replace('legacy_', '');

      try {
        // Use the view we created in the SQL script
        const { data: proformaData, error } = await supabase
          .from('proforma_with_rows')
          .select('*')
          .eq('lead_id', legacyId)
          .order('cdate', { ascending: false });

        if (error) {
          console.error('Error fetching legacy proformas:', error);
          return;
        }

        setLegacyProformas(proformaData || []);
      } catch (error) {
        console.error('Error fetching legacy proformas:', error);
      }
    }
  };

  // Helper function to get all available contacts (main + additional) with IDs
  const getAllAvailableContacts = (): Array<{ name: string; isMain: boolean; id?: number }> => {
    const allContacts: Array<{ name: string; isMain: boolean; id?: number }> = [];
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    console.log('🔍 getAllAvailableContacts called:', {
      contactsLength: contacts?.length || 0,
      contacts: contacts,
      currentClientName: client?.name,
      isLegacyLead
    });

    if (isLegacyLead) {
      // For legacy leads, include contacts from the contacts array
      // The main contact's ID is the legacy lead ID (numeric)
      let legacyId = client?.id?.toString();
      // Remove 'legacy_' prefix if present
      if (legacyId?.startsWith('legacy_')) {
        legacyId = legacyId.replace('legacy_', '');
      }
      const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;

      // ALWAYS add main contact with its ID (the legacy lead's numeric ID) - even if contacts array is empty
      if (client?.name) {
        if (numericLegacyId && !isNaN(numericLegacyId)) {
          allContacts.push({ name: client.name, isMain: true, id: numericLegacyId });
          console.log('✅ getAllAvailableContacts: Added main legacy contact', { name: client.name, id: numericLegacyId });
        } else {
          // Fallback: if we can't parse the ID, still add the contact but without ID
          allContacts.push({ name: client.name, isMain: true });
          console.warn('⚠️ getAllAvailableContacts: Could not parse legacy ID, added contact without ID', {
            clientId: client.id,
            legacyId,
            name: client.name
          });
        }
      }

      // Add additional contacts from contacts array (they have contact_id from leads_contact)
      if (contacts && contacts.length > 0) {
        contacts.forEach(contact => {
          if (contact.name && contact.name !== client?.name && contact.id) {
            allContacts.push({ name: contact.name, isMain: contact.isMain || false, id: contact.id });
          }
        });
        console.log('✅ getAllAvailableContacts: Added', contacts.length, 'additional contacts');
      }
    } else {
      // For new leads, use contacts from the contacts state (which are fetched from lead_leadcontact and leads_contact tables)
      // This works the same way as legacy leads since we're using the same tables
      if (contacts && contacts.length > 0) {
        contacts.forEach(contact => {
          if (contact.name) {
            allContacts.push({
              name: contact.name,
              isMain: contact.isMain || false,
              id: contact.id
            });
          }
        });
        console.log('✅ getAllAvailableContacts: Returning', allContacts.length, 'contacts from state');
      } else if (client?.name) {
        // Fallback: if no contacts found in database, at least include the main client name
        // Note: client.id is a string (UUID) for new leads, but id in contacts should be number
        // So we don't set id here for new leads fallback
        allContacts.push({
          name: client.name,
          isMain: true
        });
        console.log('⚠️ getAllAvailableContacts: No contacts in state, using fallback:', client.name);
      } else {
        console.warn('⚠️ getAllAvailableContacts: No contacts and no currentClient name');
      }
    }

    return allContacts;
  };

  // Helper function to get client_id for a contact name
  const getClientIdForContact = (contactName: string): number | null => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

    if (!contactName) {
      console.warn('🔍 getClientIdForContact: contactName is empty or undefined');
      return null;
    }

    // CRITICAL: Always look up the contact in the contacts array first
    // This ensures we use the contact_id (from leads_contact table) instead of the lead_id
    const normalizedContactName = contactName.trim();
    const contact = contacts.find(c => c.name && c.name.trim() === normalizedContactName);

    if (contact?.id) {
      console.log('🔍 getClientIdForContact: Contact found in contacts array', {
        contactName: normalizedContactName,
        contactId: contact.id,
        isMain: contact.isMain,
        allContacts: contacts.map(c => ({ name: c.name, id: c.id }))
      });
      return contact.id; // Return the contact_id from leads_contact table
    }

    // Fallback: If contact not found in array, try legacy lead ID (for backward compatibility)
    // But this should rarely happen if contacts are loaded correctly
    if (isLegacyLead) {
      const normalizedClientName = (client?.name || '').trim();
      if (normalizedContactName === normalizedClientName) {
        const legacyId = client?.id?.toString().replace('legacy_', '');
        const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;
        console.warn('⚠️ getClientIdForContact: Main contact not found in contacts array, using lead_id as fallback', {
          contactName: normalizedContactName,
          clientId: numericLegacyId,
          availableContacts: contacts.map(c => ({ name: c.name, id: c.id }))
        });
        return numericLegacyId && !isNaN(numericLegacyId) ? numericLegacyId : null;
      }
    }

    console.warn('🔍 getClientIdForContact: Contact not found', {
      contactName: normalizedContactName,
      clientName: client?.name,
      availableContacts: contacts.map(c => ({ name: c.name, id: c.id }))
    });
    return null;
  };

  // Helper function to get contact name from client_id for legacy payments
  // contactsArray parameter allows passing contacts directly to avoid state timing issues
  const getContactNameFromClientId = (clientId: number | null | undefined, contactsArray?: any[]): string => {
    // Use provided contacts array or fallback to state
    const contactsToUse = contactsArray || contacts;
    if (!clientId) {
      return client?.name || 'Legacy Client';
    }

    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (!isLegacyLead) {
      return client?.name || 'Legacy Client';
    }

    // Check if client_id matches the main lead ID
    const legacyId = client?.id?.toString().replace('legacy_', '');
    const numericLegacyId = legacyId ? parseInt(legacyId, 10) : null;
    if (numericLegacyId && clientId === numericLegacyId) {
      return client?.name || 'Legacy Client';
    }

    // Check if client_id matches a contact ID
    // Normalize both IDs to numbers for comparison to handle type mismatches
    const normalizedClientId = typeof clientId === 'string' ? parseInt(clientId, 10) : clientId;
    const contact = contactsToUse.find(c => {
      const normalizedContactId = typeof c.id === 'string' ? parseInt(c.id, 10) : c.id;
      return normalizedContactId === normalizedClientId;
    });

    if (contact?.name) {
      console.log('✅ getContactNameFromClientId: Found contact', { clientId, contactId: contact.id, contactName: contact.name });
      return contact.name;
    }

    // Debug: Log when contact is not found
    console.warn('⚠️ getContactNameFromClientId: Contact not found', {
      clientId,
      normalizedClientId,
      contactsCount: contactsToUse.length,
      availableContactIds: contactsToUse.map(c => ({ id: c.id, name: c.name, idType: typeof c.id }))
    });

    // If contact not found, don't fallback to main client - return a placeholder
    // This prevents incorrectly labeling contact payments as main client payments
    // The name will be corrected once contacts are loaded and payment plans refresh
    return `Contact #${clientId}`;
  };

  // Helper function to get contact name by contact_id
  const getContactName = (contactId: number, contract?: any) => {

    // If contract has contact_name, use it directly
    if (contract?.contact_name) {
      return contract.contact_name;
    }

    // If contactId is null, undefined, or 0, return main contact name
    if (!contactId || contactId === 0) {
      return client?.name || 'Main Contact';
    }

    // Try to find the contact by ID
    const contact = contacts.find(c => c.id === contactId);
    if (contact?.name) {
      return contact.name;
    }

    // If not found, try to get from additional_contacts array
    if (client?.additional_contacts && Array.isArray(client.additional_contacts)) {
      // contact_id might be the index in the additional_contacts array
      const contactIndex = contactId - 1; // Assuming contact_id starts from 1
      if (client.additional_contacts[contactIndex]) {
        return client.additional_contacts[contactIndex].name || `Contact ${contactId}`;
      }
    }

    // Fallback
    return `Contact ${contactId}`;
  };

  const handleEditPayment = (row: PaymentPlan) => {
    if (isPaidViaPaymentLink(row) && !isSuperuser) {
      handleOpenNotesModal(row);
      return;
    }
    setEditingPaymentInModal(row);
  };

  const handleCancelEditPayment = () => {
    setEditingPaymentId(null);
    setEditPaymentData({});
    setEditPaymentIncludeVat(true); // Reset to default
    setEditingPaymentInModal(null); // Close modal
  };

  const handleCloseEditModal = () => {
    setEditingPaymentInModal(null);
  };

  const handleSaveEditPaymentModal = async (paymentData: any, includeVat: boolean) => {
    try {
      // Ensure the payment data has all required fields from the original payment
      if (!editingPaymentInModal) {
        console.error('No payment being edited');
        toast.error('Cannot save payment: No payment selected');
        return;
      }

      // Merge the edited data with the original payment to ensure ID and isLegacy are preserved
      const paymentToSave = {
        ...editingPaymentInModal, // Original payment data (includes id, isLegacy, etc.)
        ...paymentData, // Edited data (value, valueVat, dueDate, etc.)
        id: editingPaymentInModal.id, // Ensure ID is always from original
        isLegacy: editingPaymentInModal.isLegacy, // Ensure isLegacy is always from original
      };

      console.log('💾 Saving payment:', {
        originalId: editingPaymentInModal.id,
        originalIsLegacy: editingPaymentInModal.isLegacy,
        paymentToSave: paymentToSave,
      });

      // Set the edit payment data and includeVat state (for other parts of the code that might use it)
      setEditPaymentData(paymentToSave);
      setEditPaymentIncludeVat(includeVat);

      // Call the existing save handler with the payment data directly
      await handleSaveEditPayment(paymentToSave, includeVat);

      // Close modal after save
      setEditingPaymentInModal(null);
    } catch (error) {
      console.error('Error in handleSaveEditPaymentModal:', error);
      toast.error('Failed to save payment. Please try again.');
      // Don't close modal on error so user can retry
    }
  };

  const handleSaveEditPayment = async (
    paymentDataOverride?: any,
    includeVatOverride?: boolean,
    options?: { silent?: boolean },
  ) => {
    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();

      // Use override data if provided (from modal), otherwise use state
      const paymentDataToUse = paymentDataOverride || editPaymentData;

      if (
        paymentDataToUse?.id &&
        isPaidViaPaymentLink({ ...paymentDataToUse, paid: true } as PaymentPlan) &&
        !isSuperuser
      ) {
        toast.error('Only notes can be edited for payments completed via payment link.');
        return;
      }
      const includeVatToUse = includeVatOverride !== undefined ? includeVatOverride : editPaymentIncludeVat;

      // Validate that we have the required data
      if (!paymentDataToUse || !paymentDataToUse.id) {
        console.error('Payment data is missing or invalid:', {
          paymentDataOverride,
          editPaymentData,
          paymentDataToUse
        });
        throw new Error('Payment data is missing or invalid. Cannot save payment.');
      }

      // Check if this is a legacy payment
      const isLegacyPayment = paymentDataToUse.isLegacy;

      // Get the original payment data to compare changes
      let originalPayment;
      if (isLegacyPayment) {
        // For legacy payments, fetch from finances_paymentplanrow table
        const { data: legacyPayment, error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .select('*')
          .eq('id', paymentDataToUse.id)
          .single();
        if (legacyError) {
          console.error('Error fetching legacy payment:', legacyError);
          console.error('Payment ID:', paymentDataToUse.id);
          console.error('Payment data:', paymentDataToUse);
          throw legacyError;
        }
        originalPayment = legacyPayment;
      } else {
        // For new payments, fetch from payment_plans table
        const { data: newPayment, error: newError } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('id', paymentDataToUse.id)
          .single();
        if (newError) {
          console.error('Error fetching new payment:', newError);
          console.error('Payment ID:', paymentDataToUse.id);
          console.error('Payment data:', paymentDataToUse);
          throw newError;
        }
        originalPayment = newPayment;
      }

      if (!originalPayment) {
        console.error('Original payment not found. Payment data:', {
          id: paymentDataToUse.id,
          isLegacy: isLegacyPayment,
          paymentDataToUse: paymentDataToUse
        });
        throw new Error(`Original payment not found. Payment ID: ${paymentDataToUse.id}, Is Legacy: ${isLegacyPayment}`);
      }

      // Original payment and edit payment data available for comparison

      // Track changes for each field
      const changes = [];

      // Helper function to extract numeric value from duePercent (may be "100%" or 100)
      const parseDuePercent = (value: any): number => {
        if (typeof value === 'string') {
          // Remove % sign and parse
          const numStr = value.replace('%', '').trim();
          const num = parseFloat(numStr);
          return isNaN(num) ? 0 : num;
        }
        return typeof value === 'number' ? value : 0;
      };

      // Convert both original and edit values to numbers for proper comparison
      // Handle different field names for legacy vs new payments
      const originalDuePercent = parseDuePercent(isLegacyPayment ? originalPayment.due_percent : originalPayment.due_percent);
      const editDuePercent = parseDuePercent(paymentDataToUse.duePercent);
      const originalValue = Number(originalPayment.value);
      const editValue = Number(paymentDataToUse.value);
      const originalValueVat = Number(isLegacyPayment ? originalPayment.vat_value : originalPayment.value_vat);
      const editValueVat = Number(paymentDataToUse.valueVat);

      if (originalDuePercent !== editDuePercent) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: 'due_percent',
          old_value: originalPayment.due_percent?.toString() || '',
          new_value: paymentDataToUse.duePercent?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString(),
        });
      }

      const originalDueDate = isLegacyPayment ? originalPayment?.date : originalPayment?.due_date;

      if (originalDueDate !== paymentDataToUse.dueDate) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: isLegacyPayment ? 'date' : 'due_date',
          old_value: originalDueDate || '',
          new_value: paymentDataToUse.dueDate || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString(),
        });
      }

      if (originalValue !== editValue) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: 'value',
          old_value: originalPayment.value?.toString() || '',
          new_value: paymentDataToUse.value?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }

      if (originalValueVat !== editValueVat) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: isLegacyPayment ? 'vat_value' : 'value_vat',
          old_value: (isLegacyPayment ? originalPayment.vat_value : originalPayment.value_vat)?.toString() || '',
          new_value: paymentDataToUse.valueVat?.toString() || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }

      if (originalPayment.client_name !== paymentDataToUse.client) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: 'client_name',
          old_value: originalPayment.client_name || '',
          new_value: paymentDataToUse.client || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }

      // Check order changes - handle both legacy (numeric) and new (string) payments
      if (isLegacyPayment) {
        // For legacy payments, order is stored as a number, need to convert for comparison
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1;
          }
        };
        const getOrderText = (orderNumber: number | null | undefined): string => {
          if (orderNumber === null || orderNumber === undefined) return '';
          switch (orderNumber) {
            case 1: return 'First Payment';
            case 5: return 'Intermediate Payment';
            case 9: return 'Final Payment';
            case 90: return 'Single Payment';
            case 99: return 'Expense (no VAT)';
            default: return 'First Payment';
          }
        };
        const originalOrderText = getOrderText(originalPayment.order);
        const editOrderNumber = paymentDataToUse.order ? getOrderNumber(paymentDataToUse.order) : null;
        if (originalPayment.order !== editOrderNumber) {
          changes.push({
            payment_plan_id: paymentDataToUse.id,
            field_name: 'order',
            old_value: originalOrderText || '',
            new_value: paymentDataToUse.order || '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
      } else {
        // For new payments, order is stored as a string
        if (originalPayment.payment_order !== paymentDataToUse.order) {
          changes.push({
            payment_plan_id: paymentDataToUse.id,
            field_name: 'payment_order',
            old_value: originalPayment.payment_order || '',
            new_value: paymentDataToUse.order || '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
      }

      if (originalPayment.notes !== paymentDataToUse.notes) {
        changes.push({
          payment_plan_id: paymentDataToUse.id,
          field_name: 'notes',
          old_value: originalPayment.notes || '',
          new_value: paymentDataToUse.notes || '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        });
      }

      // Check currency changes
      if (isLegacyPayment) {
        // For legacy payments, compare currency_id
        const originalCurrencyId = originalPayment.currency_id || 1;
        const editCurrencyId = paymentDataToUse.currency || paymentDataToUse.currencyId
          ? resolveCurrencyIdForSave(paymentDataToUse, availableCurrencies)
          : originalCurrencyId;
        if (originalCurrencyId !== editCurrencyId) {
          const getCurrencyName = (currencyId: number): string => {
            switch (currencyId) {
              case 1: return '₪';
              case 2: return '€';
              case 3: return '$';
              case 4: return '£';
              default: return '₪';
            }
          };
          changes.push({
            payment_plan_id: paymentDataToUse.id,
            field_name: 'currency_id',
            old_value: getCurrencyName(originalCurrencyId),
            new_value: getCurrencyName(editCurrencyId),
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
      } else {
        // For new payments, compare currency string
        const originalCurrency = mapPaymentCurrencyToSymbol(originalPayment.currency || '₪');
        const editCurrency = displaySymbolForPaymentSave(paymentDataToUse, availableCurrencies);
        if (originalCurrency !== editCurrency) {
          changes.push({
            payment_plan_id: paymentDataToUse.id,
            field_name: 'currency',
            old_value: originalCurrency || '',
            new_value: editCurrency || '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });
        }
      }

      // Total changes detected and logged

      // Update the payment plan
      let error;
      if (isLegacyPayment) {
        // For legacy payments, update finances_paymentplanrow table
        const dueDateValue = paymentDataToUse.dueDate || null;

        // Map payment order strings to numeric values for legacy payments
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1; // Default to first payment
          }
        };

        const orderValue = paymentDataToUse.order ? getOrderNumber(paymentDataToUse.order) : null;

        // Parse due_percent to remove % sign if present
        const duePercentValue = parseDuePercent(paymentDataToUse.duePercent);

        const currencyId = resolveCurrencyIdForSave(
          { ...paymentDataToUse, currency_id: originalPayment.currency_id },
          availableCurrencies,
        );

        // Recalculate VAT for legacy on save (17% before 2025-01-01, 18% on or after; legacy uses date column)
        const legacyVatValue = calculatePaymentPlanVatAmount(
          paymentDataToUse.value,
          includeVatToUse,
          paymentDataToUse.dueDate,
        );

        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({
            due_percent: duePercentValue,
            date: dueDateValue,
            // Removed due_date: dueDateValue - do not update due_date when editing payment plan
            value: paymentDataToUse.value,
            vat_value: legacyVatValue,
            order: orderValue,
            currency_id: currencyId,
            notes: paymentDataToUse.notes,
          })
          .eq('id', paymentDataToUse.id);
        error = legacyError;
      } else {
        // For new payments, update payment_plans table
        // Parse due_percent to remove % sign if present
        const duePercentValue = parseDuePercent(paymentDataToUse.duePercent);

        // Calculate VAT based on checkbox state at save time (17% before 2025-01-01, 18% on or after; use due_date for new leads)
        const vatValue = calculatePaymentPlanVatAmount(
          paymentDataToUse.value,
          includeVatToUse,
          paymentDataToUse.dueDate,
        );

        console.log('💾 Saving payment - VAT calculation:', {
          includeVatToUse,
          checkboxChecked: includeVatToUse,
          paymentDataToUseValue: paymentDataToUse.value,
          calculatedVatValue: vatValue,
          paymentDataToUseValueVat: paymentDataToUse.valueVat
        });

        const savedEditCurrency = displaySymbolForPaymentSave(
          { ...paymentDataToUse, currency_id: originalPayment.currency_id },
          availableCurrencies,
        );
        const savedEditCurrencyId = resolveCurrencyIdForSave(
          { ...paymentDataToUse, currency_id: originalPayment.currency_id },
          availableCurrencies,
        );

        const { error: newError } = await supabase
          .from('payment_plans')
          .update({
            due_percent: duePercentValue,
            due_date: paymentDataToUse.dueDate || null, // Set to null if empty
            value: paymentDataToUse.value,
            value_vat: vatValue, // Save VAT: 0 if checkbox unchecked, otherwise use value from state
            currency: savedEditCurrency,
            currency_id: savedEditCurrencyId,
            client_name: paymentDataToUse.client,
            payment_order: paymentDataToUse.order,
            notes: paymentDataToUse.notes,
          })
          .eq('id', paymentDataToUse.id);
        error = newError;
      }
      if (error) throw error;

      // Insert all changes into payment_plan_changes table (only for new payments)
      // Legacy payments don't use this table since lead_id has NOT NULL constraint
      if (changes.length > 0 && !isLegacyPayment) {
        // Add lead_id to each change record
        const changesWithLeadId = changes.map(change => ({
          ...change,
          lead_id: client?.id // Use UUID for new leads
        }));

        const { error: changesError } = await supabase
          .from('payment_plan_changes')
          .insert(changesWithLeadId);

        if (changesError) {
          console.error('Error logging changes:', changesError);
        }
      } else if (changes.length > 0 && isLegacyPayment) {
        // Legacy payment changes - skipping change logging
      }

      if (!options?.silent) {
        toast.success('Payment row updated!');
      }
      setEditingPaymentId(null);
      setEditPaymentData({});
      await refreshPaymentPlans();
      if (typeof window !== 'undefined' && client?.id) {
        console.log('[paymentPlan] changed (update)', { leadId: String(client.id), isLegacyLead: String(client.id).startsWith('legacy_') || client?.lead_type === 'legacy' });
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
    } catch (error) {
      console.error('Error updating payment:', error);
      toast.error('Failed to update payment row.');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleVatTogglePersist = async (paymentData: any, includeVat: boolean) => {
    if (!editingPaymentInModal) return;
    const paymentToSave = {
      ...editingPaymentInModal,
      ...paymentData,
      id: editingPaymentInModal.id,
      isLegacy: editingPaymentInModal.isLegacy,
    };
    await handleSaveEditPayment(paymentToSave, includeVat, { silent: true });
  };

  const handleDeletePayment = async (row: PaymentPlan) => {
    if (isPaidViaPaymentLink(row) && !isSuperuser) {
      toast.error('Only administrators can delete payments completed via payment link.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this payment row?')) return;
    try {
      const currentUserName = await getCurrentUserName();

      // Check if this is a legacy payment
      const isLegacyPayment = row.isLegacy;

      // Log the deletion in payment_plan_changes table (only for new payments)
      // Legacy payments don't use this table since lead_id has NOT NULL constraint
      if (!isLegacyPayment) {
        const { error: historyError } = await supabase
          .from('payment_plan_changes')
          .insert({
            payment_plan_id: null, // Set to null since we're deleting it
            lead_id: client?.id, // Use UUID for new leads
            field_name: 'payment_deleted',
            old_value: JSON.stringify({
              id: row.id,
              due_percent: row.duePercent,
              due_date: row.dueDate,
              value: row.value,
              value_vat: row.valueVat,
              client_name: row.client,
              payment_order: row.order,
              notes: row.notes,
              isLegacy: isLegacyPayment
            }),
            new_value: '',
            changed_by: currentUserName,
            changed_at: new Date().toISOString()
          });

        if (historyError) {
          console.error('Error logging deletion:', historyError);
          toast.error('Failed to log deletion history.');
          return;
        }
      } else {
        // Legacy payment deletion - skipping change logging
      }

      // Delete the payment plan
      let error;
      if (isLegacyPayment) {
        // For legacy payments, use soft delete by setting cancel_date
        const { error: legacyError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', row.id);
        error = legacyError;
      } else {
        // For new payments, use soft delete by setting cancel_date
        const { error: newError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', row.id);
        error = newError;
      }
      if (error) throw error;

      toast.success('Payment row deleted!');
      await refreshPaymentPlans();
      if (typeof window !== 'undefined' && client?.id) {
        console.log('[paymentPlan] changed (delete)', { leadId: String(client.id), isLegacyLead: String(client.id).startsWith('legacy_') || client?.lead_type === 'legacy' });
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      toast.error('Failed to delete payment row.');
    }
  };

  // Handler to delete all payments for a specific contact
  const handleDeletePaymentPlan = async (contactName: string) => {
    const contactPayments =
      financePlan?.payments?.filter((p) => p.client === contactName) ?? [];
    const hasClientPaidViaLink = contactPayments.some((p) => isPaidViaPaymentLink(p));
    if (hasClientPaidViaLink) {
      toast.error(
        'Cannot delete this payment plan — the client has completed payment via a payment link.',
      );
      return;
    }

    if (!window.confirm(`Are you sure you want to delete all payment rows for "${contactName}"? This action cannot be undone.`)) return;

    try {
      const currentUserName = await getCurrentUserName();
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, get client_id for the contact
        const clientIdForContact = getClientIdForContact(contactName);

        if (clientIdForContact === null) {
          toast.error(`Failed to find contact ID for "${contactName}". Cannot delete payment plan.`);
          return;
        }

        // Get all payments for this contact before deletion (for logging)
        const legacyId = client?.id?.toString().replace('legacy_', '');
        const { data: paymentsToDelete, error: fetchError } = await supabase
          .from('finances_paymentplanrow')
          .select('*')
          .eq('lead_id', legacyId)
          .eq('client_id', clientIdForContact)
          .is('cancel_date', null);

        if (fetchError) {
          console.error('Error fetching payments to delete:', fetchError);
          toast.error('Failed to fetch payments for deletion.');
          return;
        }

        if (!paymentsToDelete || paymentsToDelete.length === 0) {
          toast.success('No payments found for this contact.');
          return;
        }

        // Soft delete all payments for this contact
        const { error: deleteError } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('lead_id', legacyId)
          .eq('client_id', clientIdForContact)
          .is('cancel_date', null);

        if (deleteError) throw deleteError;

        toast.success(`Successfully deleted ${paymentsToDelete.length} payment(s) for "${contactName}"`);
      } else {
        // For new leads, use client_name to identify payments
        // Get all payments for this contact before deletion (for logging)
        const { data: paymentsToDelete, error: fetchError } = await supabase
          .from('payment_plans')
          .select('*')
          .eq('lead_id', client?.id)
          .eq('client_name', contactName)
          .is('cancel_date', null);

        if (fetchError) {
          console.error('Error fetching payments to delete:', fetchError);
          toast.error('Failed to fetch payments for deletion.');
          return;
        }

        if (!paymentsToDelete || paymentsToDelete.length === 0) {
          toast.success('No payments found for this contact.');
          return;
        }

        // Log deletions in payment_plan_changes table
        const changesToInsert = paymentsToDelete.map(payment => ({
          payment_plan_id: payment.id,
          lead_id: client?.id,
          field_name: 'payment_plan_deleted',
          old_value: JSON.stringify({
            id: payment.id,
            due_percent: payment.due_percent,
            due_date: payment.due_date,
            value: payment.value,
            value_vat: payment.value_vat,
            client_name: payment.client_name,
            payment_order: payment.payment_order,
            notes: payment.notes,
          }),
          new_value: '',
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        }));

        if (changesToInsert.length > 0) {
          const { error: historyError } = await supabase
            .from('payment_plan_changes')
            .insert(changesToInsert);

          if (historyError) {
            console.error('Error logging deletions:', historyError);
            // Continue with deletion even if logging fails
          }
        }

        // Soft delete all payments for this contact
        const { error: deleteError } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('lead_id', client?.id)
          .eq('client_name', contactName)
          .is('cancel_date', null);

        if (deleteError) throw deleteError;

        toast.success(`Successfully deleted ${paymentsToDelete.length} payment(s) for "${contactName}"`);
      }

      await refreshPaymentPlans();
      if (typeof window !== 'undefined' && client?.id) {
        console.log('[paymentPlan] changed (deletePlan)', { leadId: String(client.id), isLegacyLead });
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
    } catch (error) {
      console.error('Error deleting payment plan:', error);
      toast.error('Failed to delete payment plan.');
    }
  };

  // Generate proforma content as a structured object
  const generateProformaContent = async (data: any, createdBy: string) => {
    const total = data.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0);
    const totalWithVat = data.addVat ? Math.round(total * 1.18 * 100) / 100 : total;

    // Generate proforma name
    const proformaName = await generateProformaName();

    return JSON.stringify({
      client: data.client,
      clientId: data.clientId,
      contactId: data.contactId || null, // Store contact ID (client_id from payment plan) for future reference
      proformaName: proformaName,
      payment: data.payment,
      base: data.base,
      vat: data.vat,
      language: data.language,
      rows: data.rows,
      total: total,
      totalWithVat: totalWithVat,
      addVat: data.addVat,
      currency: data.currency,
      bankAccount: data.bankAccount,
      notes: data.notes,
      createdAt: new Date().toISOString(),
      createdBy: createdBy,
    });
  };

  // Handler to open proforma drawer
  const handleOpenProforma = async (payment: PaymentPlan) => {
    const proformaName = await generateProformaName();
    setGeneratedProformaName(proformaName);

    // Get the contact name from client_id (contact_id) if available
    let contactName = client?.name || 'Client';
    if (payment.client_id) {
      const contactNameFromId = getContactNameFromClientId(payment.client_id, contacts);
      if (contactNameFromId && contactNameFromId !== `Contact #${payment.client_id}`) {
        contactName = contactNameFromId;
      }
    }

    setProformaData({
      client: contactName,
      clientId: client?.id, // Keep lead ID for navigation
      contactId: payment.client_id || null, // Add contact ID (client_id from payment plan)
      paymentRowId: payment.id,
      payment: payment.value + payment.valueVat,
      base: payment.value,
      vat: payment.valueVat,
      language: 'EN',
      rows: [
        { description: payment.order, qty: 1, rate: payment.value, total: payment.value },
      ],
      addVat: true,
      currency: '₪',
      bankAccount: '',
      notes: '',
    });
    setShowProformaDrawer(true);
  };

  // Handler for proforma row changes
  const handleProformaRowChange = (idx: number, field: string, value: any) => {
    setProformaData((prev: any) => {
      const rows = prev.rows.map((row: any, i: number) =>
        i === idx ? { ...row, [field]: value, total: field === 'qty' || field === 'rate' ? value * (field === 'qty' ? row.rate : row.qty) : row.total } : row
      );
      return { ...prev, rows };
    });
  };

  // Handler to add row
  const handleAddProformaRow = () => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: [...prev.rows, { description: '', qty: 1, rate: 0, total: 0 }],
    }));
  };

  // Handler to delete row
  const handleDeleteProformaRow = (idx: number) => {
    setProformaData((prev: any) => ({
      ...prev,
      rows: prev.rows.filter((_: any, i: number) => i !== idx),
    }));
  };

  // Handler for create proforma
  const handleCreateProforma = async () => {
    if (!proformaData) return;
    try {
      let createdBy = 'Unknown';
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && user.email) {
          const { data: userData, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('email', user.email)
            .single();
          if (!error && userData?.full_name) {
            createdBy = userData.full_name;
          } else {
            createdBy = user.email;
          }
        }
      } catch { }
      // Generate proforma content with name and createdBy
      const proformaContent = await generateProformaContent(proformaData, createdBy);
      // Save proforma to the database for the specific payment row
      const { error } = await supabase
        .from('payment_plans')
        .update({ proforma: proformaContent })
        .eq('id', proformaData.paymentRowId);
      if (error) throw error;
      toast.success('Proforma created and saved successfully!');
      setShowProformaDrawer(false);
      setProformaData(null);
      await refreshPaymentPlans();
    } catch (error) {
      console.error('Error saving proforma:', error);
      toast.error('Failed to save proforma. Please try again.');
    }
  };

  // Function to view existing proforma
  const handleViewProforma = (payment: PaymentPlan) => {
    if (!payment.proforma || payment.proforma.trim() === '') return;

    try {
      const proformaData = JSON.parse(payment.proforma);
      setGeneratedProformaName(proformaData.proformaName || 'Proforma');
      setProformaData({
        ...proformaData,
        paymentRowId: payment.id,
        isViewMode: true, // Flag to indicate view-only mode
      });
      setShowProformaDrawer(true);
    } catch (error) {
      console.error('Error parsing proforma data:', error);
      toast.error('Failed to load proforma data.');
    }
  };

  const getProformaName = (proformaData: string) => {
    if (!proformaData || proformaData.trim() === '') {
      return 'Proforma';
    }

    try {
      const parsed = JSON.parse(proformaData);
      return parsed.proformaName || 'Proforma';
    } catch {
      return 'Proforma';
    }
  };

  // Add state for new payment rows
  const [addingPaymentContact, setAddingPaymentContact] = useState<string | null>(null); // table context (for backward compatibility)
  const [showDrawerNewPayment, setShowDrawerNewPayment] = useState(false); // finance-plan drawer context
  const [newPaymentData, setNewPaymentData] = useState<any>({}); // Keep for backward compatibility
  const [addingPaymentModalContact, setAddingPaymentModalContact] = useState<string | null>(null); // Modal context

  // Add superuser state
  const [isSuperuser, setIsSuperuser] = useState(false);
  // Add collection user state
  const [isCollection, setIsCollection] = useState(false);

  // Shared initializer for new payment data
  const initNewPaymentData = (contactName: string) => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    const rawCurrency = isLegacyLead
      ? (client?.balance_currency || '₪')
      : (client?.proposal_currency || '₪');
    const currencyMatch = findAccountingCurrency(
      rawCurrency,
      (client as any)?.currency_id,
      availableCurrencies,
    );
    const currency = currencyMatch?.name ?? mapPaymentCurrencyToSymbol(rawCurrency);
    const currencyId = currencyMatch?.id
      ?? resolveCurrencyIdForSave({ currency: rawCurrency, currency_id: (client as any)?.currency_id }, availableCurrencies);

    // Default amount: use balance/total where available
    let defaultAmount = 0;
    if (isLegacyLead && Array.isArray(contracts) && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        defaultAmount = Number(legacyContract.total_amount) || 0;
      }
    } else if (!isLegacyLead && typeof client?.balance === 'number' && client.balance > 0) {
      defaultAmount = Number(client.balance) || 0;
    }

    // Prefill duePercent as 100% when we have a default amount
    const defaultDuePercent = defaultAmount > 0 ? '100' : '';

    setNewPaymentData({
      dueDate: '',
      value: defaultAmount ? String(defaultAmount) : '',
      duePercent: defaultDuePercent,
      paymentOrder: 'Intermediate Payment',
      client: contactName,
      notes: '',
      paid: false,
      paid_at: null,
      paid_by: null,
      currency, // Set the correct currency
      includeVat: isNisCurrency({ currency: rawCurrency, currency_id: currencyId }),
      currencyId,
    });
  };

  // Handler to start adding a new payment in the main table for a contact
  const handleAddNewPayment = (contactName: string) => {
    // Open modal instead of inline editing
    setAddingPaymentModalContact(contactName);
  };

  // Initialize payment data for modal
  const getDefaultCurrency = (): string => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead) {
      return client?.balance_currency || '₪';
    } else {
      return client?.proposal_currency || '₪';
    }
  };

  const getDefaultAmount = (): number => {
    const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
    if (isLegacyLead && Array.isArray(contracts) && contracts.length > 0) {
      const legacyContract = contracts.find(c => c.isLegacy);
      if (legacyContract && legacyContract.total_amount > 0) {
        return Number(legacyContract.total_amount) || 0;
      }
    } else if (!isLegacyLead && typeof client?.balance === 'number' && client.balance > 0) {
      return Number(client.balance) || 0;
    }
    return 0;
  };

  // Handler to start adding a new payment from inside the finance-plan drawer
  const handleOpenDrawerNewPayment = (contactName?: string) => {
    const selectedContact = contactName || client?.name || 'Main Contact';
    initNewPaymentData(selectedContact);
    setShowDrawerNewPayment(true);
  };

  // Handler to cancel adding new payment
  const handleCancelNewPayment = () => {
    setAddingPaymentContact(null);
    setShowDrawerNewPayment(false);
    setNewPaymentData({});
  };

  // Helper to get contract country for a contact name
  const getContractCountryForContact = (contactName: string) => {
    const contract = contracts.find(c => c.contact_name === contactName);
    return contract?.client_country || null;
  };

  // Handler to save new payment from modal
  const handleSaveNewPaymentModal = async (paymentData: any, includeVat: boolean) => {
    // Prefer the contact that opened the modal (where "Add payment" was clicked), then modal form value, then main client
    const contactForPayment = addingPaymentModalContact || paymentData.client || client?.name || '';
    if (!paymentData.value || !contactForPayment || !paymentData.duePercent) {
      toast.error('Please fill in all required fields (Value and Due Percentage)');
      return;
    }

    // Use the payment data from modal
    const dataToSave = { ...paymentData, includeVat };
    await handleSaveNewPaymentWithData(dataToSave, contactForPayment);
    setAddingPaymentModalContact(null);
  };

  // Handler to save new payment (original, now accepts data parameter)
  const handleSaveNewPaymentWithData = async (dataToSave: any, contactForPayment: string) => {
    if (!dataToSave.value || !contactForPayment || !dataToSave.duePercent) {
      toast.error('Please fill in all required fields (Value and Due Percentage)');
      return;
    }

    setIsSavingPaymentRow(true);
    try {
      const currentUserName = await getCurrentUserName();

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyIdStr = client?.id?.toString().replace('legacy_', '');
        const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;

        if (!legacyId || isNaN(legacyId)) {
          throw new Error('Invalid legacy lead ID');
        }

        // Determine currency_id based on the payment currency
        const { currency_id: currencyId, currency } = (() => {
          const resolved = {
            currency_id: resolveCurrencyIdForSave(dataToSave, availableCurrencies),
            currency: displaySymbolForPaymentSave(dataToSave, availableCurrencies),
          };
          return resolved;
        })();

        // Map payment order strings to numeric values for legacy payments
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 1; // Default to first payment
          }
        };

        // Generate a unique numeric ID for the new payment
        const paymentId = Date.now() + Math.floor(Math.random() * 1000000);

        // Use the contact passed in from the caller (modal uses addingPaymentModalContact; inline uses newPaymentData/addingPaymentContact)
        const clientIdForContact = getClientIdForContact(contactForPayment);

        const paymentData = {
          id: paymentId,
          cdate: new Date().toISOString().split('T')[0], // Current date
          udate: new Date().toISOString().split('T')[0], // Current date
          date: dataToSave.dueDate || null, // Set to null if empty
          value: Number(dataToSave.value),
          vat_value: (isNisCurrency({ currency, currency_id: currencyId }) && dataToSave.includeVat !== false) ? Math.round(Number(dataToSave.value) * getVatRateForLegacyLead(dataToSave.dueDate) * 100) / 100 : 0,
          lead_id: legacyId, // Use numeric lead_id to ensure correct matching for subleads
          notes: dataToSave.notes || '',
          due_date: null, // MUST be null for legacy leads - only set when marking as ready to pay
          due_percent: (() => {
            const percent = dataToSave.duePercent || '0';
            const percentStr = percent.toString();
            return percentStr.includes('%') ? percentStr : percentStr + '%';
          })(), // Store the due percentage as text with % sign
          order: getOrderNumber(dataToSave.paymentOrder || 'Intermediate Payment'), // Convert string to numeric
          currency_id: currencyId,
          client_id: clientIdForContact, // Set client_id to separate payments by contact
        };

        const { data, error } = await supabase
          .from('finances_paymentplanrow')
          .insert(paymentData)
          .select();

        if (error) throw error;
      } else {
        // For new leads, save to payment_plans table
        // Get client_id for the contact
        const clientIdForContact = getClientIdForContact(contactForPayment);

        // Calculate VAT based on checkbox state (includeVat); 17% before 2025-01-01, 18% on or after (due_date for new leads)
        const vatValue = dataToSave.includeVat !== false
          ? Math.round(Number(dataToSave.value) * getVatRateForLegacyLead(dataToSave.dueDate) * 100) / 100
          : 0;

        // Ensure we're using the correct lead_id for this specific lead/sublead
        const leadIdForPayment = client?.id;
        if (!leadIdForPayment) {
          throw new Error('Invalid lead ID');
        }

        const savedCurrency = displaySymbolForPaymentSave(dataToSave, availableCurrencies);
        const savedCurrencyId = resolveCurrencyIdForSave(dataToSave, availableCurrencies);

        const paymentData: any = {
          lead_id: leadIdForPayment, // Use the specific lead_id for this lead/sublead
          due_percent: Number(dataToSave.duePercent) || Number(100),
          percent: Number(dataToSave.duePercent) || Number(100),
          due_date: dataToSave.dueDate || null, // Set to null if empty
          value: Number(dataToSave.value),
          value_vat: vatValue, // Use calculated VAT based on checkbox state
          client_name: contactForPayment,
          payment_order: dataToSave.paymentOrder || 'One-time Payment',
          notes: dataToSave.notes || '',
          currency: savedCurrency,
          currency_id: savedCurrencyId,
          created_by: currentUserName,
        };

        // Add client_id if available (int8 column for contact_id)
        // This ensures payments are correctly associated with the specific contact for this lead
        if (clientIdForContact !== null) {
          paymentData.client_id = clientIdForContact;
        }

        const { data, error } = await supabase
          .from('payment_plans')
          .insert(paymentData)
          .select();

        if (error) throw error;
      }

      // Payment created successfully

      toast.success('Payment plan created successfully');
      await refreshPaymentPlans();
      if (typeof window !== 'undefined' && client?.id) {
        console.log('[paymentPlan] changed (create)', { leadId: String(client.id), isLegacyLead: String(client.id).startsWith('legacy_') || client?.lead_type === 'legacy' });
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
    } catch (error) {
      console.error('Error creating payment plan:', error);
      toast.error('Failed to create payment plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  // Handler to save new payment (backward compatibility - uses state)
  const handleSaveNewPayment = async () => {
    const contactForPayment = newPaymentData.client || addingPaymentContact || client?.name || '';
    await handleSaveNewPaymentWithData(newPaymentData, contactForPayment);
    handleCancelNewPayment();
  };

  // Add handlers for auto plan functionality
  const handleCreateAutoPlan = async () => {
    if (!autoPlanData.totalAmount || !autoPlanData.numberOfPayments || !autoPlanData.contact) {
      toast.error('Please fill in all required fields (Total Amount, Number of Payments, and Contact)');
      return;
    }

    const totalAmount = Number(autoPlanData.totalAmount);

    // Use payment amounts if available, otherwise calculate from percentages
    const paymentAmounts = autoPlanData.paymentAmounts && autoPlanData.paymentAmounts.length > 0
      ? autoPlanData.paymentAmounts.slice(0, autoPlanData.numberOfPayments)
      : (() => {
        const percents = autoPlanData.paymentPercents || [];
        const activePercents = percents.slice(0, autoPlanData.numberOfPayments);
        return activePercents.map(percent => (totalAmount * Number(percent || 0)) / 100);
      })();

    // Calculate percentages from amounts for display/storage
    const activePercents = paymentAmounts.map(amount =>
      totalAmount > 0 ? Math.round((amount / totalAmount) * 100 * 100) / 100 : 0
    );

    // Check if amounts sum to total (allow small floating point differences)
    const sumOfAmounts = paymentAmounts.reduce((sum, amount) => sum + (amount || 0), 0);
    const amountsMatch = Math.abs(sumOfAmounts - totalAmount) < 0.01;

    // Show warning but allow creation if amounts don't match
    if (!amountsMatch) {
      const difference = Math.abs(sumOfAmounts - totalAmount);
      const confirmMessage = `The sum of payment amounts (${sumOfAmounts.toFixed(2)} ${autoPlanData.currency || '₪'}) doesn't match the total amount (${totalAmount.toFixed(2)} ${autoPlanData.currency || '₪'}). Difference: ${difference.toFixed(2)} ${autoPlanData.currency || '₪'}. Do you want to proceed anyway?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
    }

    setIsSavingPaymentRow(true);
    try {
      // CRITICAL: Ensure contacts are loaded before getting client_id
      // This prevents using stale or empty contacts array
      const currentContacts = await fetchContacts();
      console.log('🔍 handleCreateAutoPlan: Loaded contacts', {
        contactsCount: currentContacts.length,
        contacts: currentContacts.map(c => ({ name: c.name, id: c.id }))
      });

      const currentUserName = await getCurrentUserName();
      const totalAmount = Number(autoPlanData.totalAmount);

      // Check if this is a legacy lead
      const isLegacyLead = client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');

      if (isLegacyLead) {
        // For legacy leads, save to finances_paymentplanrow table
        const legacyIdStr = client?.id?.toString().replace('legacy_', '');
        const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;

        if (!legacyId || isNaN(legacyId)) {
          throw new Error('Invalid legacy lead ID');
        }

        // Determine currency_id based on the payment currency
        const currencyId = resolveCurrencyIdForSave(
          { currency: autoPlanData.currency },
          availableCurrencies,
        );
        const currency = displaySymbolForPaymentSave(
          { currency: autoPlanData.currency, currency_id: currencyId },
          availableCurrencies,
        );

        // Helper function to convert text order to numeric (same as new leads logic)
        const getOrderNumber = (orderString: string): number => {
          switch (orderString) {
            case 'First Payment': return 1;
            case 'Intermediate Payment': return 5;
            case 'Final Payment': return 9;
            case 'Single Payment': return 90;
            case 'Expense (no VAT)': return 99;
            default: return 5; // Default to intermediate
          }
        };

        const legacyPayments = [];
        const today = new Date();

        // Get client_id for the selected contact (outside the loop since it's the same for all payments)
        const selectedContactName = autoPlanData.contact || client?.name || '';
        console.log('🔍 handleCreateAutoPlan: Getting client_id for contact', {
          selectedContactName,
          autoPlanDataContact: autoPlanData.contact,
          clientName: client?.name,
          contactsCount: currentContacts.length,
          contacts: currentContacts.map(c => ({ name: c.name, id: c.id }))
        });

        // First try to find in currentContacts array (from fetchContacts)
        const normalizedContactName = selectedContactName.trim();
        let contact = currentContacts.find(c => c.name && c.name.trim() === normalizedContactName);
        let clientIdForContact = contact?.id ? Number(contact.id) : null;

        // If not found in currentContacts, try getAllAvailableContacts (which includes main client for legacy leads)
        if (clientIdForContact === null) {
          const availableContacts = getAllAvailableContacts();
          console.log('🔍 handleCreateAutoPlan: Contact not in currentContacts, checking getAllAvailableContacts', {
            availableContactsCount: availableContacts.length,
            availableContacts: availableContacts.map(c => ({ name: c.name, id: c.id }))
          });

          const availableContact = availableContacts.find(c => c.name && c.name.trim() === normalizedContactName);
          if (availableContact?.id) {
            clientIdForContact = Number(availableContact.id);
            console.log('✅ handleCreateAutoPlan: Found contact in getAllAvailableContacts', {
              name: availableContact.name,
              id: clientIdForContact
            });
          }
        }

        // Final fallback: if contact name matches client name for legacy lead, use legacy ID
        if (clientIdForContact === null && isLegacyLead) {
          const normalizedClientName = (client?.name || '').trim();
          if (normalizedContactName === normalizedClientName) {
            const legacyIdStr = client?.id?.toString().replace('legacy_', '');
            const legacyId = legacyIdStr ? parseInt(legacyIdStr, 10) : null;
            if (legacyId && !isNaN(legacyId)) {
              clientIdForContact = legacyId;
              console.log('✅ handleCreateAutoPlan: Using legacy ID as fallback', {
                name: normalizedClientName,
                id: clientIdForContact
              });
            }
          }
        }

        console.log('🔍 handleCreateAutoPlan: client_id result', {
          clientIdForContact,
          selectedContactName,
          contactId: contact?.id,
          contactFound: !!contact
        });

        if (clientIdForContact === null) {
          console.error('⚠️ handleCreateAutoPlan: Failed to get client_id (contact_id) for contact', {
            selectedContactName,
            currentContacts: currentContacts.map(c => ({ name: c.name, id: c.id })),
            availableContacts: getAllAvailableContacts().map(c => ({ name: c.name, id: c.id })),
            clientName: client?.name,
            clientId: client?.id
          });
          toast.error(`Failed to find contact ID for "${selectedContactName}". Please ensure the contact exists.`);
          setIsSavingPaymentRow(false);
          return;
        }

        // Ensure paymentOrders array is properly initialized
        const paymentOrders = autoPlanData.paymentOrders || [];
        while (paymentOrders.length < autoPlanData.numberOfPayments) {
          const idx = paymentOrders.length;
          const defaultOrder = idx === 0 ? 'First Payment' : idx === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          paymentOrders.push(defaultOrder);
        }

        for (let i = 0; i < autoPlanData.numberOfPayments; i++) {
          // Use actual payment amount if available, otherwise calculate from percentage
          const value = paymentAmounts[i] !== undefined ? paymentAmounts[i] : (totalAmount * Number(activePercents[i] || 0)) / 100;
          const paymentPercent = totalAmount > 0 ? Math.round((value / totalAmount) * 100 * 100) / 100 : 0;
          // Use custom order from paymentOrders array, or fallback to default based on position
          const defaultOrder = i === 0 ? 'First Payment' : i === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          const orderText = paymentOrders[i] || defaultOrder;
          // Convert to numeric for database storage
          const orderValue = getOrderNumber(orderText);

          // Calculate due date: 3 months apart for each payment (i * 3 months from today)
          const dueDate = new Date(today);
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          const dueDateStr = dueDate.toISOString().split('T')[0];

          const paymentRow = {
            cdate: new Date().toISOString().split('T')[0], // Current date
            udate: new Date().toISOString().split('T')[0], // Current date
            date: dueDateStr, // Keep the calculated date
            value,
            vat_value: autoPlanData.includeVat
              ? Math.round(value * getVatRateForLegacyLead(dueDateStr) * 100) / 100
              : 0,
            lead_id: legacyId, // Convert to number (bigint)
            notes: '',
            due_date: null, // MUST be null for legacy leads - only set when marking as ready to pay
            due_percent: `${paymentPercent}%`, // Store the due percentage as text with % sign
            order: orderValue, // Convert text order to numeric for database
            currency_id: currencyId,
            client_id: clientIdForContact, // Set client_id to separate payments by contact
          };

          console.log('🔍 handleCreateAutoPlan: Adding payment row', {
            paymentIndex: i,
            client_id: paymentRow.client_id,
            contactName: selectedContactName,
            lead_id: paymentRow.lead_id
          });

          legacyPayments.push(paymentRow);
        }

        console.log('🔍 handleCreateAutoPlan: Inserting payments', {
          count: legacyPayments.length,
          samplePayment: legacyPayments[0],
          allClientIds: legacyPayments.map(p => p.client_id)
        });

        const { data: insertedLegacyPayments, error: legacyPaymentInsertError } = await supabase
          .from('finances_paymentplanrow')
          .insert(legacyPayments)
          .select('id, client_id');

        if (legacyPaymentInsertError) {
          console.error('❌ handleCreateAutoPlan: Error inserting payments', legacyPaymentInsertError);
          throw legacyPaymentInsertError;
        }

        console.log('✅ handleCreateAutoPlan: Payments inserted successfully', {
          inserted: insertedLegacyPayments,
          insertedClientIds: insertedLegacyPayments?.map(p => p.client_id)
        });
      } else {
        // For new leads, save to payment_plans table
        const payments = [];
        const today = new Date();

        // Get client_id for the selected contact (for new leads)
        // Use currentContacts array (from fetchContacts) instead of state to ensure we have the latest data
        const selectedContactName = autoPlanData.contact || client?.name || '';
        console.log('🔍 handleCreateAutoPlan (new leads): Getting client_id for contact', {
          selectedContactName,
          contactsCount: currentContacts.length,
          contacts: currentContacts.map(c => ({ name: c.name, id: c.id }))
        });

        // Look up contact in currentContacts array to get contact_id (not lead_id)
        const normalizedContactName = selectedContactName.trim();
        const contact = currentContacts.find(c => c.name && c.name.trim() === normalizedContactName);
        const clientIdForContact = contact?.id ? Number(contact.id) : null;

        console.log('🔍 handleCreateAutoPlan (new leads): client_id result', {
          clientIdForContact,
          selectedContactName,
          contactId: contact?.id,
          contactFound: !!contact,
          isInteger: clientIdForContact !== null && Number.isInteger(clientIdForContact)
        });

        if (clientIdForContact === null || !Number.isInteger(clientIdForContact)) {
          console.error('⚠️ handleCreateAutoPlan (new leads): Failed to get client_id (contact_id) for contact', {
            selectedContactName,
            clientIdForContact,
            availableContacts: currentContacts.map(c => ({ name: c.name, id: c.id }))
          });
          toast.error(`Failed to find contact ID for "${selectedContactName}". Please ensure the contact exists.`);
          setIsSavingPaymentRow(false);
          return;
        }

        // Ensure paymentOrders array is properly initialized
        const paymentOrders = autoPlanData.paymentOrders || [];
        while (paymentOrders.length < autoPlanData.numberOfPayments) {
          const idx = paymentOrders.length;
          const defaultOrder = idx === 0 ? 'First Payment' : idx === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          paymentOrders.push(defaultOrder);
        }

        for (let i = 0; i < autoPlanData.numberOfPayments; i++) {
          // Use actual payment amount if available, otherwise calculate from percentage
          const value = paymentAmounts[i] !== undefined ? paymentAmounts[i] : (totalAmount * Number(activePercents[i] || 0)) / 100;
          const paymentPercent = totalAmount > 0 ? Math.round((value / totalAmount) * 100 * 100) / 100 : 0;

          // Calculate due date: 3 months apart for each payment (i * 3 months from today)
          const dueDate = new Date(today);
          dueDate.setMonth(dueDate.getMonth() + (i * 3));
          const dueDateStr = dueDate.toISOString().split('T')[0];

          // Calculate VAT based on checkbox state (includeVat); 17% before 2025-01-01, 18% on or after (due_date for new leads)
          const vatValue = autoPlanData.includeVat
            ? Math.round(value * getVatRateForLegacyLead(dueDateStr) * 100) / 100
            : 0;

          // Use custom order from paymentOrders array, or fallback to default based on position
          const defaultOrder = i === 0 ? 'First Payment' : i === autoPlanData.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
          const orderText = paymentOrders[i] || defaultOrder;

          // Ensure we're using the correct lead_id for this specific lead/sublead
          const leadIdForPayment = client?.id;
          if (!leadIdForPayment) {
            throw new Error('Invalid lead ID');
          }

          const paymentData: any = {
            lead_id: leadIdForPayment, // Use the specific lead_id for this lead/sublead
            due_percent: paymentPercent,
            due_date: dueDateStr,
            value,
            value_vat: vatValue, // Use calculated VAT based on checkbox state
            client_name: autoPlanData.contact || client?.name || 'Main Contact',
            payment_order: orderText,
            notes: '',
            currency: displaySymbolForPaymentSave(
              { currency: autoPlanData.currency },
              availableCurrencies,
            ),
            currency_id: resolveCurrencyIdForSave(
              { currency: autoPlanData.currency },
              availableCurrencies,
            ),
            created_by: currentUserName,
          };

          // Add client_id if available (int8 column for contact_id)
          // This ensures payments are correctly associated with the specific contact for this lead
          if (clientIdForContact !== null) {
            paymentData.client_id = clientIdForContact;
          }

          payments.push(paymentData);
        }

        // Log the auto plan creation in payment_plan_changes table
        const changesToInsert = payments.map(payment => ({
          lead_id: client?.id,
          payment_plan_id: null, // Will be set after insertion
          field_name: 'auto_plan_created',
          old_value: null,
          new_value: JSON.stringify({
            payment_order: payment.payment_order,
            value: payment.value,
            due_date: payment.due_date,
            client_name: payment.client_name,
            total_amount: totalAmount,
            currency: autoPlanData.currency
          }),
          changed_by: currentUserName,
          changed_at: new Date().toISOString()
        }));

        // Insert the payment plans first
        const { data: insertedPayments, error: paymentInsertError } = await supabase
          .from('payment_plans')
          .insert(payments)
          .select('id');

        if (paymentInsertError) throw paymentInsertError;

        // Now update the payment_plan_id in the changes records
        if (insertedPayments && insertedPayments.length > 0) {
          const updatedChanges = changesToInsert.map((change, index) => ({
            ...change,
            payment_plan_id: insertedPayments[index]?.id || null
          }));

          const { error: historyError } = await supabase
            .from('payment_plan_changes')
            .insert(updatedChanges);

          if (historyError) console.error('Error logging auto plan creation:', historyError);
        }
      }

      toast.success('Auto finance plan created successfully');
      setShowStagesDrawer(false);
      setAutoPlanData({
        totalAmount: '',
        currency: '₪',
        numberOfPayments: 3,
        paymentPercents: [50, 25, 25],
        paymentAmounts: [],
        paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
        includeVat: true,
        contact: '', // Reset contact
      });
      setIsCustomPaymentCount(false);
      setCustomPaymentCount(6);
      await refreshPaymentPlans();
      if (typeof window !== 'undefined' && client?.id) {
        console.log('[paymentPlan] changed (autoPlan)', { leadId: String(client.id), isLegacyLead: String(client.id).startsWith('legacy_') || client?.lead_type === 'legacy' });
        window.dispatchEvent(new CustomEvent('paymentPlan:changed', { detail: { leadId: String(client.id) } }));
      }
    } catch (error) {
      console.error('Error creating auto plan:', error);
      toast.error('Failed to create auto finance plan');
    } finally {
      setIsSavingPaymentRow(false);
    }
  };

  const handleOpenStagesDrawer = () => {
    setShowStagesDrawer(true);
  };

  const handleCloseStagesDrawer = () => {
    setShowStagesDrawer(false);
    setAutoPlanData({
      totalAmount: '',
      currency: '₪',
      numberOfPayments: 3,
      paymentPercents: [50, 25, 25],
      paymentAmounts: [],
      paymentOrders: ['First Payment', 'Intermediate Payment', 'Final Payment'],
      includeVat: true,
      contact: '', // Reset contact
    });
    setIsCustomPaymentCount(false);
    setCustomPaymentCount(6);
  };

  // 1. Add state to track which contact's history is open
  const [openHistoryContact, setOpenHistoryContact] = useState<string | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<{ [contact: string]: any[] }>({});

  // 2. Add a function to fetch payment history for a contact
  const fetchPaymentHistory = async (contactName: string) => {
    if (!client?.id) return;
    if (paymentHistory[contactName]) {
      setOpenHistoryContact(openHistoryContact === contactName ? null : contactName);
      return;
    }
    try {
      const contactPayments = (financePlan?.payments || []).filter(
        (p: PaymentPlan) => p.client === contactName,
      );
      const planIds = contactPayments
        .map((p) => Number(p.id))
        .filter((id) => Number.isFinite(id));
      const contact = contacts.find((c) => c.name === contactName);
      const planContactId =
        contact?.id != null
          ? Number(contact.id)
          : contactPayments[0]?.client_id != null
            ? Number(contactPayments[0].client_id)
            : null;

      const data = await fetchContactPaymentHistory({
        paymentPlanIds: planIds,
        leadId: client.id,
        leadType: client.lead_type,
        planContactId: Number.isFinite(planContactId) ? planContactId : null,
      });

      setPaymentHistory((prev) => ({ ...prev, [contactName]: data }));
      setOpenHistoryContact(contactName);
    } catch (error) {
      console.error('[FinancesTab] fetchPaymentHistory:', error);
      toast.error('Failed to fetch payment history');
    }
  };

  // Helper function to get current user's full name from Supabase users table
  const getCurrentUserName = async (): Promise<string> => {
    try {
      // Get current user from Supabase auth
      const { data: { user } } = await supabase.auth.getUser();

      if (!user?.email) {
        return 'System User';
      }

      // Get user from users table
      const { data: userData, error } = await supabase
        .from('users')
        .select('full_name, first_name, last_name, email')
        .eq('email', user.email)
        .single();

      if (error) {
        return user.email;
      }

      if (userData) {
        if (userData.full_name) {
          return userData.full_name;
        } else if (userData.first_name && userData.last_name) {
          const name = `${userData.first_name} ${userData.last_name}`;
          return name;
        } else if (userData.first_name) {
          return userData.first_name;
        } else if (userData.last_name) {
          return userData.last_name;
        } else {
          return userData.email;
        }
      }

      return user.email;
    } catch (error) {
      console.error('Error getting current user name:', error);
      return 'System User';
    }
  };

  // Helper function to get current user's employee_id from Supabase users table
  const getCurrentUserEmployeeId = async (): Promise<number | null> => {
    try {
      // Get current user from Supabase auth
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return null;
      }

      // Get user from users table with employee_id
      const { data: userData, error } = await supabase
        .from('users')
        .select('employee_id')
        .eq('auth_id', user.id)
        .single();

      if (error || !userData) {
        // Try by email as fallback
        if (user.email) {
          const { data: userDataByEmail } = await supabase
            .from('users')
            .select('employee_id')
            .eq('email', user.email)
            .single();

          if (userDataByEmail?.employee_id && typeof userDataByEmail.employee_id === 'number') {
            return userDataByEmail.employee_id;
          }
        }
        return null;
      }

      if (userData?.employee_id && typeof userData.employee_id === 'number') {
        return userData.employee_id;
      }

      return null;
    } catch (error) {
      console.error('Error getting current user employee_id:', error);
      return null;
    }
  };

  const selectedAutomationPayments = useMemo(() => {
    if (!financePlan) return [] as PaymentPlan[];
    const keys = selectedAutomationPaymentKeys;
    return financePlan.payments.filter((p) => keys.has(paymentPlanSelectionKey(p)));
  }, [financePlan, selectedAutomationPaymentKeys]);

  const selectedSendInvoicePayments = useMemo(() => {
    if (!financePlan) return [] as PaymentPlan[];
    const keys = selectedSendInvoicePaymentKeys;
    return financePlan.payments.filter((p) => keys.has(paymentPlanSelectionKey(p)));
  }, [financePlan, selectedSendInvoicePaymentKeys]);

  if (isLoadingFinancePlan) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <div className="text-lg font-medium text-gray-600 mt-4">Loading finance plan...</div>
      </div>
    );
  }

  if (!financePlan) {
    return (
      <>
        <div className="p-2 sm:p-4 md:p-6">
          <ClientTabPageHeader
            icon={BanknotesIcon}
            title="Finances"
            subtitle="Payment plans and collections"
          />
        </div>
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <BanknotesIcon className="w-16 h-16 text-primary mb-4" />
          <div className="text-2xl font-bold text-gray-800 mb-2">No finance plan created yet.</div>
          <div className="text-gray-500 mb-6">Create a payments plan to see finances here.</div>
          <button
            type="button"
            className="btn btn-md bg-black text-white border-none gap-3 shadow-sm text-lg font-bold py-3 px-6"
            onClick={() => {
              handleOpenStagesDrawer();
            }}
          >
            <BanknotesIcon className="w-5 h-5 text-white" />
            Create Finance Plan
          </button>
        </div>

        {/* Stages Drawer for creating a new finance plan */}
        {showStagesDrawer && ReactDOM.createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Overlay */}
            <div className="fixed inset-0 bg-black/30" onClick={handleCloseStagesDrawer} />
            {/* Modal */}
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl p-0 flex flex-col z-[110] overflow-hidden mx-4">
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between z-10">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">Finance Plan Stages</h2>
                  <p className="text-sm text-gray-500">Client: {client?.name}</p>
                </div>
                <button className="btn btn-sm btn-circle btn-ghost text-gray-600 hover:bg-gray-100" onClick={handleCloseStagesDrawer}>
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              {/* Main Content */}
              <div className="flex-1 p-6 overflow-y-auto bg-white">
                {/* Auto Plan Section */}
                <div className="mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ChartPieIcon className="w-5 h-5 text-gray-600" />
                    Create Auto Finance Plan
                  </h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Total Amount</span>
                        </label>
                        <input
                          type="number"
                          className="input input-bordered w-full no-arrows"
                          value={autoPlanData.totalAmount}
                          onChange={(e) => {
                            const newTotal = e.target.value;
                            const total = Number(newTotal || 0);
                            setAutoPlanData(prev => {
                              // Recalculate payment amounts from percentages when total changes
                              let percents = [...(prev.paymentPercents || [])];

                              // Ensure percents array matches numberOfPayments
                              if (percents.length !== prev.numberOfPayments) {
                                const count = prev.numberOfPayments;
                                if (count === 1) {
                                  percents = [100];
                                } else if (count === 3) {
                                  percents = [50, 25, 25];
                                } else {
                                  // Even split that sums to 100
                                  const base = Math.floor(100 / count);
                                  percents = Array.from({ length: count }, () => base);
                                  const remainder = 100 - base * count;
                                  for (let i = 0; i < remainder; i++) {
                                    percents[i] += 1;
                                  }
                                }
                              } else {
                                // Ensure array is long enough
                                while (percents.length < prev.numberOfPayments) {
                                  const idx = percents.length;
                                  const count = prev.numberOfPayments;
                                  let defaultPercent: number;
                                  if (count === 1) {
                                    defaultPercent = 100;
                                  } else if (count === 2) {
                                    defaultPercent = 50; // For 2 payments, each should be 50%
                                  } else {
                                    defaultPercent = idx === 0 ? 50 : idx === count - 1 ? 25 : 25;
                                  }
                                  percents.push(defaultPercent);
                                }
                              }

                              // Calculate amounts from percentages based on new total
                              const paymentAmounts = total > 0
                                ? percents.slice(0, prev.numberOfPayments).map(percent => (total * percent) / 100)
                                : Array.from({ length: prev.numberOfPayments }, () => 0);

                              return {
                                ...prev,
                                totalAmount: newTotal,
                                paymentAmounts,
                                paymentPercents: percents, // Update percents if they were recalculated
                              };
                            });
                          }}
                          placeholder="Enter total amount"
                        />
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Currency</span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={autoPlanData.currency}
                          onChange={(e) => setAutoPlanData(prev => ({ ...prev, currency: e.target.value }))}
                        >
                          {availableCurrencies.length === 0 ? (
                            <>
                              <option value="₪">₪ (ILS)</option>
                              <option value="€">€ (EUR)</option>
                              <option value="$">$ (USD)</option>
                              <option value="£">£ (GBP)</option>
                            </>
                          ) : (
                            availableCurrencies.map((curr) => (
                              <option key={curr.id} value={curr.name}>
                                {curr.name} ({curr.iso_code})
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Contact</span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={autoPlanData.contact}
                          onChange={(e) => setAutoPlanData(prev => ({ ...prev, contact: e.target.value }))}
                        >
                          <option value="">Select contact...</option>
                          {getAllAvailableContacts().map((contact, idx) => (
                            <option key={idx} value={contact.name}>
                              {contact.name} {contact.isMain && '(Main)'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Number of Payments</span>
                        </label>
                        <select
                          className="select select-bordered w-full"
                          value={isCustomPaymentCount ? 'custom' : autoPlanData.numberOfPayments}
                          onChange={(e) => {
                            if (e.target.value === 'custom') {
                              setIsCustomPaymentCount(true);
                            } else {
                              setIsCustomPaymentCount(false);
                              const count = Number(e.target.value);
                              setAutoPlanData(prev => {
                                const totalAmount = Number(prev.totalAmount || 0);
                                let percents: number[];
                                let orders: string[];
                                let amounts: number[] = [];

                                if (count === 1) {
                                  // For single payment, set to 100%
                                  percents = [100];
                                  orders = ['Single Payment'];
                                  amounts = totalAmount > 0 ? [totalAmount] : [0];
                                } else if (count === 3) {
                                  // Special default for 3 payments
                                  percents = [50, 25, 25];
                                  orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                  amounts = totalAmount > 0
                                    ? [totalAmount * 0.5, totalAmount * 0.25, totalAmount * 0.25]
                                    : [0, 0, 0];
                                } else {
                                  // Even split that sums to 100
                                  const base = Math.floor(100 / count);
                                  percents = Array.from({ length: count }, () => base);
                                  const remainder = 100 - base * count;
                                  for (let i = 0; i < remainder; i++) {
                                    percents[i] += 1;
                                  }
                                  // Generate default orders
                                  orders = Array.from({ length: count }, (_, i) => {
                                    if (i === 0) return 'First Payment';
                                    if (i === count - 1) return 'Final Payment';
                                    return 'Intermediate Payment';
                                  });
                                  // Calculate amounts from percentages
                                  amounts = totalAmount > 0
                                    ? percents.map(percent => (totalAmount * percent) / 100)
                                    : Array.from({ length: count }, () => 0);
                                }

                                return {
                                  ...prev,
                                  numberOfPayments: count,
                                  paymentPercents: percents,
                                  paymentOrders: orders,
                                  paymentAmounts: amounts,
                                };
                              });
                            }
                          }}
                        >
                          <option value={1}>1 Payment</option>
                          <option value={2}>2 Payments</option>
                          <option value={3}>3 Payments</option>
                          <option value={4}>4 Payments</option>
                          <option value={5}>5 Payments</option>
                          <option value="custom">Custom</option>
                        </select>
                        {isCustomPaymentCount && (
                          <div className="mt-2">
                            <input
                              type="number"
                              className="input input-bordered w-full"
                              min={1}
                              max={100}
                              value={customPaymentCount}
                              onChange={(e) => {
                                const count = Number(e.target.value) || 1;
                                setCustomPaymentCount(count);
                                setAutoPlanData(prev => {
                                  const totalAmount = Number(prev.totalAmount || 0);
                                  let percents: number[];
                                  let amounts: number[];
                                  let orders: string[];
                                  if (count === 1) {
                                    // For single payment, set to 100%
                                    percents = [100];
                                    amounts = totalAmount > 0 ? [totalAmount] : [0];
                                    orders = ['Single Payment'];
                                  } else if (count === 3) {
                                    // Special default for 3 payments
                                    percents = [50, 25, 25];
                                    amounts = totalAmount > 0
                                      ? [totalAmount * 0.5, totalAmount * 0.25, totalAmount * 0.25]
                                      : [0, 0, 0];
                                    orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                  } else {
                                    // Even split that sums to 100
                                    const base = Math.floor(100 / count);
                                    percents = Array.from({ length: count }, () => base);
                                    const remainder = 100 - base * count;
                                    for (let i = 0; i < remainder; i++) {
                                      percents[i] += 1;
                                    }
                                    // Calculate amounts from percentages
                                    amounts = totalAmount > 0
                                      ? percents.map(percent => (totalAmount * percent) / 100)
                                      : Array(count).fill(0);
                                    // Generate default orders
                                    orders = Array.from({ length: count }, (_, i) => {
                                      if (i === 0) return 'First Payment';
                                      if (i === count - 1) return 'Final Payment';
                                      return 'Intermediate Payment';
                                    });
                                  }
                                  return {
                                    ...prev,
                                    numberOfPayments: count,
                                    paymentPercents: percents,
                                    paymentAmounts: amounts,
                                    paymentOrders: orders,
                                  };
                                });
                              }}
                              placeholder="Enter number of payments"
                            />
                          </div>
                        )}
                      </div>
                      <div className="form-control">
                        <label className="label">
                          <span className="label-text font-medium">Payment Percentages & Amounts</span>
                        </label>
                        <div className="space-y-2">
                          {Array.from({ length: autoPlanData.numberOfPayments }).map((_, index) => {
                            const isFirst = index === 0;
                            const isLast = index === autoPlanData.numberOfPayments - 1;
                            const defaultLabel =
                              isFirst ? 'First Payment' : isLast ? 'Final Payment' : 'Intermediate Payment';
                            const currentOrder = autoPlanData.paymentOrders?.[index] || defaultLabel;
                            return (
                              <div key={index} className="flex items-center gap-2">
                                <select
                                  className="select select-bordered w-48 text-sm"
                                  value={currentOrder}
                                  onChange={(e) => {
                                    setAutoPlanData(prev => {
                                      const next = [...(prev.paymentOrders || [])];
                                      // Ensure array length
                                      while (next.length < prev.numberOfPayments) {
                                        const idx = next.length;
                                        const defaultOrder = idx === 0 ? 'First Payment' : idx === prev.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
                                        next.push(defaultOrder);
                                      }
                                      next[index] = e.target.value;
                                      return {
                                        ...prev,
                                        paymentOrders: next,
                                      };
                                    });
                                  }}
                                >
                                  <option value="First Payment">First Payment</option>
                                  <option value="Intermediate Payment">Intermediate Payment</option>
                                  <option value="Final Payment">Final Payment</option>
                                  <option value="Single Payment">Single Payment</option>
                                  <option value="Expense (no VAT)">Expense (no VAT)</option>
                                </select>
                                <input
                                  type="number"
                                  className="input input-bordered w-24 no-arrows"
                                  min={0}
                                  max={100}
                                  value={autoPlanData.paymentPercents[index] ?? 0}
                                  onFocus={(e) => {
                                    // Select all text when focused for easy editing
                                    e.target.select();
                                  }}
                                  onChange={(e) => {
                                    const percentValue = Number(e.target.value || 0);
                                    const totalAmount = Number(autoPlanData.totalAmount || 0);
                                    setAutoPlanData(prev => {
                                      const nextPercents = [...(prev.paymentPercents || [])];
                                      // Ensure array length
                                      while (nextPercents.length < prev.numberOfPayments) nextPercents.push(0);
                                      nextPercents[index] = percentValue;

                                      // Also update payment amounts when percentage changes
                                      const nextAmounts = [...(prev.paymentAmounts || [])];
                                      while (nextAmounts.length < prev.numberOfPayments) {
                                        const idx = nextAmounts.length;
                                        const total = Number(prev.totalAmount || 0);
                                        const percent = prev.paymentPercents[idx] ?? 0;
                                        nextAmounts.push(total > 0 ? (total * percent) / 100 : 0);
                                      }
                                      if (totalAmount > 0) {
                                        nextAmounts[index] = (totalAmount * percentValue) / 100;
                                      }

                                      return {
                                        ...prev,
                                        paymentPercents: nextPercents,
                                        paymentAmounts: nextAmounts,
                                      };
                                    });
                                  }}
                                />
                                <span className="text-sm">%</span>
                                <input
                                  type="number"
                                  className="input input-bordered w-32 no-arrows"
                                  min={0}
                                  step="0.01"
                                  value={(() => {
                                    // Use paymentAmounts if available, otherwise calculate from percentage
                                    const totalAmount = Number(autoPlanData.totalAmount || 0);
                                    let amount: number;
                                    if (autoPlanData.paymentAmounts && autoPlanData.paymentAmounts[index] !== undefined) {
                                      amount = autoPlanData.paymentAmounts[index];
                                    } else {
                                      const percent = autoPlanData.paymentPercents[index] ?? 0;
                                      amount = totalAmount > 0 ? (totalAmount * percent) / 100 : 0;
                                    }
                                    // Return as number (not string with .toFixed) to allow easy editing
                                    return amount;
                                  })()}
                                  onFocus={(e) => {
                                    // Select all text when focused for easy editing
                                    e.target.select();
                                  }}
                                  onChange={(e) => {
                                    const amountValue = Number(e.target.value || 0);
                                    const totalAmount = Number(autoPlanData.totalAmount || 0);

                                    setAutoPlanData(prev => {
                                      // Update payment amounts array
                                      const nextAmounts = [...(prev.paymentAmounts || [])];
                                      while (nextAmounts.length < prev.numberOfPayments) {
                                        const idx = nextAmounts.length;
                                        const total = Number(prev.totalAmount || 0);
                                        const percent = prev.paymentPercents[idx] ?? 0;
                                        nextAmounts.push(total > 0 ? (total * percent) / 100 : 0);
                                      }
                                      nextAmounts[index] = amountValue;

                                      // Also update percentage if total amount is available
                                      const nextPercents = [...(prev.paymentPercents || [])];
                                      while (nextPercents.length < prev.numberOfPayments) nextPercents.push(0);
                                      if (totalAmount > 0) {
                                        nextPercents[index] = Math.round((amountValue / totalAmount) * 100 * 100) / 100;
                                      }

                                      return {
                                        ...prev,
                                        paymentAmounts: nextAmounts,
                                        paymentPercents: nextPercents,
                                      };
                                    });
                                  }}
                                  placeholder="0"
                                />
                                <span className="text-sm">{autoPlanData.currency || '₪'}</span>
                              </div>
                            )
                          })}
                          {(() => {
                            // Calculate sum of payment amounts
                            const totalAmount = Number(autoPlanData.totalAmount || 0);
                            const paymentAmounts = autoPlanData.paymentAmounts || [];
                            const sumOfAmounts = paymentAmounts.length > 0
                              ? paymentAmounts.reduce((sum, amount) => sum + (amount || 0), 0)
                              : autoPlanData.paymentPercents.slice(0, autoPlanData.numberOfPayments).reduce((sum, percent) => {
                                return sum + (totalAmount * (percent || 0) / 100);
                              }, 0);

                            const amountsMatch = Math.abs(sumOfAmounts - totalAmount) < 0.01; // Allow small floating point differences

                            return (
                              <div className="space-y-1">
                                {!amountsMatch && totalAmount > 0 && (
                                  <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-200">
                                    <ExclamationTriangleIcon className="w-4 h-4" />
                                    <span>
                                      <strong>Warning:</strong> Sum of payment amounts ({sumOfAmounts.toFixed(2)} {autoPlanData.currency || '₪'})
                                      doesn't match total amount ({totalAmount.toFixed(2)} {autoPlanData.currency || '₪'}).
                                      Difference: {(sumOfAmounts - totalAmount).toFixed(2)} {autoPlanData.currency || '₪'}
                                    </span>
                                  </div>
                                )}
                                <div className="text-xs text-gray-500">
                                  You can freely edit payment amounts. The system will use the actual amounts you enter.
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-primary"
                          checked={autoPlanData.includeVat}
                          onChange={(e) => setAutoPlanData(prev => ({ ...prev, includeVat: e.target.checked }))}
                        />
                        <span className="label-text font-medium">Include VAT (18%)</span>
                      </label>
                    </div>
                    <button
                      className="btn btn-primary w-full"
                      onClick={handleCreateAutoPlan}
                      disabled={isSavingPaymentRow || !autoPlanData.totalAmount || !autoPlanData.contact}
                    >
                      {isSavingPaymentRow ? (
                        <span className="loading loading-spinner loading-sm"></span>
                      ) : (
                        <PlusIcon className="w-4 h-4 mr-2" />
                      )}
                      Create Auto Finance Plan
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>, document.body)
        }
      </>
    );
  }

  // Calculate totals from current payments
  const total = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.value), 0);
  const vat = financePlan.payments.reduce((sum: number, p: PaymentPlan) => sum + Number(p.valueVat), 0);

  // Group payments by currency for overall total
  const paymentsByCurrency = financePlan.payments.reduce((acc: { [currency: string]: number }, p: PaymentPlan) => {
    const currency = p.currency || '₪';
    acc[currency] = (acc[currency] || 0) + Number(p.value) + Number(p.valueVat);
    return acc;
  }, {});

  // Unpaid base + VAT per currency (excludes paid rows — same rules as ClientHeader Outstanding)
  const unpaidByCurrency = sumUnpaidBaseAndVatByCurrencyFromPayments(
    financePlan.payments.map((p) => ({
      value: Number(p.value),
      valueVat: Number(p.valueVat),
      paid: !!p.paid,
      currency: p.currency,
    }))
  );

  // Before rendering payment rows, calculate total:
  const totalPayments = financePlan.payments.reduce((sum, p) => sum + Number(p.value || 0) + Number(p.valueVat || 0), 0);
  // Before rendering payment rows, calculate totalBalanceWithVat:
  const totalBalanceWithVat = (client?.balance || 0) * 1.18;

  // Helper to get currency symbol
  const getCurrencySymbol = (currency: string | undefined) => mapPaymentCurrencyToSymbol(currency);

  // Sort payments by due date (or fallback to original order if no due dates)
  const sortedPayments = [...financePlan.payments].sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    } else if (a.dueDate && !b.dueDate) {
      return -1; // a comes before b
    } else if (!a.dueDate && b.dueDate) {
      return 1; // b comes before a
    }
    return 0; // both have no dueDate, keep original order
  });
  const firstPaymentId = sortedPayments[0]?.id;

  // Find the payment that should display the due date: 'First Payment' or 'archival' in order/label, or duePercent === '100'
  const dueDatePayment = financePlan.payments.find(p => {
    const order = (p.order || '').toLowerCase();
    return order.includes('first payment') || order.includes('archival') || p.duePercent === '100';
  });
  const dueDatePaymentId = dueDatePayment ? dueDatePayment.id : financePlan.payments[0]?.id;
  const planSummary = computePlanSummary(financePlan.payments);

  const togglePaymentSummaryFilter = (filter: PaymentPlanSummaryFilter) => {
    setPaymentSummaryFilter((prev) => (prev === filter ? null : filter));
  };

  const hasVisibleFilteredPayments =
    !paymentSummaryFilter
    || financePlan.payments.some((p) =>
      paymentMatchesSummaryFilter(p, paymentSummaryFilter, planSummary.nextDuePayment?.id),
    );

  const paymentRowIconBtn =
    'btn btn-sm btn-circle flex items-center justify-center border-2 shadow-sm p-0';

  const createProformaBtnClass =
    'rounded-lg border-0 bg-gray-50 px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100';

  const existingProformaBtnClass =
    'rounded-lg border-0 bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-purple-700 hover:text-white';

  const getExistingProformaBtnClass = (paid?: boolean) =>
    paid
      ? 'rounded-lg border-0 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-700 hover:text-white'
      : existingProformaBtnClass;

  const legacyPaymentHasProforma = (paymentPlanId: string | number): boolean =>
    legacyProformas.some((proforma) => Number(proforma.ppr_id) === Number(paymentPlanId));

  /** New leads: proforma JSON on row. Legacy: proformainvoice linked via ppr_id. */
  const paymentRowHasProforma = (payment: PaymentPlan): boolean =>
    paymentPlanHasProforma(payment, legacyProformas);

  const exitSendInvoiceSelectMode = () => {
    setSendInvoiceSelectMode(false);
    setSelectedSendInvoicePaymentKeys(new Set());
  };

  const exitInvoiceAutomationSelectMode = () => {
    setInvoiceAutomationSelectMode(false);
    setSelectedAutomationPaymentKeys(new Set());
  };

  const enterSendInvoiceSelectMode = () => {
    exitInvoiceAutomationSelectMode();
    setSendInvoiceSelectMode(true);
    setSelectedSendInvoicePaymentKeys(new Set());
  };

  const enterInvoiceAutomationSelectMode = () => {
    exitSendInvoiceSelectMode();
    setInvoiceAutomationSelectMode(true);
    setSelectedAutomationPaymentKeys(new Set());
  };

  const paymentRowPickMode = sendInvoiceSelectMode
    ? 'send-invoice'
    : invoiceAutomationSelectMode
      ? 'automation'
      : null;

  const isPaymentRowSelectedForPick = (payment: PaymentPlan) => {
    const key = paymentPlanSelectionKey(payment);
    if (sendInvoiceSelectMode) return selectedSendInvoicePaymentKeys.has(key);
    if (invoiceAutomationSelectMode) return selectedAutomationPaymentKeys.has(key);
    return false;
  };

  const isPaymentRowPickDisabled = (payment: PaymentPlan) => {
    if (payment.paid) return true;
    if (sendInvoiceSelectMode && !paymentRowHasProforma(payment)) return true;
    if (paymentRowPickMode === 'automation' && !payment.dueDate) return true;
    return false;
  };

  const toggleSendInvoicePaymentSelection = (payment: PaymentPlan) => {
    if (!sendInvoiceSelectMode) return;
    if (isPaymentRowPickDisabled(payment)) {
      if (!paymentRowHasProforma(payment)) {
        toast.error('Create a proforma before sending the invoice');
      }
      return;
    }
    const key = paymentPlanSelectionKey(payment);
    setSelectedSendInvoicePaymentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePaymentRowPick = (payment: PaymentPlan) => {
    if (sendInvoiceSelectMode) toggleSendInvoicePaymentSelection(payment);
    else if (invoiceAutomationSelectMode) toggleAutomationPaymentSelection(payment);
  };

  const toggleAutomationPaymentSelection = (payment: PaymentPlan) => {
    if (!invoiceAutomationSelectMode) return;
    if (payment.paid) return;
    if (!payment.dueDate) {
      toast.error('Payment has no due date');
      return;
    }
    const key = paymentPlanSelectionKey(payment);
    setSelectedAutomationPaymentKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openSendInvoiceModal = () => {
    if (selectedSendInvoicePayments.length === 0) {
      toast.error('Select at least one payment row');
      return;
    }
    setSendInvoiceModalOpen(true);
  };

  const handleSendInvoiceConfirm = async (language: ProformaSendLanguage) => {
    if (!client?.id || selectedSendInvoicePayments.length === 0) return;

    setSendingInvoice(true);
    const isLegacyLead =
      client.lead_type === 'legacy' || client.id.toString().startsWith('legacy_');
    const leadNumber = client.lead_number
      ? String(client.lead_number).replace(/^#/, '').trim()
      : String(client.id);

    let sent = 0;
    let failed = 0;

    try {
      for (const payment of selectedSendInvoicePayments) {
        try {
          const input = await buildSendInvoiceInputForPaymentPlan(payment, {
            leadId: client.id,
            leadNumber,
            isLegacyLead,
            language,
            legacyProformas,
          });
          if (!input) {
            failed += 1;
            continue;
          }

          const result = await sendProformaInvoiceBundle(input);
          collectProformaSendPartialErrors(result).forEach((message) => toast.error(message));

          if (
            result.emailError?.message === 'MAILBOX_NOT_CONNECTED' ||
            (result.emailError as Error & { code?: string })?.code === 'MAILBOX_NOT_CONNECTED'
          ) {
            showReconnectModal('Connect Outlook to send invoices by email.');
          }

          if (result.emailSent || result.whatsAppSent) {
            sent += 1;
            toast.success(buildProformaSendSuccessMessage(result, language));
          } else {
            failed += 1;
          }
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : 'Failed to send invoice';
          if ((err as Error & { code?: string }).code === 'MAILBOX_NOT_CONNECTED') {
            showReconnectModal('Connect Outlook to send invoices by email.');
          } else {
            toast.error(message);
          }
        }
      }

      if (sent > 0) {
        toast.success(`Invoice sent for ${sent} row${sent === 1 ? '' : 's'}`);
      }
      if (failed > 0 && sent === 0) {
        toast.error(`Failed to send invoice for ${failed} row${failed === 1 ? '' : 's'}`);
      }

      setSendInvoiceModalOpen(false);
      exitSendInvoiceSelectMode();
    } catch (err) {
      console.error('handleSendInvoiceConfirm:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to send invoice');
    } finally {
      setSendingInvoice(false);
    }
  };

  const openInvoiceAutomationModal = () => {
    if (selectedAutomationPayments.length === 0) {
      toast.error('Select at least one payment row');
      return;
    }
    setInvoiceAutomationModalOpen(true);
  };

  const handleInvoiceAutomationConfirm = async (language: ProformaSendLanguage) => {
    if (!user?.id) {
      toast.error('You must be signed in');
      return;
    }
    if (selectedAutomationPayments.length === 0) return;

    setSavingInvoiceAutomation(true);
    try {
      const isLegacyLead =
        client?.lead_type === 'legacy' || client?.id?.toString().startsWith('legacy_');
      const leadNumber = client?.lead_number
        ? String(client.lead_number).replace(/^#/, '').trim()
        : String(client?.id ?? '');
      const createdBy = await getCurrentUserName();
      const employeeId = await getCurrentUserEmployeeId();

      let proformaBatch;
      try {
        proformaBatch = await ensureProformasForAutomationPayments(selectedAutomationPayments, {
          leadId: client!.id,
          leadNumber,
          isLegacyLead,
          createdBy,
          employeeId,
          legacyProformas,
        });
      } catch (proformaErr) {
        console.error('ensureProformasForAutomationPayments:', proformaErr);
        toast.error(proformaErr instanceof Error ? proformaErr.message : 'Failed to create proforma');
        return;
      }

      if (proformaBatch.createdCount > 0) {
        setLegacyProformas((prev) => [...prev, ...proformaBatch.addedLegacyProformas]);
        toast.success(
          proformaBatch.createdCount === 1
            ? 'Proforma created automatically'
            : `${proformaBatch.createdCount} proformas created automatically`,
        );
      }

      const rows: PaymentPlanAutomationRow[] = selectedAutomationPayments.map((p) => ({
        id: p.id,
        isLegacy: p.isLegacy,
        client_id: p.client_id,
        client: p.client,
        dueDate: p.dueDate,
        paid: p.paid,
        proforma: p.isLegacy
          ? p.proforma
          : proformaBatch.newProformaByPaymentId.get(String(p.id)) ?? p.proforma,
      }));
      const count = await enableInvoiceSendAutomation(rows, language, user.id);
      if (count === 0) {
        toast.error('Failed to enable automation. Run sql/add_payment_plan_invoice_send_automation.sql if columns are missing.');
        return;
      }
      toast.success(
        count === 1
          ? 'Invoice automation enabled — will send on due date'
          : `Invoice automation enabled for ${count} payments`,
      );
      const automationAt = new Date().toISOString();
      const enabledKeys = new Set(selectedAutomationPayments.map((p) => paymentPlanSelectionKey(p)));
      setFinancePlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          payments: prev.payments.map((p) => {
            if (!enabledKeys.has(paymentPlanSelectionKey(p))) return p;
            const autoProforma = proformaBatch.newProformaByPaymentId.get(String(p.id));
            return {
              ...p,
              ...(autoProforma ? { proforma: autoProforma } : {}),
              invoice_send_automation_active: true,
              invoice_send_automation_language: language,
              invoice_send_automation_at: automationAt,
              invoice_send_automation_sent_at: null,
            };
          }),
        };
      });
      setInvoiceAutomationModalOpen(false);
      exitInvoiceAutomationSelectMode();
      await refreshAllData();
    } catch (err) {
      console.error('handleInvoiceAutomationConfirm:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to enable automation');
    } finally {
      setSavingInvoiceAutomation(false);
    }
  };

  const handleDisableInvoiceAutomation = async (payment: PaymentPlan) => {
    const dueLabel = formatDateDDMMYYYY(payment.dueDate) || 'the due date';
    const langLabel = payment.invoice_send_automation_language === 'he' ? 'Hebrew' : 'English';
    const confirmed = window.confirm(
      `Remove scheduled invoice send on ${dueLabel} (${langLabel})?\n\nThe invoice will not be sent automatically on the due date.`,
    );
    if (!confirmed) return;

    try {
      const count = await disableInvoiceSendAutomation([payment]);
      if (count > 0) {
        setFinancePlan((prev) => {
          if (!prev) return prev;
          const key = paymentPlanSelectionKey(payment);
          return {
            ...prev,
            payments: prev.payments.map((p) =>
              paymentPlanSelectionKey(p) === key
                ? {
                    ...p,
                    invoice_send_automation_active: false,
                    invoice_send_automation_language: null,
                    invoice_send_automation_at: null,
                    invoice_send_automation_sent_at: null,
                  }
                : p,
            ),
          };
        });
        toast.success('Invoice automation removed');
        await refreshAllData();
      }
    } catch (err) {
      toast.error('Failed to remove automation');
    }
  };

  const renderInvoiceAutomationBadge = (payment: PaymentPlan) => {
    if (!payment.invoice_send_automation_active) return null;
    const sent = Boolean(payment.invoice_send_automation_sent_at);
    const title = sent
      ? `Invoice sent automatically on ${formatDateDDMMYYYY(payment.invoice_send_automation_sent_at)}`
      : `Scheduled invoice send on ${formatDateDDMMYYYY(payment.dueDate)} (${payment.invoice_send_automation_language === 'he' ? 'Hebrew' : 'English'}) — click to remove`;
    return (
      <button
        type="button"
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-0 ${
          sent
            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
        }`}
        title={title}
        aria-label={title}
        onClick={(e) => {
          e.stopPropagation();
          if (!sent) void handleDisableInvoiceAutomation(payment);
        }}
      >
        {sent ? (
          <CheckIcon className="h-5 w-5" aria-hidden />
        ) : (
          <ClockIcon className="h-5 w-5" aria-hidden />
        )}
      </button>
    );
  };

  const getTaxReceiptForPlan = (payment: PaymentPlan): PaymentPlanTaxReceiptInfo | null => {
    const planId = Number(payment.id);
    if (!Number.isFinite(planId)) return null;
    return taxReceiptByPlanId.get(planId) ?? null;
  };

  const refreshTaxReceipts = async () => {
    if (!client?.id || !financePlan?.payments?.length) return;
    try {
      const taxReceipts = await loadPaymentPlanTaxReceipts({
        leadId: client.id,
        leadType: client.lead_type,
        paymentPlanIds: financePlan.payments.map((p) => p.id),
      });
      setTaxReceiptByPlanId(taxReceipts);
    } catch (err) {
      console.error('Failed to refresh tax receipts:', err);
    }
  };

  const canRetryTaxReceipt = (payment: PaymentPlan, info: PaymentPlanTaxReceiptInfo | null) => {
    if (!isSuperuser && !isCollection) return false;
    if (!info?.secure_token?.trim() || !isPaidViaPaymentLink(payment)) return false;
    if (info.payper_invoice_link?.trim()) return false;
    const status = info.payper_invoice_status;
    return status === 'failed' || status === 'skipped_no_email' || !status;
  };

  const handleRetryTaxReceipt = async (payment: PaymentPlan) => {
    const info = getTaxReceiptForPlan(payment);
    const token = info?.secure_token?.trim();
    const planId = Number(payment.id);
    if (!token || !Number.isFinite(planId)) {
      toast.error('No payment link found for this row');
      return;
    }

    setRetryingTaxReceiptPlanIds((prev) => new Set(prev).add(planId));
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user?.id) {
        toast.error('You must be signed in to retry tax receipt');
        return;
      }

      const result = await retryPayperInvoice(token, user.id);
      await refreshTaxReceipts();

      if (!result.success) {
        toast.error(result.error || result.reason || 'Tax receipt retry failed');
        return;
      }

      const parts: string[] = [];
      if (result.payper_invoice_link || result.invoiceLink) {
        parts.push('Tax receipt created');
      }
      if (result.confirmation_email_sent) {
        parts.push('confirmation email sent');
      }
      toast.success(parts.length ? parts.join(' · ') : 'Retry completed');
    } catch (err) {
      console.error('handleRetryTaxReceipt:', err);
      toast.error(err instanceof Error ? err.message : 'Tax receipt retry failed');
    } finally {
      setRetryingTaxReceiptPlanIds((prev) => {
        const next = new Set(prev);
        next.delete(planId);
        return next;
      });
    }
  };

  const renderTaxReceiptRetryButton = (
    payment: PaymentPlan,
    info: PaymentPlanTaxReceiptInfo | null,
  ) => {
    if (!canRetryTaxReceipt(payment, info)) return null;
    const planId = Number(payment.id);
    const isRetrying = retryingTaxReceiptPlanIds.has(planId);
    return (
      <button
        type="button"
        className="btn btn-ghost btn-xs btn-square min-h-0 h-7 w-7 text-red-600 hover:bg-red-50"
        title="Retry tax receipt and confirmation email"
        aria-label="Retry tax receipt and confirmation email"
        disabled={isRetrying}
        onClick={(e) => {
          e.stopPropagation();
          void handleRetryTaxReceipt(payment);
        }}
      >
        <ArrowPathIcon className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden />
      </button>
    );
  };

  const renderTaxReceiptCell = (payment: PaymentPlan) => {
    const info = getTaxReceiptForPlan(payment);
    const paidViaLink = isPaidViaPaymentLink(payment);

    if (info?.payper_invoice_link?.trim()) {
      return (
        <a
          href={info.payper_invoice_link}
          target="_blank"
          rel="noopener noreferrer"
          className={`${getExistingProformaBtnClass(!!payment.paid)} inline-flex max-w-[140px] truncate`}
          title={
            info.payper_invoice_number
              ? `Tax receipt #${info.payper_invoice_number}`
              : 'View tax receipt'
          }
          onClick={(e) => e.stopPropagation()}
        >
          {info.payper_invoice_number ? `#${info.payper_invoice_number}` : 'View receipt'}
        </a>
      );
    }

    if (!paidViaLink && !info?.payper_invoice_status) {
      return <span className="text-slate-400">—</span>;
    }

    const status = info?.payper_invoice_status;
    if (status === 'success') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          <CheckIcon className="h-4 w-4" aria-hidden />
          Sent
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          <ClockIcon className="h-4 w-4" aria-hidden />
          Pending
        </span>
      );
    }
    if (status === 'failed' || status === 'skipped_no_email') {
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
            <XMarkIcon className="h-4 w-4" aria-hidden />
            Failed
          </span>
          {renderTaxReceiptRetryButton(payment, info)}
        </span>
      );
    }

    if (paidViaLink) {
      return (
        <span className="inline-flex items-center gap-0.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
            Not sent
          </span>
          {renderTaxReceiptRetryButton(payment, info)}
        </span>
      );
    }

    return <span className="text-slate-400">—</span>;
  };

  const renderPaymentPickCell = (payment: PaymentPlan) => {
    if (!paymentRowPickMode) return null;

    const key = paymentPlanSelectionKey(payment);
    const selected = isPaymentRowSelectedForPick(payment);
    const disabled = isPaymentRowPickDisabled(payment);

    return (
      <td className="w-10 px-2 py-4 align-middle" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="checkbox checkbox-sm checkbox-primary"
          checked={selected}
          disabled={disabled}
          onChange={() => togglePaymentRowPick(payment)}
          aria-label={
            paymentRowPickMode === 'send-invoice'
              ? 'Select for invoice send'
              : 'Select for invoice automation'
          }
        />
      </td>
    );
  };

  const renderAutomationSelectCell = (payment: PaymentPlan) => renderPaymentPickCell(payment);

  const automationActiveCountForContact = (contactName: string) =>
    financePlan?.payments.filter(
      (p) => p.client === contactName && p.invoice_send_automation_active && !p.invoice_send_automation_sent_at,
    ).length ?? 0;

  const renderPaymentRowActions = (p: PaymentPlan, isPaid: boolean) => {
    if (!p.id) return <span className="text-slate-400">—</span>;

    const renderAdminMenuItems = () => {
      if (!showPaymentAdminMenu(p, isPaid)) return null;
      const shouldShowSentToFinance = p.isLegacy
        ? !(p as any).original_due_date
        : !p.ready_to_pay;
      return (
        <>
          {shouldShowSentToFinance ? (
            <li>
              <button
                type="button"
                className="text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSentToFinance(p);
                  setOpenDropdownPaymentId(null);
                }}
              >
                Sent to Finance
              </button>
            </li>
          ) : null}
          <li>
            <button
              type="button"
              className="text-sm text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Are you sure you want to revert this payment from paid status?')) {
                  handleRevertMarkedAsPaid(p);
                  setOpenDropdownPaymentId(null);
                }
              }}
            >
              Revert Marked as Paid
            </button>
          </li>
        </>
      );
    };

    const hasPaidRowMenu =
      showPaymentAdminMenu(p, isPaid)
      || showPaymentEditButton(p, isPaid)
      || showPaymentDeleteButton(p, isPaid);

    if (isPaid && hasPaidRowMenu) {
      return (
        <div
          className="flex items-center justify-end"
          style={{ overflow: 'visible', position: 'relative' }}
        >
          <button
            type="button"
            ref={(el) => {
              dropdownButtonRefs.current[p.id] = el;
            }}
            className="btn btn-ghost btn-sm btn-circle min-h-9 min-w-9 h-9 w-9 text-emerald-800 hover:bg-emerald-50"
            title="Payment actions"
            aria-label="Payment actions"
            onClick={(e) => {
              e.stopPropagation();
              setOpenDropdownPaymentId(openDropdownPaymentId === p.id ? null : p.id);
            }}
          >
            <EllipsisVerticalIcon className="h-5 w-5" />
          </button>
          <AnchorDropdownPortal
            anchorId={openDropdownPaymentId === p.id ? p.id : null}
            buttonRefs={dropdownButtonRefs}
            open={openDropdownPaymentId === p.id}
            onClose={() => setOpenDropdownPaymentId(null)}
          >
            <ul className="menu w-52 rounded-box border border-gray-200 bg-base-100 p-2 shadow-lg">
              {renderAdminMenuItems()}
              {showPaymentEditButton(p, isPaid) ? (
                <li>
                  <button
                    type="button"
                    className="text-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditPayment(p);
                      setOpenDropdownPaymentId(null);
                    }}
                  >
                    {isPaidViaPaymentLink(p) && !isSuperuser ? 'Edit notes' : 'Edit'}
                  </button>
                </li>
              ) : null}
              {showPaymentDeleteButton(p, isPaid) ? (
                <li>
                  <button
                    type="button"
                    className="text-sm text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePayment(p);
                      setOpenDropdownPaymentId(null);
                    }}
                  >
                    Delete
                  </button>
                </li>
              ) : null}
            </ul>
          </AnchorDropdownPortal>
        </div>
      );
    }

    return (
      <div
        className="flex items-center justify-end gap-2"
        style={{ overflow: 'visible', position: 'relative' }}
      >
        {paymentRowHasProforma(p) && !isPaid && (
          <button
            type="button"
            className={`${paymentRowIconBtn} border-blue-300 bg-blue-100 text-blue-700 hover:bg-blue-200`}
            title="Generate Payment Link"
            onClick={() => handleGeneratePaymentLink(p)}
          >
            <LinkIcon className="h-5 w-5" />
          </button>
        )}
        {!isPaid && !p.ready_to_pay && (
          <button
            type="button"
            className={`${paymentRowIconBtn} border-yellow-300 bg-yellow-100 text-yellow-700 hover:bg-yellow-200`}
            title="Mark as Ready to Pay"
            onClick={() => handleMarkAsReadyToPay(p)}
          >
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        )}
        {!isPaid && p.ready_to_pay && (
          <div
            className="tooltip tooltip-top z-[9999]"
            data-tip={
              p.ready_to_pay_by_display_name
                ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert`
                : 'Ready to pay - Click to revert'
            }
          >
            <button
              type="button"
              className={`${paymentRowIconBtn} border-red-300 bg-red-100 text-red-700 hover:bg-red-200`}
              title={
                p.ready_to_pay_by_display_name
                  ? `Marked by ${p.ready_to_pay_by_display_name} - Click to revert`
                  : 'Revert Ready to Pay'
              }
              onClick={() => handleRevertReadyToPay(p)}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        )}
        {!isPaid && (isSuperuser || isCollection) && (
          <button
            type="button"
            className={`${paymentRowIconBtn} border-green-300 bg-green-100 text-green-700 hover:bg-green-200`}
            title={p.isLegacy ? 'Mark Legacy Payment as Paid' : 'Mark as Paid'}
            onClick={() => handleOpenPaidDateModal(p.id)}
          >
            <CurrencyDollarIcon className="h-5 w-5" />
          </button>
        )}
        {showPaymentEditButton(p, isPaid) && (
          <button
            type="button"
            className={`${paymentRowIconBtn} border-none bg-gray-100 text-primary hover:bg-gray-200`}
            title={isPaidViaPaymentLink(p) && !isSuperuser ? 'Edit notes' : 'Edit'}
            onClick={() => handleEditPayment(p)}
          >
            <PencilIcon className="h-5 w-5" />
          </button>
        )}
        {showPaymentDeleteButton(p, isPaid) && (
          <button
            type="button"
            className={`${paymentRowIconBtn} border-none bg-red-100 text-red-500 hover:bg-red-200`}
            title="Delete"
            onClick={() => handleDeletePayment(p)}
          >
            <TrashIcon className="h-5 w-5" />
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="overflow-x-auto w-full p-2 sm:p-4 md:p-6">
        <ClientTabPageHeader
          icon={BanknotesIcon}
          title="Finances"
          subtitle="Payment plans and collections"
        />
        {/* Contract Information Section */}
        {/* COMMENTED OUT - Contract Information Section
        {contracts.length > 0 ? (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <DocumentTextIcon className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Contract Information</h3>
                      <p className="text-gray-500 text-sm">Active contracts and details</p>
                    </div>
                  </div>
                  {!hideTimelineHistory && (
                    <button 
                      className="btn btn-sm btn-outline"
                      onClick={refreshAllData}
                      title="Refresh data"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Refresh
                    </button>
                  )}
                </div>
              </div>
              
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {contracts.map((contract) => (
                    <div key={contract.id} className="group relative bg-white rounded-xl p-6 border border-gray-200 hover:border-purple-300 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02]">
                      <div className="absolute top-4 right-4">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
                          contract.status === 'signed' 
                            ? 'bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white border-none shadow-sm' 
                            : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                        }`}>
                          {contract.status === 'signed' ? 'Signed' : 'Draft'}
                        </span>
                      </div>
                      
                      <div className="mb-4">
                        <h4 className="text-lg font-bold text-gray-900 mb-1">
                          {contract.contract_templates?.name || 'Contract'}
                        </h4>
                        {(contract.contact_id || contract.isLegacy) && (
                          <p className="text-sm text-purple-600 font-medium mb-1">
                            {contract.isLegacy ? (contract.contact_name || client.name || 'Legacy Client') : getContactName(contract.contact_id, contract)}
                          </p>
                        )}
                        <div className="w-12 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"></div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-500">Applicants</span>
                          <span className="text-sm font-bold text-gray-900">
                            {contract.isLegacy ? contract.applicant_count : contract.applicant_count}
                          </span>
                        </div>
                        {contract.isLegacy && contract.cost_per_applicant > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-500">Cost per Applicant</span>
                            <span className="text-sm font-bold text-gray-900">
                              {getCurrencySymbol(client?.balance_currency)}{contract.cost_per_applicant.toLocaleString()}
                            </span>
                          </div>
                        )}
                        
                        {(contract.total_amount || contract.isLegacy) && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Total Amount</span>
                            <span className="text-lg font-bold text-purple-700">
                              {contract.isLegacy ? (
                                contract.total_amount > 0 ? (
                                  <>
                                    {getCurrencySymbol(client?.balance_currency)}{contract.total_amount.toLocaleString()}
                                  </>
                                ) : (
                                  financePlan ? (
                                    <>
                                      {getCurrencySymbol(financePlan.payments[0]?.currency || client?.balance_currency)}
                                      {financePlan.total.toLocaleString()}
                                    </>
                                  ) : (
                                    'N/A'
                                  )
                                )
                              ) : (
                                <>
                                  {getCurrencySymbol(contract.client_country)}{contract.total_amount.toLocaleString()}
                                </>
                              )}
                            </span>
                          </div>
                        )}
                        
                        {(contract.signed_at || (contract.isLegacy && contract.status === 'signed')) && (
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-sm font-medium text-gray-500">Signed Date</span>
                            <span className="text-sm font-bold text-gray-900">
                              {contract.signed_at ? 
                                new Date(contract.signed_at).toLocaleDateString('en-GB') : 
                                '---'
                              }
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-8">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <DocumentTextIcon className="w-6 h-6 text-purple-600" />
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">Contract Information</h3>
                      <p className="text-gray-500 text-sm">Active contracts and details</p>
                    </div>
                  </div>
                  {!hideTimelineHistory && (
                    <button 
                      className="btn btn-sm btn-outline"
                      onClick={refreshAllData}
                      title="Refresh data"
                    >
                      <ArrowPathIcon className="w-4 h-4" />
                      Refresh
                    </button>
                  )}
                </div>
              </div>
              
              <div className="p-12 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
                  <DocumentTextIcon className="w-10 h-10 text-gray-400" />
                </div>
                <h4 className="text-lg font-bold text-gray-800 mb-2">No Contracts Found</h4>
                <p className="text-gray-500 mb-4">This client doesn't have any contracts yet.</p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-sm text-blue-800">
                    💡 <strong>Tip:</strong> Create a contract in the Contact Info tab to see it displayed here.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        */}

        {/* Payments Plan Section */}
        <div className="mb-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <BanknotesIconSolid className="h-6 w-6 text-slate-800" />
                  <h3 className="text-xl font-bold text-slate-900">Payments Plan</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {financePlan && client?.balance !== total && (
                    <button
                      type="button"
                      className="btn btn-sm rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
                      onClick={() => updateClientBalance(total)}
                      title="Sync client balance with finance plan total"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      <span className="ml-1 hidden md:inline">Sync balance</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
                    onClick={() => setViewMode(viewMode === 'table' ? 'boxes' : 'table')}
                    title={viewMode === 'table' ? 'Switch to Box View' : 'Switch to Table View'}
                  >
                    {viewMode === 'table' ? (
                      <Squares2X2Icon className="h-4 w-4" />
                    ) : (
                      <Bars3Icon className="h-4 w-4" />
                    )}
                    <span className="ml-1 hidden md:inline">{viewMode === 'table' ? 'Box view' : 'Table view'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm rounded-xl border border-primary bg-white text-primary hover:bg-primary/5"
                    onClick={() => {
                      handleOpenStagesDrawer();
                    }}
                    title="Create a new payment plan"
                  >
                    <PlusIcon className="h-4 w-4" />
                    <span className="ml-1 hidden md:inline">New Payment Plan</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
                    onClick={() => setShowPaymentHistoryModal(true)}
                    title="View payment history for all contacts of this lead"
                  >
                    <ClockIcon className="h-4 w-4" />
                    <span className="ml-1 hidden md:inline">Payment History</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm rounded-xl normal-case ${
                      sendInvoiceSelectMode
                        ? 'btn-primary'
                        : 'border border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      if (sendInvoiceSelectMode) {
                        exitSendInvoiceSelectMode();
                      } else {
                        enterSendInvoiceSelectMode();
                      }
                    }}
                    title="Send invoice by email and WhatsApp"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                    <span className="ml-1 hidden md:inline">Send invoice</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm rounded-xl normal-case ${
                      invoiceAutomationSelectMode
                        ? 'btn-primary'
                        : 'border border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      if (invoiceAutomationSelectMode) {
                        exitInvoiceAutomationSelectMode();
                      } else {
                        enterInvoiceAutomationSelectMode();
                      }
                    }}
                    title="Schedule automatic invoice send on due date"
                  >
                    <ClockIcon className="h-4 w-4" />
                    <span className="ml-1 hidden md:inline">Auto invoice</span>
                  </button>
                </div>
          </div>

          <PaymentPlanSummaryCards
            summary={planSummary}
            getCurrencySymbol={getCurrencySymbol}
            contractTotalNis={contractTotalNisDisplay}
            expenseNoVatNis={expenseNoVatNisDisplay}
            outstandingNis={outstandingNisDisplay}
            activeFilter={paymentSummaryFilter}
            onFilterToggle={togglePaymentSummaryFilter}
          />

          {paymentSummaryFilter ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-sm text-slate-700">
                Showing{' '}
                <span className="font-semibold text-slate-900">
                  {PAYMENT_PLAN_SUMMARY_FILTER_LABELS[paymentSummaryFilter]}
                </span>{' '}
                payments only
              </p>
              <button
                type="button"
                className="btn btn-xs btn-ghost gap-1 text-slate-600"
                onClick={() => setPaymentSummaryFilter(null)}
              >
                <XMarkIcon className="h-4 w-4" />
                Clear filter
              </button>
            </div>
          ) : null}

          {!hasVisibleFilteredPayments ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-slate-500">
              No payments match the selected filter.
            </div>
          ) : null}

          {/* One white card per contact payment plan */}
          {hasVisibleFilteredPayments && (() => {
                // Group payments by client name
                const paymentsByContact = financePlan.payments.reduce((acc: { [key: string]: PaymentPlan[] }, payment: PaymentPlan) => {
                  const contactName = payment.client;
                  if (!acc[contactName]) {
                    acc[contactName] = [];
                  }
                  acc[contactName].push(payment);
                  return acc;
                }, {});

                return (
                  <div className="space-y-12 pt-10">
                    {Object.entries(paymentsByContact).map(([contactName, payments], contactIndex) => {
                  // Sort this contact's payments by due date (or fallback to original order if no due dates)
                  // Robust due date parsing and sorting
                  const parseDueDate = (dateStr: string | null | undefined) => {
                    if (!dateStr) return Infinity;
                    const d = new Date(dateStr);
                    return isNaN(d.getTime()) ? Infinity : d.getTime();
                  };
                  const sortedContactPayments = [...payments].sort((a, b) => {
                    const aTime = parseDueDate(a.dueDate);
                    const bTime = parseDueDate(b.dueDate);
                    return aTime - bTime;
                  });
                  const visibleContactPayments = paymentSummaryFilter
                    ? sortedContactPayments.filter((p) =>
                        paymentMatchesSummaryFilter(
                          p,
                          paymentSummaryFilter,
                          planSummary.nextDuePayment?.id,
                        ),
                      )
                    : sortedContactPayments;
                  if (paymentSummaryFilter && visibleContactPayments.length === 0) {
                    return null;
                  }
                  // Sorted payments for this contact
                  // Find the payment that should display the due date for this contact
                  const dueDatePayment = sortedContactPayments.find(p => {
                    const order = (p.order || '').toLowerCase();
                    return order.includes('first payment') || order.includes('archival') || p.duePercent === '100';
                  });
                  const dueDatePaymentId = dueDatePayment ? dueDatePayment.id : sortedContactPayments[0]?.id;
                  const contactAccentColor = getContactAccentColor(contactName);
                  return (
                    <div key={contactName} className="space-y-2">
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="px-6 py-4">
                      {/* Contact Header */}
                      <div>
                        <ContactPlanHeader
                          contactName={contactName}
                          payments={sortedContactPayments}
                          collapsed={!!collapsedContacts[contactName]}
                          onToggle={() =>
                            setCollapsedContacts((prev) => ({ ...prev, [contactName]: !prev[contactName] }))
                          }
                          totalNis={contactTotalNisByName[contactName]}
                          profileImageUrl={resolveContactProfileImageUrl(
                            contactName,
                            sortedContactPayments[0]?.client_id,
                          )}
                          automationActiveCount={automationActiveCountForContact(contactName)}
                          onPaymentHistoryClick={() => fetchPaymentHistory(contactName)}
                          paymentHistoryActive={openHistoryContact === contactName}
                        />
                        {openHistoryContact === contactName && (
                          <div className="bg-base-100 rounded-lg shadow p-4 mt-3">
                            <h4 className="font-semibold mb-2">Payment History</h4>
                            {paymentHistory[contactName]?.length ? (
                              <table className="table w-full text-sm">
                                <thead>
                                  <tr>
                                    <th>Date</th>
                                    <th>Amount</th>
                                    <th>Method</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {paymentHistory[contactName].map((tx, idx) => (
                                    <tr key={tx.id || idx}>
                                      <td>{tx.created_at ? new Date(tx.created_at).toLocaleString() : ''}</td>
                                      <td>{tx.amount ? `₪${tx.amount.toLocaleString()}` : ''}</td>
                                      <td>{tx.payment_method || ''}</td>
                                      <td>{tx.status || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <div className="text-gray-500">No payment history found.</div>
                            )}
                          </div>
                        )}
                      </div>
                        </div>
                      </div>

                      {/* Table or Box view for this contact */}
                      {!collapsedContacts[contactName] && (
                        <>
                          {viewMode === 'table' ? (
                            <div
                              className="finances-payments-table-shell overflow-x-auto rounded-[18px] bg-[#f3f4f6] px-3 pb-3 pt-1"
                              style={{ '--contact-accent': contactAccentColor } as React.CSSProperties}
                            >
                              <table className="finances-payments-table w-full min-w-[960px] text-sm">
                                <thead>
                                  <tr className="text-xs font-semibold uppercase tracking-wider text-base-content/40">
                                    {paymentRowPickMode && (
                                      <th className="w-10 px-2 py-3.5" aria-label="Select" />
                                    )}
                                    <th className="px-4 py-3.5 text-left">Status</th>
                                    <th className="px-4 py-3.5 text-left">Due date</th>
                                    <th className="px-4 py-3.5 text-right">Value</th>
                                    <th className="px-4 py-3.5 text-right">VAT</th>
                                    <th className="px-4 py-3.5 text-right">Total</th>
                                    <th className="px-4 py-3.5 text-left">Payment date</th>
                                    <th className="px-4 py-3.5 text-left">Type</th>
                                    <th className="px-4 py-3.5 text-left">Proforma</th>
                                    <th className="px-4 py-3.5 text-left">Tax receipt</th>
                                    <th className="px-4 py-3.5 text-left">Notes</th>
                                    <th className="px-4 py-3.5 text-right">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleContactPayments.map((p: PaymentPlan, idx: number) => {
                                    const isPaid = !!p.paid;
                                    const rowSelectable = Boolean(paymentRowPickMode);
                                    return (
                                      <tr
                                        key={p.id || idx}
                                        className={`finance-payment-row${isPaid ? ' finance-payment-row-paid' : ''}${
                                          rowSelectable ? ' finance-payment-row-selectable cursor-pointer' : ''
                                        }${
                                          isPaymentRowSelectedForPick(p) ? ' finance-payment-row-picked' : ''
                                        }`}
                                        onClick={
                                          rowSelectable
                                            ? () => togglePaymentRowPick(p)
                                            : undefined
                                        }
                                      >
                                        {renderAutomationSelectCell(p)}
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <PaymentStatusPill paid={isPaid} readyToPay={p.ready_to_pay} />
                                            <span className="text-xs text-slate-400">{p.duePercent}</span>
                                            {renderInvoiceAutomationBadge(p)}
                                          </div>
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          {isPaid ? (
                                            <span className="text-sm font-semibold text-slate-900">
                                              {formatDateDDMMYYYY(p.dueDate) || '—'}
                                            </span>
                                          ) : (
                                            <DueDateBadge
                                              date={p.dueDate}
                                              readyToPay={p.ready_to_pay}
                                              matchStatus
                                            />
                                          )}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right font-semibold text-slate-900">
                                          {getCurrencySymbol(p.currency)}
                                          {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right text-slate-500">
                                          {getCurrencySymbol(p.currency)}
                                          {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right font-bold text-slate-900">
                                          {getCurrencySymbol(p.currency)}
                                          {(p.value + p.valueVat).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-slate-600">
                                          {p.paid_at ? (
                                            isPaid ? (
                                              <PaidPaymentDateBadge date={p.paid_at} />
                                            ) : (
                                              formatDateDDMMYYYY(p.paid_at)
                                            )
                                          ) : (
                                            '---'
                                          )}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap font-medium text-slate-700">
                                          {p.order}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          {p.isLegacy ? (
                                            // For legacy leads, show proforma if available
                                            (() => {
                                              // For legacy leads, try to match proformas with specific payment rows
                                              // Only show proformas that are specifically linked to this payment row
                                              const paymentProformas = legacyProformas.filter(proforma =>
                                                proforma.ppr_id === p.id
                                              );

                                              if (paymentProformas.length > 0) {
                                                return (
                                                  <div className="flex flex-col gap-1">
                                                    {paymentProformas.slice(0, 2).map((proforma, idx) => (
                                                      <button
                                                        key={proforma.id}
                                                        className={getExistingProformaBtnClass(isPaid)}
                                                        title={`View Proforma ${proforma.id}`}
                                                        onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/${proforma.id}`); }}
                                                      >
                                                        {proforma.id}
                                                      </button>
                                                    ))}
                                                    {paymentProformas.length > 2 && (
                                                      <span className="text-xs text-gray-500">+{paymentProformas.length - 2} more</span>
                                                    )}
                                                  </div>
                                                );
                                              } else {
                                                return (
                                                  <button
                                                    className={createProformaBtnClass}
                                                    title="Create Proforma"
                                                    onClick={e => {
                                                      e.preventDefault();
                                                      const clientId = p.client_id ? `&client_id=${p.client_id}` : '';
                                                      navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}${clientId}`);
                                                    }}
                                                  >
                                                    + Create
                                                  </button>
                                                );
                                              }
                                            })()
                                          ) : p.proforma && p.proforma.trim() !== '' ? (
                                            <button
                                              type="button"
                                              className={getExistingProformaBtnClass(isPaid)}
                                              title="View Proforma"
                                              onClick={e => { e.preventDefault(); navigate(`/proforma/${p.id}`); }}
                                            >
                                              {getProformaName(p.proforma)}
                                            </button>
                                          ) : (
                                            <button
                                              type="button"
                                              className={createProformaBtnClass}
                                              title="Create Proforma"
                                              onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                            >
                                              + Create
                                            </button>
                                          )}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          {renderTaxReceiptCell(p)}
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap max-w-[180px]">
                                          <button
                                            type="button"
                                            onClick={() => handleOpenNotesModal(p)}
                                            className="block w-full truncate text-left text-sm text-slate-700 hover:text-indigo-600"
                                            title={p.notes || 'Click to add notes'}
                                            dir={getNotesTextDirection(p.notes)}
                                            style={{ textAlign: getNotesTextDirection(p.notes) === 'rtl' ? 'right' : 'left' }}
                                          >
                                            {p.notes && p.notes.length > 20
                                              ? `${p.notes.substring(0, 20)}...`
                                              : p.notes || '---'}
                                          </button>
                                        </td>
                                        <td
                                          className="relative min-w-[200px] px-4 py-4 align-middle"
                                          onClick={(e) => paymentRowPickMode && e.stopPropagation()}
                                        >
                                          {renderPaymentRowActions(p, isPaid)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                  {addingPaymentContact === contactName && (
                                    viewMode === 'table' ? (
                                      <tr key={`new-payment-${contactName}`} className="finance-payment-row finance-payment-row-new">
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                                            New
                                          </span>
                                          <input
                                            type="number"
                                            className="input input-bordered input-xs mt-2 w-16 text-center"
                                            value={newPaymentData.duePercent}
                                            onChange={e => setNewPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))}
                                            placeholder="%"
                                          />
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          <input type="date" className="input input-bordered input-sm w-40" value={newPaymentData.dueDate} onChange={e => {
                                            const newDueDate = e.target.value;
                                            setNewPaymentData((d: any) => {
                                              const vatRate = getVatRateForLegacyLead(newDueDate);
                                              const vat = (isNisCurrency({ currency: d.currency, currencyId: d.currencyId }) && d.includeVat !== false) ? Math.round(Number(d.value || 0) * vatRate * 100) / 100 : 0;
                                              return { ...d, dueDate: newDueDate, valueVat: vat };
                                            });
                                          }} />
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right">
                                          <input type="number" className="input input-bordered input-sm w-28 text-right no-arrows" value={newPaymentData.value} onChange={e => {
                                            const value = e.target.value;
                                            let vat = 0;
                                            const currency = newPaymentData.currency || '₪';
                                            const includeVat = newPaymentData.includeVat !== false;
                                            if (isNisCurrency({ currency, currencyId: newPaymentData.currencyId }) && includeVat) {
                                              const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                              vat = Math.round(Number(value) * vatRate * 100) / 100;
                                            }
                                            const totalAmount = getTotalAmount();
                                            const duePercent = totalAmount > 0 ? Math.round((Number(value) / totalAmount) * 100) : 0;
                                            setNewPaymentData((d: any) => ({ ...d, value, valueVat: vat, duePercent }));
                                          }} />
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right">
                                          <input type="number" className="input input-bordered input-sm w-24 cursor-not-allowed bg-slate-50 text-right text-slate-500 no-arrows" value={newPaymentData.valueVat || 0} readOnly />
                                        </td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap text-right font-bold text-slate-900">
                                          {getCurrencySymbol(newPaymentData.currency || '₪')}
                                          {(Number(newPaymentData.value || 0) + Number(newPaymentData.valueVat || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-4 align-middle text-slate-400">—</td>
                                        <td className="px-4 py-4 align-middle whitespace-nowrap">
                                          <select
                                            className="select select-bordered select-sm w-full max-w-[180px]"
                                            value={newPaymentData.paymentOrder}
                                            onChange={e => setNewPaymentData((d: any) => ({ ...d, paymentOrder: e.target.value }))}
                                          >
                                            <option value="First Payment">First Payment</option>
                                            <option value="Intermediate Payment">Intermediate Payment</option>
                                            <option value="Final Payment">Final Payment</option>
                                            <option value="Single Payment">Single Payment</option>
                                            <option value="Expense (no VAT)">Expense (no VAT)</option>
                                          </select>
                                        </td>
                                        <td className="px-4 py-4 align-middle text-slate-400">—</td>
                                        <td className="px-4 py-4 align-middle text-slate-400">—</td>
                                        <td className="px-4 py-4 align-middle">
                                          <input className="input input-bordered input-sm mb-2 w-full max-w-[180px]" value={newPaymentData.notes} onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))} placeholder="Notes" />
                                          <div className="flex flex-wrap items-center gap-2">
                                            <select
                                              className="select select-bordered select-xs w-20"
                                              value={newPaymentData.currency || '₪'}
                                              onChange={e => {
                                                const selectedCurrency = e.target.value;
                                                const selectedCurrencyData = findAccountingCurrency(selectedCurrency, null, availableCurrencies)
                                                  ?? availableCurrencies.find(c => c.name === selectedCurrency);
                                                let vat = 0;
                                                const selectedIsNis = isNisCurrency({
                                                  currency: selectedCurrency,
                                                  currencyId: selectedCurrencyData?.id,
                                                });
                                                const includeVat = newPaymentData.includeVat !== false && selectedIsNis;
                                                if (selectedIsNis && includeVat) {
                                                  const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                                  vat = Math.round(Number(newPaymentData.value || 0) * vatRate * 100) / 100;
                                                }
                                                setNewPaymentData((d: any) => ({
                                                  ...d,
                                                  currency: selectedCurrency,
                                                  currencyId: selectedCurrencyData?.id || 1,
                                                  includeVat: selectedIsNis ? (d.includeVat !== false) : false,
                                                  valueVat: vat
                                                }));
                                              }}
                                            >
                                              {availableCurrencies.length === 0 ? (
                                                <>
                                                  <option value="₪">₪</option>
                                                  <option value="€">€</option>
                                                  <option value="$">$</option>
                                                  <option value="£">£</option>
                                                </>
                                              ) : (
                                                availableCurrencies.map((curr) => (
                                                  <option key={curr.id} value={curr.name}>{curr.name}</option>
                                                ))
                                              )}
                                            </select>
                                            <label className="label cursor-pointer gap-1 p-0">
                                              <input
                                                type="checkbox"
                                                className="checkbox checkbox-xs"
                                                checked={newPaymentData.includeVat !== false && isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })}
                                                disabled={!isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })}
                                                onChange={e => {
                                                  const includeVat = e.target.checked;
                                                  let vat = 0;
                                                  if (includeVat && isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })) {
                                                    const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                                    vat = Math.round(Number(newPaymentData.value || 0) * vatRate * 100) / 100;
                                                  }
                                                  setNewPaymentData((d: any) => ({ ...d, includeVat, valueVat: vat }));
                                                }}
                                              />
                                              <span className="label-text text-xs">VAT</span>
                                            </label>
                                          </div>
                                        </td>
                                        <td className="px-4 py-4 align-middle">
                                          <div className="flex justify-end gap-2">
                                            <button type="button" className="btn btn-sm rounded-xl bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleSaveNewPayment} disabled={isSavingPaymentRow || !newPaymentData.value || !newPaymentData.duePercent}>
                                              <CheckIcon className="h-4 w-4" />
                                            </button>
                                            <button type="button" className="btn btn-sm btn-ghost rounded-xl" onClick={handleCancelNewPayment}>
                                              <XMarkIcon className="h-4 w-4 text-red-500" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ) : (
                                      <div className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col gap-0 relative group min-h-[480px] mt-4">
                                        <div className="flex flex-col gap-0 divide-y divide-base-200">
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due %</span>
                                            <input
                                              type="number"
                                              className="input input-bordered w-20 text-center"
                                              value={newPaymentData.duePercent}
                                              onChange={e => setNewPaymentData((d: any) => ({ ...d, duePercent: e.target.value }))}
                                              placeholder="%"
                                            />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Due Date</span>
                                            {/* Only show due date input for the first payment row (idx === 0), else show disabled input */}
                                            {0 === 0 ? (
                                              <input
                                                type="date"
                                                className="input input-bordered w-48 text-right"
                                                value={newPaymentData.dueDate}
                                                onChange={e => {
                                                  const newDueDate = e.target.value;
                                                  setNewPaymentData((d: any) => {
                                                    const vatRate = getVatRateForLegacyLead(newDueDate);
                                                    const vat = (isNisCurrency({ currency: d.currency, currencyId: d.currencyId }) && d.includeVat !== false) ? Math.round(Number(d.value || 0) * vatRate * 100) / 100 : 0;
                                                    return { ...d, dueDate: newDueDate, valueVat: vat };
                                                  });
                                                }}
                                              />
                                            ) : (
                                              <input
                                                type="text"
                                                className="input input-bordered w-48 text-right bg-gray-100 text-gray-400"
                                                value={''}
                                                disabled
                                              />
                                            )}
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Value</span>
                                            <input type="number" className="input input-bordered input-lg w-32 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows" value={newPaymentData.value} onChange={e => {
                                              const value = e.target.value;
                                              let vat = 0;
                                              const currency = newPaymentData.currency || '₪';
                                              const includeVat = newPaymentData.includeVat !== false;
                                              if (isNisCurrency({ currency, currencyId: newPaymentData.currencyId }) && includeVat) {
                                                const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                                vat = Math.round(Number(value) * vatRate * 100) / 100;
                                              }
                                              const totalAmount = getTotalAmount();
                                              const duePercent = totalAmount > 0 ? Math.round((Number(value) / totalAmount) * 100) : 0;
                                              setNewPaymentData((d: any) => ({ ...d, value, valueVat: vat, duePercent }));
                                            }} />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VAT</span>
                                            <input type="number" className="input input-bordered input-lg w-28 text-right font-bold rounded-xl border-2 border-blue-300 no-arrows bg-gray-100 text-gray-500 cursor-not-allowed" value={newPaymentData.valueVat || 0} readOnly />
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Currency</span>
                                            <select
                                              className="select select-bordered w-full"
                                              value={newPaymentData.currency || '₪'}
                                              onChange={e => {
                                                const selectedCurrency = e.target.value;
                                                const selectedCurrencyData = findAccountingCurrency(selectedCurrency, null, availableCurrencies)
                                                  ?? availableCurrencies.find(c => c.name === selectedCurrency);
                                                let vat = 0;
                                                const selectedIsNis = isNisCurrency({
                                                  currency: selectedCurrency,
                                                  currencyId: selectedCurrencyData?.id,
                                                });
                                                const includeVat = newPaymentData.includeVat !== false && selectedIsNis;
                                                if (selectedIsNis && includeVat) {
                                                  const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                                  vat = Math.round(Number(newPaymentData.value || 0) * vatRate * 100) / 100;
                                                }
                                                setNewPaymentData((d: any) => ({
                                                  ...d,
                                                  currency: selectedCurrency,
                                                  currencyId: selectedCurrencyData?.id || 1,
                                                  includeVat: selectedIsNis ? (d.includeVat !== false) : false,
                                                  valueVat: vat
                                                }));
                                              }}
                                            >
                                              {availableCurrencies.length === 0 ? (
                                                <>
                                                  <option value="₪">₪ (ILS)</option>
                                                  <option value="€">€ (EUR)</option>
                                                  <option value="$">$ (USD)</option>
                                                  <option value="£">£ (GBP)</option>
                                                </>
                                              ) : (
                                                availableCurrencies.map((curr) => (
                                                  <option key={curr.id} value={curr.name}>{curr.name} ({curr.iso_code})</option>
                                                ))
                                              )}
                                            </select>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Include VAT</span>
                                            <label className="label cursor-pointer justify-end gap-2">
                                              <input
                                                type="checkbox"
                                                className="checkbox checkbox-sm"
                                                checked={newPaymentData.includeVat !== false && isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })}
                                                disabled={!isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })}
                                                onChange={e => {
                                                  const includeVat = e.target.checked;
                                                  let vat = 0;
                                                  if (includeVat && isNisCurrency({ currency: newPaymentData.currency, currencyId: newPaymentData.currencyId })) {
                                                    const vatRate = getVatRateForLegacyLead(newPaymentData.dueDate);
                                                    vat = Math.round(Number(newPaymentData.value || 0) * vatRate * 100) / 100;
                                                  }
                                                  setNewPaymentData((d: any) => ({ ...d, includeVat, valueVat: vat }));
                                                }}
                                              />
                                              <span className="label-text text-xs">Include VAT</span>
                                            </label>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Order</span>
                                            <select
                                              className="select select-bordered w-full"
                                              value={newPaymentData.paymentOrder}
                                              onChange={e => setNewPaymentData((d: any) => ({ ...d, paymentOrder: e.target.value }))}
                                            >
                                              <option value="First Payment">First Payment</option>
                                              <option value="Intermediate Payment">Intermediate Payment</option>
                                              <option value="Final Payment">Final Payment</option>
                                              <option value="Single Payment">Single Payment</option>
                                              <option value="Expense (no VAT)">Expense (no VAT)</option>
                                            </select>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                                            <input className="input input-bordered w-48 text-right" value={newPaymentData.notes} onChange={e => setNewPaymentData((d: any) => ({ ...d, notes: e.target.value }))} />
                                          </div>
                                          <div className="flex gap-2 justify-end pt-4">
                                            <button className="btn btn-xs btn-success" onClick={handleSaveNewPayment} disabled={isSavingPaymentRow || !newPaymentData.value || !newPaymentData.duePercent}>Save</button>
                                            <button className="btn btn-xs btn-ghost" onClick={handleCancelNewPayment}>Cancel</button>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  )}
                                </tbody>
                              </table>

                              {/* Add payment / delete plan (table view) */}
                              {!addingPaymentContact && (
                                <div className="mt-4 flex items-center justify-between gap-3">
                                  <button
                                    type="button"
                                    className="btn btn-sm rounded-xl border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => handleAddNewPayment(contactName)}
                                  >
                                    <PlusIcon className="h-4 w-4" />
                                    Add Payment
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-ghost rounded-xl text-red-500 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => handleDeletePaymentPlan(contactName)}
                                  >
                                    Delete Plan
                                  </button>
                                </div>
                              )}

                              {/* Total and Left to Plan Display - Below Payment Table */}
                              {addingPaymentContact === contactName && (
                                <div className="mt-6 p-6">
                                  <div className="flex flex-col md:flex-row gap-6 items-center justify-center">
                                    {/* Total Amount */}
                                    <div
                                      className="flex items-center gap-4 bg-white rounded-xl px-6 py-4 shadow-lg border border-purple-200 min-w-[200px] cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200"
                                      onClick={() => handleBoxClick('total')}
                                      title="Click to use full total amount"
                                    >
                                      <div className="flex flex-col items-center">
                                        <span className="text-base font-medium text-gray-600">Total Amount</span>
                                        <span className="text-2xl font-bold text-purple-600">
                                          {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}{getTotalAmount().toLocaleString()}
                                        </span>
                                      </div>
                                      <button
                                        className="btn btn-md bg-purple-600 text-white border-purple-600 hover:bg-purple-700 hover:border-purple-700 rounded-full px-4"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPercentageModal('total');
                                        }}
                                        title="Calculate percentage of total amount"
                                      >
                                        %
                                      </button>
                                    </div>

                                    {/* Left to Plan Amount */}
                                    <div
                                      className="flex items-center gap-4 bg-white rounded-xl px-6 py-4 shadow-lg border border-green-200 min-w-[200px] cursor-pointer hover:shadow-xl hover:scale-105 transition-all duration-200"
                                      onClick={() => handleBoxClick('leftToPlan')}
                                      title="Click to use left to plan amount"
                                    >
                                      <div className="flex flex-col items-center">
                                        <span className="text-base font-medium text-gray-600">Left to Plan</span>
                                        <span className="text-2xl font-bold text-green-600">
                                          {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}{getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined).toLocaleString()}
                                        </span>
                                      </div>
                                      <button
                                        className="btn btn-md btn-success rounded-full px-4"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openPercentageModal('leftToPlan');
                                        }}
                                        title="Calculate percentage of left to plan amount"
                                      >
                                        %
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-8">
                                {visibleContactPayments.map((p: PaymentPlan, idx: number) => {
                                  const isPaid = p.paid;
                                  const rowSelectable = Boolean(paymentRowPickMode);
                                  const selected = isPaymentRowSelectedForPick(p);
                                  return (
                                    <div
                                      key={p.id || idx}
                                      className={`finance-payment-row flex min-h-[420px] flex-col gap-0 rounded-2xl border border-l-4 border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:shadow-md ${
                                        isPaid ? 'finance-payment-row-paid' : ''
                                      } ${rowSelectable ? 'cursor-pointer' : ''} ${
                                        selected ? 'ring-2 ring-primary/50' : ''
                                      }`}
                                      style={{ borderLeftColor: contactAccentColor }}
                                      onClick={
                                        rowSelectable
                                          ? () => togglePaymentRowPick(p)
                                          : undefined
                                      }
                                    >
                                      <div className="mb-4 flex items-start justify-between gap-3">
                                        <div>
                                          <div className="flex flex-wrap items-center gap-2">
                                            {paymentRowPickMode && (
                                              <input
                                                type="checkbox"
                                                className="checkbox checkbox-sm checkbox-primary"
                                                checked={selected}
                                                disabled={isPaymentRowPickDisabled(p)}
                                                onChange={() => togglePaymentRowPick(p)}
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                            )}
                                            <PaymentStatusPill paid={!!isPaid} readyToPay={p.ready_to_pay} />
                                            {renderInvoiceAutomationBadge(p)}
                                          </div>
                                          <p className="mt-2 text-sm font-medium text-slate-700">{p.order}</p>
                                          <p className="text-xs text-slate-400">{p.duePercent}</p>
                                        </div>
                                        {p.proforma && !isPaid && (
                                          <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                            Due
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-col gap-0 divide-y divide-slate-100">

                                        {/* Payment details */}
                                        <div className="flex flex-col gap-0 divide-y divide-base-200">
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">DUE DATE</span>
                                            {isPaid ? (
                                            <span className="text-sm font-semibold text-slate-900">
                                              {formatDateDDMMYYYY(p.dueDate) || '—'}
                                            </span>
                                          ) : (
                                            <DueDateBadge
                                              date={p.dueDate}
                                              readyToPay={p.ready_to_pay}
                                              matchStatus
                                            />
                                          )}
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">VALUE</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {getCurrencySymbol(p.currency)}
                                              {p.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                              + {p.valueVat.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">TOTAL</span>
                                            <span className="text-sm font-bold text-gray-900">
                                              {getCurrencySymbol(p.currency)}
                                              {(p.value + p.valueVat).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">CLIENT</span>
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-bold text-gray-900">{p.client}</span>
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">PAYMENT DATE</span>
                                            <span className="text-sm text-gray-900">
                                              {p.paid_at ? (
                                                isPaid ? (
                                                  <PaidPaymentDateBadge date={p.paid_at} />
                                                ) : (
                                                  formatDateDDMMYYYY(p.paid_at)
                                                )
                                              ) : (
                                                '---'
                                              )}
                                            </span>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">PROFORMA</span>
                                            <div className="text-sm">
                                              {p.isLegacy ? (
                                                // For legacy leads, show proforma if available
                                                (() => {
                                                  // For legacy leads, try to match proformas with specific payment rows
                                                  // Only show proformas that are specifically linked to this payment row
                                                  const paymentProformas = legacyProformas.filter(proforma =>
                                                    proforma.ppr_id === p.id
                                                  );

                                                  if (paymentProformas.length > 0) {
                                                    return (
                                                      <div className="flex flex-col gap-1">
                                                        {paymentProformas.slice(0, 1).map((proforma, idx) => (
                                                          <button
                                                            key={proforma.id}
                                                            className={getExistingProformaBtnClass(!!isPaid)}
                                                            title={`View Proforma ${proforma.id}`}
                                                            onClick={e => { e.preventDefault(); navigate(`/proforma-legacy/${proforma.id}`); }}
                                                          >
                                                            {proforma.id}
                                                          </button>
                                                        ))}
                                                        {paymentProformas.length > 1 && (
                                                          <span className="text-xs text-gray-500">+{paymentProformas.length - 1} more</span>
                                                        )}
                                                      </div>
                                                    );
                                                  } else {
                                                    return (
                                                      <button
                                                        type="button"
                                                        className={createProformaBtnClass}
                                                        title="Create Proforma"
                                                        onClick={e => {
                                                          e.preventDefault();
                                                          const clientId = p.client_id ? `&client_id=${p.client_id}` : '';
                                                          navigate(`/proforma-legacy/create/${client.id.toString().replace('legacy_', '')}?ppr_id=${p.id}${clientId}`);
                                                        }}
                                                      >
                                                        + Create
                                                      </button>
                                                    );
                                                  }
                                                })()
                                              ) : p.proforma && p.proforma.trim() !== '' ? (
                                                <button
                                                  type="button"
                                                  className={getExistingProformaBtnClass(isPaid)}
                                                  title="View Proforma"
                                                  onClick={e => { e.preventDefault(); navigate(`/proforma/${p.id}`); }}
                                                >
                                                  {getProformaName(p.proforma)}
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  className={createProformaBtnClass}
                                                  title="Create Proforma"
                                                  onClick={e => { e.preventDefault(); navigate(`/proforma/create/${p.id}`); }}
                                                >
                                                  + Create
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">TAX RECEIPT</span>
                                            <div className="text-sm">{renderTaxReceiptCell(p)}</div>
                                          </div>
                                          <div className="flex items-center justify-between py-3">
                                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">NOTES</span>
                                            <button
                                              onClick={() => handleOpenNotesModal(p)}
                                              className="text-sm font-bold text-gray-900 hover:text-indigo-600 transition-colors cursor-pointer max-w-[200px] truncate"
                                              title={p.notes || 'Click to add notes'}
                                              dir={getNotesTextDirection(p.notes)}
                                              style={{ textAlign: getNotesTextDirection(p.notes) === 'rtl' ? 'right' : 'left' }}
                                            >
                                              {p.notes && p.notes.length > 20
                                                ? `${p.notes.substring(0, 20)}...`
                                                : p.notes || '---'}
                                            </button>
                                          </div>
                                        </div>

                                        <div className="mt-4 border-t border-slate-100 pt-4">
                                          {renderPaymentRowActions(p, !!isPaid)}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {!addingPaymentContact && (
                                <div className="mt-4 flex items-center justify-between gap-3">
                                  <button
                                    type="button"
                                    className="btn btn-sm rounded-xl border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => handleAddNewPayment(contactName)}
                                  >
                                    <PlusIcon className="h-4 w-4" />
                                    Add Payment
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-ghost rounded-xl text-red-500 hover:bg-red-50 hover:text-red-600"
                                    onClick={() => handleDeletePaymentPlan(contactName)}
                                  >
                                    Delete Plan
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
                  </div>
                );
              })()}

          {/* Deleted Payments Section */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex cursor-pointer items-center gap-3 p-4 transition-all duration-200 hover:bg-slate-50" onClick={() => {
                  setShowDeletedPayments(!showDeletedPayments);
                  if (!showDeletedPayments) {
                    fetchDeletedPayments();
                  }
                }}>
                  <div className="flex items-center gap-2">
                    <TrashIcon className="w-5 h-5 text-orange-500" />
                    <h4 className="text-lg font-bold text-gray-800">Deleted Payments</h4>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-sm text-gray-500">{deletedPayments.length} deleted payment{deletedPayments.length !== 1 ? 's' : ''}</span>
                    <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${showDeletedPayments ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {showDeletedPayments && (
                  <div className="border-t border-slate-200 p-6">

                    {deletedPayments.length > 0 ? (
                      <div className="bg-white rounded-xl overflow-x-auto">
                        <table className="min-w-full rounded-xl overflow-hidden">
                          <thead className="bg-base-200 sticky top-0 z-10">
                            <tr>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Due %</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Due Date</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Value</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Total</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Contact</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Payment Date</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Order</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Proforma</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Notes</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Deleted Date</th>
                              <th className="px-4 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {deletedPayments.map((p: any, idx: number) => (
                              <tr
                                key={p.id || idx}
                                className="bg-red-50 border-l-4 border-red-400 hover:bg-red-100 rounded-xl shadow-sm transition-all duration-200"
                                style={{
                                  verticalAlign: 'middle',
                                  position: 'relative'
                                }}
                              >
                                {/* Due % */}
                                <td className="font-bold text-lg align-middle text-center px-4 py-3 whitespace-nowrap">
                                  {p.due_percent || p.duePercent}
                                </td>

                                {/* Due Date */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <span className="text-sm font-bold text-gray-900">
                                    {formatDateDDMMYYYY(p.date || p.due_date)}
                                  </span>
                                </td>

                                {/* Value */}
                                <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <span className="text-sm font-bold text-gray-900">
                                    {(() => {
                                      const isLegacyPayment = p.accounting_currencies;
                                      const currency = isLegacyPayment
                                        ? p.accounting_currencies?.iso_code || '₪'
                                        : p.currency || '₪';
                                      const vatValue = isLegacyPayment ? p.vat_value : p.value_vat;

                                      return (
                                        <>
                                          {getCurrencySymbol(currency)}{Number(p.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                          + {Number(vatValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </>
                                      );
                                    })()}
                                  </span>
                                </td>

                                {/* Total */}
                                <td className="font-bold align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <span className="text-sm font-bold text-gray-900">
                                    {(() => {
                                      const isLegacyPayment = p.accounting_currencies;
                                      const currency = isLegacyPayment
                                        ? p.accounting_currencies?.iso_code || '₪'
                                        : p.currency || '₪';
                                      const vatValue = isLegacyPayment ? p.vat_value : p.value_vat;

                                      return (
                                        <>
                                          {getCurrencySymbol(currency)}{(Number(p.value || 0) + Number(vatValue || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </>
                                      );
                                    })()}
                                  </span>
                                </td>

                                {/* Contact */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-2">
                                    <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-pink-600 rounded-full flex items-center justify-center">
                                      <UserIcon className="w-3 h-3 text-white" />
                                    </div>
                                    <div className="text-left">
                                      <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                                        {p.client || p.client_name}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {/* Payment Date */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  {p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '---'}
                                </td>

                                {/* Order */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  {p.order ? getOrderText(p.order) : p.payment_order ? getOrderText(p.payment_order) : '---'}
                                </td>

                                {/* Proforma */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  {p.proforma && p.proforma.trim() !== '' ? (
                                    <span className="text-sm text-gray-600 line-through">
                                      {p.proforma}
                                    </span>
                                  ) : (
                                    <span className="text-sm text-gray-400">---</span>
                                  )}
                                </td>

                                {/* Notes */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <button
                                    onClick={() => handleOpenNotesModal(p)}
                                    className="text-sm text-gray-700 hover:text-indigo-600 transition-colors cursor-pointer max-w-[200px] truncate block mx-auto"
                                    title={p.notes || 'Click to add notes'}
                                    dir={getNotesTextDirection(p.notes)}
                                    style={{ textAlign: getNotesTextDirection(p.notes) === 'rtl' ? 'right' : 'left' }}
                                  >
                                    {p.notes && p.notes.length > 20
                                      ? `${p.notes.substring(0, 20)}...`
                                      : p.notes || '---'}
                                  </button>
                                </td>

                                {/* Deleted Date */}
                                <td className="align-middle text-center px-4 py-3 whitespace-nowrap">
                                  <span className="text-sm font-medium text-red-600">
                                    {p.cancel_date ? new Date(p.cancel_date).toLocaleDateString() : '---'}
                                  </span>
                                </td>

                                {/* Actions */}
                                <td className="flex gap-2 justify-end align-middle min-w-[80px] px-4 py-3">
                                  <button
                                    className="btn btn-xs btn-success"
                                    onClick={() => handleRestorePayment(p.id)}
                                    title="Restore this payment"
                                  >
                                    <ArrowUturnLeftIcon className="w-3 h-3" />
                                    Restore
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <TrashIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p>No deleted payments found</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
        </div>
      </div>

      {/* Proforma Drawer */}
      {showProformaDrawer && proformaData && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[100] flex">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setShowProformaDrawer(false)} />
          {/* Drawer */}
          <div className="ml-auto w-full max-w-4xl h-full bg-white shadow-2xl p-0 flex flex-col animate-slideInRight z-[110] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-700 via-purple-700 to-teal-600 text-white p-8 border-b border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-extrabold mb-1">Create Proforma</h2>
                  <p className="text-blue-100 text-lg">Client: {proformaData.client}</p>
                </div>
                <button className="btn btn-ghost btn-lg text-white hover:bg-white/20" onClick={() => setShowProformaDrawer(false)}>
                  <XMarkIcon className="w-8 h-8" />
                </button>
              </div>
            </div>

            {/* Main Content - Two Column Layout */}
            <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              {/* Left Column - Invoice Items */}
              <div className="flex-1 p-4 md:p-6 md:overflow-y-auto">
                <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                    Invoice Items
                  </h3>
                  {/* Editable table */}
                  <div className="overflow-x-auto">
                    <table className="table w-full min-w-[500px]">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="text-sm font-semibold text-gray-700">Description</th>
                          <th className="text-sm font-semibold text-gray-700">Qty</th>
                          <th className="text-sm font-semibold text-gray-700">Rate</th>
                          <th className="text-sm font-semibold text-gray-700">Total</th>
                          {!proformaData?.isViewMode && <th className="text-sm font-semibold text-gray-700">Actions</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {proformaData.rows.map((row: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td>
                              <input
                                className="input input-bordered w-56 text-base py-3 px-4"
                                value={row.description}
                                onChange={e => handleProformaRowChange(idx, 'description', e.target.value)}
                                readOnly={proformaData?.isViewMode}
                                placeholder="Item description"
                              />
                            </td>
                            <td>
                              <input
                                className="input input-bordered w-16 text-base text-right py-3 px-4"
                                type="number"
                                value={row.qty}
                                onChange={e => handleProformaRowChange(idx, 'qty', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input
                                className="input input-bordered w-32 text-base text-right py-3 px-4"
                                type="number"
                                value={row.rate}
                                onChange={e => handleProformaRowChange(idx, 'rate', Number(e.target.value))}
                                readOnly={proformaData?.isViewMode}
                              />
                            </td>
                            <td>
                              <input className="input input-bordered w-32 text-base text-right font-semibold py-3 px-4" type="number" value={row.total} readOnly />
                            </td>
                            {!proformaData?.isViewMode && (
                              <td>
                                <button
                                  className="btn btn-ghost btn-xs text-red-500 hover:bg-red-50"
                                  onClick={() => handleDeleteProformaRow(idx)}
                                >
                                  <TrashIcon className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!proformaData?.isViewMode && (
                    <button
                      className="btn btn-outline btn-sm mt-4 text-blue-600 border-blue-300 hover:bg-blue-50"
                      onClick={handleAddProformaRow}
                    >
                      <PlusIcon className="w-4 h-4 mr-1" />
                      Add Row
                    </button>
                  )}
                </div>

                {/* Settings Section */}
                <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Cog6ToothIcon className="w-5 h-5 text-green-600" />
                    Settings
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="form-control">
                      <label className="label cursor-pointer justify-start gap-3">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-primary"
                          checked={proformaData.addVat}
                          onChange={e => setProformaData((prev: any) => ({ ...prev, addVat: e.target.checked }))}
                          disabled={proformaData?.isViewMode}
                        />
                        <span className="label-text font-medium">Add VAT (18%)</span>
                      </label>
                    </div>
                    {/* In the settings section, remove the currency field (dropdown and label) */}
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Bank Account</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={proformaData.bankAccount}
                        onChange={e => setProformaData((prev: any) => ({ ...prev, bankAccount: e.target.value }))}
                        disabled={proformaData?.isViewMode}
                      >
                        <option value="">Select account...</option>
                        <option value="1">Account 1</option>
                        <option value="2">Account 2</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Notes Section */}
                <div className="bg-white rounded-xl shadow-lg p-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-purple-600" />
                    Notes
                  </h3>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-[120px] text-sm"
                    value={proformaData.notes}
                    onChange={e => setProformaData((prev: any) => ({ ...prev, notes: e.target.value }))}
                    readOnly={proformaData?.isViewMode}
                    placeholder="Add any additional notes or terms..."
                  />
                </div>
              </div>

              {/* Right Column - Summary & Actions */}
              <div className="w-full md:w-80 bg-white border-l border-gray-200 p-4 md:p-6 flex flex-col mt-6 md:mt-0">
                {/* Summary Card */}
                <div className="bg-white rounded-xl p-6 mb-6 border border-blue-200 w-full shadow-lg">
                  {/* In the summary card, move the edit button to the top, next to the 'Summary' title: */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                      <ChartPieIcon className="w-5 h-5 text-blue-600" />
                      Summary
                    </h3>
                    <button className="btn btn-ghost btn-xs" onClick={() => setIsEditingSubtotal(true)} title="Edit total amount">
                      <PencilLine className="w-4 h-4 text-gray-500" />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {/* In the subtotal row, remove the edit button and just show the value or input: */}
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-600">Subtotal:</span>
                      {isEditingSubtotal ? (
                        <input
                          className="input input-bordered w-24 text-base text-right py-2 px-3 mr-2"
                          type="number"
                          value={editableSubtotal}
                          onChange={e => setEditableSubtotal(e.target.value)}
                          onBlur={saveSubtotal}
                          autoFocus
                        />
                      ) : (
                        <span className="font-semibold text-gray-800">
                          {proformaData.currency} {proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {proformaData.addVat && isNisCurrency({ currency: proformaData.currency }) && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-600">VAT (18%):</span>
                        <span className="font-semibold text-gray-800">
                          {proformaData.currency} {Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 0.18 * 100) / 100}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-gray-300 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold text-gray-800">Total:</span>
                        <span className="text-xl font-bold text-purple-700">
                          {proformaData.currency} {proformaData.addVat && isNisCurrency({ currency: proformaData.currency }) ? Math.round(proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0) * 1.18 * 100) / 100 : proformaData.rows.reduce((sum: number, r: any) => sum + Number(r.total), 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Proforma Info */}
                <div className="bg-white rounded-xl p-4 mb-6 w-full shadow-lg">
                  <h4 className="font-semibold text-gray-800 mb-2">Proforma Details</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Name:</span>
                      <span className="font-medium">{generatedProformaName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Language:</span>
                      <span className="font-medium">{proformaData.language}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Payment:</span>
                      <span className="font-medium">{proformaData.currency} {proformaData.payment.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-auto space-y-3">
                  {proformaData?.isViewMode ? (
                    <>
                      <button className="btn btn-primary w-full" onClick={() => setShowProformaDrawer(false)}>
                        Close
                      </button>
                      <button className="btn btn-outline w-full" onClick={() => {
                        setProformaData((prev: any) => ({ ...prev, isViewMode: false }));
                      }}>
                        Edit Proforma
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-md w-full rounded-xl border-0 bg-gray-900 text-white shadow-lg hover:bg-gray-800 hover:shadow-xl transition-shadow"
                        onClick={handleCreateProforma}
                      >
                        <DocumentCheckIcon className="mr-2 h-5 w-5" />
                        Create Proforma
                      </button>
                      <div className="text-xs text-gray-500 text-center bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                        ⚠️ Once created, changes cannot be made!
                      </div>
                    </>
                  )}
                </div>
                {proformaData?.createdBy && (
                  <div className="absolute bottom-4 left-6 text-xs text-gray-400">
                    Created by: {proformaData.createdBy}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>, document.body)
      }


      {/* Stages Drawer for creating a new finance plan */}
      {showStagesDrawer && ReactDOM.createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Overlay */}
          <div className="fixed inset-0 bg-black/30" onClick={handleCloseStagesDrawer} />
          {/* Modal */}
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl p-0 flex flex-col z-[110] overflow-hidden mx-4">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between z-10">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Finance Plan Stages</h2>
                <p className="text-sm text-gray-500">Client: {client?.name}</p>
              </div>
              <button className="btn btn-sm btn-circle btn-ghost text-gray-600 hover:bg-gray-100" onClick={handleCloseStagesDrawer}>
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-6 overflow-y-auto bg-white">
              {/* Auto Plan Section */}
              <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <ChartPieIcon className="w-5 h-5 text-gray-600" />
                  Create Auto Finance Plan
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Total Amount</span>
                      </label>
                      <input
                        type="number"
                        className="input input-bordered w-full no-arrows"
                        value={autoPlanData.totalAmount}
                        onChange={(e) => {
                          const newTotal = e.target.value;
                          const total = Number(newTotal || 0);
                          setAutoPlanData(prev => {
                            // Recalculate payment amounts from percentages when total changes
                            let percents = [...(prev.paymentPercents || [])];

                            // Ensure percents array matches numberOfPayments
                            if (percents.length !== prev.numberOfPayments) {
                              const count = prev.numberOfPayments;
                              if (count === 1) {
                                percents = [100];
                              } else if (count === 3) {
                                percents = [50, 25, 25];
                              } else {
                                // Even split that sums to 100
                                const base = Math.floor(100 / count);
                                percents = Array.from({ length: count }, () => base);
                                const remainder = 100 - base * count;
                                for (let i = 0; i < remainder; i++) {
                                  percents[i] += 1;
                                }
                              }
                            } else {
                              // Ensure array is long enough
                              while (percents.length < prev.numberOfPayments) {
                                const idx = percents.length;
                                const count = prev.numberOfPayments;
                                let defaultPercent: number;
                                if (count === 1) {
                                  defaultPercent = 100;
                                } else if (count === 2) {
                                  defaultPercent = 50; // For 2 payments, each should be 50%
                                } else {
                                  defaultPercent = idx === 0 ? 50 : idx === count - 1 ? 25 : 25;
                                }
                                percents.push(defaultPercent);
                              }
                            }

                            // Calculate amounts from percentages based on new total
                            const paymentAmounts = total > 0
                              ? percents.slice(0, prev.numberOfPayments).map(percent => (total * percent) / 100)
                              : Array.from({ length: prev.numberOfPayments }, () => 0);

                            return {
                              ...prev,
                              totalAmount: newTotal,
                              paymentAmounts,
                              paymentPercents: percents, // Update percents if they were recalculated
                            };
                          });
                        }}
                        placeholder="Enter total amount"
                      />
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Currency</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.currency}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, currency: e.target.value }))}
                      >
                        {availableCurrencies.length === 0 ? (
                          <>
                            <option value="₪">₪ (ILS)</option>
                            <option value="€">€ (EUR)</option>
                            <option value="$">$ (USD)</option>
                            <option value="£">£ (GBP)</option>
                          </>
                        ) : (
                          availableCurrencies.map((curr) => (
                            <option key={curr.id} value={curr.name}>
                              {curr.name} ({curr.iso_code})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Contact</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={autoPlanData.contact}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, contact: e.target.value }))}
                      >
                        <option value="">Select contact...</option>
                        {getAllAvailableContacts().map((contact, idx) => (
                          <option key={idx} value={contact.name}>
                            {contact.name} {contact.isMain && '(Main)'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Number of Payments</span>
                      </label>
                      <select
                        className="select select-bordered w-full"
                        value={isCustomPaymentCount ? 'custom' : autoPlanData.numberOfPayments}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setIsCustomPaymentCount(true);
                          } else {
                            setIsCustomPaymentCount(false);
                            const count = Number(e.target.value);
                            setAutoPlanData(prev => {
                              const totalAmount = Number(prev.totalAmount || 0);
                              let percents: number[];
                              let orders: string[];
                              let amounts: number[] = [];

                              if (count === 1) {
                                // For single payment, set to 100%
                                percents = [100];
                                orders = ['Single Payment'];
                                amounts = totalAmount > 0 ? [totalAmount] : [0];
                              } else if (count === 3) {
                                // Special default for 3 payments
                                percents = [50, 25, 25];
                                orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                amounts = totalAmount > 0
                                  ? [totalAmount * 0.5, totalAmount * 0.25, totalAmount * 0.25]
                                  : [0, 0, 0];
                              } else {
                                // Even split that sums to 100
                                const base = Math.floor(100 / count);
                                percents = Array.from({ length: count }, () => base);
                                const remainder = 100 - base * count;
                                for (let i = 0; i < remainder; i++) {
                                  percents[i] += 1;
                                }
                                // Generate default orders
                                orders = Array.from({ length: count }, (_, i) => {
                                  if (i === 0) return 'First Payment';
                                  if (i === count - 1) return 'Final Payment';
                                  return 'Intermediate Payment';
                                });
                                // Calculate amounts from percentages
                                amounts = totalAmount > 0
                                  ? percents.map(percent => (totalAmount * percent) / 100)
                                  : Array.from({ length: count }, () => 0);
                              }

                              return {
                                ...prev,
                                numberOfPayments: count,
                                paymentPercents: percents,
                                paymentOrders: orders,
                                paymentAmounts: amounts,
                              };
                            });
                          }
                        }}
                      >
                        <option value={1}>1 Payment</option>
                        <option value={2}>2 Payments</option>
                        <option value={3}>3 Payments</option>
                        <option value={4}>4 Payments</option>
                        <option value={5}>5 Payments</option>
                        <option value="custom">Custom</option>
                      </select>
                      {isCustomPaymentCount && (
                        <div className="mt-2">
                          <input
                            type="number"
                            className="input input-bordered w-full"
                            min={1}
                            max={100}
                            value={customPaymentCount}
                            onChange={(e) => {
                              const count = Number(e.target.value) || 1;
                              setCustomPaymentCount(count);
                              setAutoPlanData(prev => {
                                const totalAmount = Number(prev.totalAmount || 0);
                                let percents: number[];
                                let amounts: number[];
                                let orders: string[];
                                if (count === 1) {
                                  // For single payment, set to 100%
                                  percents = [100];
                                  amounts = totalAmount > 0 ? [totalAmount] : [0];
                                  orders = ['Single Payment'];
                                } else if (count === 3) {
                                  // Special default for 3 payments
                                  percents = [50, 25, 25];
                                  amounts = totalAmount > 0
                                    ? [totalAmount * 0.5, totalAmount * 0.25, totalAmount * 0.25]
                                    : [0, 0, 0];
                                  orders = ['First Payment', 'Intermediate Payment', 'Final Payment'];
                                } else {
                                  // Even split that sums to 100
                                  const base = Math.floor(100 / count);
                                  percents = Array.from({ length: count }, () => base);
                                  const remainder = 100 - base * count;
                                  for (let i = 0; i < remainder; i++) {
                                    percents[i] += 1;
                                  }
                                  // Calculate amounts from percentages
                                  amounts = totalAmount > 0
                                    ? percents.map(percent => (totalAmount * percent) / 100)
                                    : Array(count).fill(0);
                                  // Generate default orders
                                  orders = Array.from({ length: count }, (_, i) => {
                                    if (i === 0) return 'First Payment';
                                    if (i === count - 1) return 'Final Payment';
                                    return 'Intermediate Payment';
                                  });
                                }
                                return {
                                  ...prev,
                                  numberOfPayments: count,
                                  paymentPercents: percents,
                                  paymentAmounts: amounts,
                                  paymentOrders: orders,
                                };
                              });
                            }}
                            placeholder="Enter number of payments"
                          />
                        </div>
                      )}
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-medium">Payment Percentages & Amounts</span>
                      </label>
                      <div className="space-y-2">
                        {Array.from({ length: autoPlanData.numberOfPayments }).map((_, index) => {
                          const isFirst = index === 0;
                          const isLast = index === autoPlanData.numberOfPayments - 1;
                          const defaultLabel =
                            isFirst ? 'First Payment' : isLast ? 'Final Payment' : 'Intermediate Payment';
                          const currentOrder = autoPlanData.paymentOrders?.[index] || defaultLabel;
                          return (
                            <div key={index} className="flex items-center gap-2">
                              <select
                                className="select select-bordered w-48 text-sm"
                                value={currentOrder}
                                onChange={(e) => {
                                  setAutoPlanData(prev => {
                                    const next = [...(prev.paymentOrders || [])];
                                    // Ensure array length
                                    while (next.length < prev.numberOfPayments) {
                                      const idx = next.length;
                                      const defaultOrder = idx === 0 ? 'First Payment' : idx === prev.numberOfPayments - 1 ? 'Final Payment' : 'Intermediate Payment';
                                      next.push(defaultOrder);
                                    }
                                    next[index] = e.target.value;
                                    return {
                                      ...prev,
                                      paymentOrders: next,
                                    };
                                  });
                                }}
                              >
                                <option value="First Payment">First Payment</option>
                                <option value="Intermediate Payment">Intermediate Payment</option>
                                <option value="Final Payment">Final Payment</option>
                                <option value="Single Payment">Single Payment</option>
                                <option value="Expense (no VAT)">Expense (no VAT)</option>
                              </select>
                              <input
                                type="number"
                                className="input input-bordered w-24 no-arrows"
                                min={0}
                                max={100}
                                value={autoPlanData.paymentPercents[index] ?? 0}
                                onFocus={(e) => {
                                  // Select all text when focused for easy editing
                                  e.target.select();
                                }}
                                onChange={(e) => {
                                  const percentValue = Number(e.target.value || 0);
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);
                                  setAutoPlanData(prev => {
                                    const nextPercents = [...(prev.paymentPercents || [])];
                                    // Ensure array length
                                    while (nextPercents.length < prev.numberOfPayments) nextPercents.push(0);
                                    nextPercents[index] = percentValue;

                                    // Also update payment amounts when percentage changes
                                    const nextAmounts = [...(prev.paymentAmounts || [])];
                                    while (nextAmounts.length < prev.numberOfPayments) {
                                      const idx = nextAmounts.length;
                                      const total = Number(prev.totalAmount || 0);
                                      const percent = prev.paymentPercents[idx] ?? 0;
                                      nextAmounts.push(total > 0 ? (total * percent) / 100 : 0);
                                    }
                                    if (totalAmount > 0) {
                                      nextAmounts[index] = (totalAmount * percentValue) / 100;
                                    }

                                    return {
                                      ...prev,
                                      paymentPercents: nextPercents,
                                      paymentAmounts: nextAmounts,
                                    };
                                  });
                                }}
                              />
                              <span className="text-sm">%</span>
                              <input
                                type="number"
                                className="input input-bordered w-32 no-arrows"
                                min={0}
                                step="0.01"
                                value={(() => {
                                  // Use paymentAmounts if available, otherwise calculate from percentage
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);
                                  let amount: number;
                                  if (autoPlanData.paymentAmounts && autoPlanData.paymentAmounts[index] !== undefined) {
                                    amount = autoPlanData.paymentAmounts[index];
                                  } else {
                                    const percent = autoPlanData.paymentPercents[index] ?? 0;
                                    amount = totalAmount > 0 ? (totalAmount * percent) / 100 : 0;
                                  }
                                  // Return as number (not string with .toFixed) to allow easy editing
                                  return amount;
                                })()}
                                onFocus={(e) => {
                                  // Select all text when focused for easy editing
                                  e.target.select();
                                }}
                                onChange={(e) => {
                                  const amountValue = Number(e.target.value || 0);
                                  const totalAmount = Number(autoPlanData.totalAmount || 0);

                                  setAutoPlanData(prev => {
                                    // Update payment amounts array
                                    const nextAmounts = [...(prev.paymentAmounts || [])];
                                    while (nextAmounts.length < prev.numberOfPayments) {
                                      const idx = nextAmounts.length;
                                      const total = Number(prev.totalAmount || 0);
                                      const percent = prev.paymentPercents[idx] ?? 0;
                                      nextAmounts.push(total > 0 ? (total * percent) / 100 : 0);
                                    }
                                    nextAmounts[index] = amountValue;

                                    // Also update percentage if total amount is available
                                    const nextPercents = [...(prev.paymentPercents || [])];
                                    while (nextPercents.length < prev.numberOfPayments) nextPercents.push(0);
                                    if (totalAmount > 0) {
                                      nextPercents[index] = Math.round((amountValue / totalAmount) * 100 * 100) / 100;
                                    }

                                    return {
                                      ...prev,
                                      paymentAmounts: nextAmounts,
                                      paymentPercents: nextPercents,
                                    };
                                  });
                                }}
                                placeholder="0"
                              />
                              <span className="text-sm">{autoPlanData.currency || '₪'}</span>
                            </div>
                          )
                        })}
                        {(() => {
                          // Calculate sum of payment amounts
                          const totalAmount = Number(autoPlanData.totalAmount || 0);
                          const paymentAmounts = autoPlanData.paymentAmounts || [];
                          const sumOfAmounts = paymentAmounts.length > 0
                            ? paymentAmounts.reduce((sum, amount) => sum + (amount || 0), 0)
                            : autoPlanData.paymentPercents.slice(0, autoPlanData.numberOfPayments).reduce((sum, percent) => {
                              return sum + (totalAmount * (percent || 0) / 100);
                            }, 0);

                          const amountsMatch = Math.abs(sumOfAmounts - totalAmount) < 0.01; // Allow small floating point differences

                          return (
                            <div className="space-y-1">
                              {!amountsMatch && totalAmount > 0 && (
                                <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 p-2 rounded border border-orange-200">
                                  <ExclamationTriangleIcon className="w-4 h-4" />
                                  <span>
                                    <strong>Warning:</strong> Sum of payment amounts ({sumOfAmounts.toFixed(2)} {autoPlanData.currency || '₪'})
                                    doesn't match total amount ({totalAmount.toFixed(2)} {autoPlanData.currency || '₪'}).
                                    Difference: {(sumOfAmounts - totalAmount).toFixed(2)} {autoPlanData.currency || '₪'}
                                  </span>
                                </div>
                              )}
                              <div className="text-xs text-gray-500">
                                You can freely edit payment amounts. The system will use the actual amounts you enter.
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="form-control">
                    <label className="label cursor-pointer justify-start gap-3">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary"
                        checked={autoPlanData.includeVat}
                        onChange={(e) => setAutoPlanData(prev => ({ ...prev, includeVat: e.target.checked }))}
                      />
                      <span className="label-text font-medium">Include VAT (18%)</span>
                    </label>
                  </div>
                  <button
                    className="btn btn-primary w-full"
                    onClick={handleCreateAutoPlan}
                    disabled={isSavingPaymentRow || !autoPlanData.totalAmount || !autoPlanData.contact}
                  >
                    {isSavingPaymentRow ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <PlusIcon className="w-4 h-4 mr-2" />
                    )}
                    Create Auto Finance Plan
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>, document.body)
      }

      {/* Percentage Calculation Modal */}
      {showPercentageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px] max-w-[90vw] mx-4 max-h-[80vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              Calculate Payment Amount
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Calculate {percentageType === 'total' ? 'total amount' : 'left to plan amount'} percentage:
            </p>

            <div className="space-y-6">
              {/* Percentage Buttons */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Select Percentage:</h4>
                <div className="grid grid-cols-5 gap-2">
                  {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percentage) => (
                    <button
                      key={percentage}
                      className="btn btn-sm btn-outline hover:btn-primary hover:text-white"
                      onClick={() => {
                        setPercentageValue(percentage);
                        handlePercentageCalculation(percentage, percentageType);
                      }}
                    >
                      {percentage}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Input */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Or Enter Custom Percentage:</h4>
                <div className="flex gap-3">
                  <input
                    type="number"
                    className="input input-bordered flex-1 text-lg"
                    placeholder="Enter percentage"
                    value={percentageValue || ''}
                    onChange={(e) => setPercentageValue(Number(e.target.value))}
                    min="0"
                    max="100"
                    step="0.1"
                  />
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => handlePercentageCalculation(percentageValue, percentageType)}
                    disabled={!percentageValue || percentageValue <= 0 || percentageValue > 100}
                  >
                    Apply
                  </button>
                </div>
              </div>

              {/* Base Amount Info */}
              <div className="bg-blue-50 rounded-lg p-3">
                <div className="text-sm text-gray-600">
                  <span className="font-medium">Base amount:</span> {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}
                  <span className="font-bold text-lg">{(percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined)).toLocaleString()}</span>
                </div>
                {percentageValue > 0 && (
                  <div className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Calculated amount:</span> {getCurrencySymbol(financePlan?.payments[0]?.currency || '₪')}
                    <span className="font-bold text-lg text-green-600">
                      {Math.round(((percentageType === 'total' ? getTotalAmount() : getLeftToPlanAmount(newPaymentData.client || addingPaymentContact || undefined)) * percentageValue) / 100).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <button
                className="btn btn-ghost"
                onClick={() => setShowPercentageModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paid Date Modal */}
      {showPaidDateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Select Paid Date</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paid Date
                </label>
                <input
                  type="date"
                  className="input input-bordered w-full"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowPaidDateModal(false);
                    setSelectedPaymentForPaid(null);
                    setPaidDate('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleConfirmMarkAsPaid}
                  disabled={!paidDate}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      <EditPaymentModal
        isOpen={!!editingPaymentInModal}
        onClose={handleCloseEditModal}
        onSave={handleSaveEditPaymentModal}
        onVatToggle={handleVatTogglePersist}
        payment={editingPaymentInModal}
        isSaving={isSavingPaymentRow}
        availableContacts={getAllAvailableContacts()}
        availableCurrencies={availableCurrencies}
      />

      {/* Add Payment Modal */}
      <AddPaymentModal
        isOpen={!!addingPaymentModalContact}
        onClose={() => setAddingPaymentModalContact(null)}
        onSave={handleSaveNewPaymentModal}
        isSaving={isSavingPaymentRow}
        contactName={addingPaymentModalContact || ''}
        availableCurrencies={availableCurrencies}
        defaultCurrency={getDefaultCurrency()}
        defaultAmount={getDefaultAmount()}
        getTotalAmount={getTotalAmount}
      />

      {/* Notes Modal */}
      <NotesModal
        isOpen={showNotesModal}
        onClose={() => {
          setShowNotesModal(false);
          setSelectedPaymentForNotes(null);
        }}
        onSave={handleSaveNotes}
        notes={selectedPaymentForNotes?.notes || ''}
        isSaving={isSavingNotes}
        paymentId={selectedPaymentForNotes?.id}
      />

      {/* Payment History Modal — all paid payments across every contact for this lead */}
      {sendInvoiceSelectMode && selectedSendInvoicePayments.length > 0 && ReactDOM.createPortal(
        <div className="fixed bottom-6 left-1/2 z-[35] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-xl lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
          <span className="text-sm font-medium text-slate-700">
            {selectedSendInvoicePayments.length} row{selectedSendInvoicePayments.length === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exitSendInvoiceSelectMode}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openSendInvoiceModal}
          >
            Send invoice
          </button>
        </div>,
        document.body,
      )}

      {invoiceAutomationSelectMode && selectedAutomationPayments.length > 0 && ReactDOM.createPortal(
        <div className="fixed bottom-6 left-1/2 z-[35] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-xl lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))]">
          <span className="text-sm font-medium text-slate-700">
            {selectedAutomationPayments.length} row{selectedAutomationPayments.length === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={exitInvoiceAutomationSelectMode}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openInvoiceAutomationModal}
          >
            Schedule invoice send
          </button>
        </div>,
        document.body,
      )}

      <ProformaSendLanguageModal
        open={sendInvoiceModalOpen}
        onClose={() => !sendingInvoice && setSendInvoiceModalOpen(false)}
        onConfirm={(language) => void handleSendInvoiceConfirm(language)}
        sending={sendingInvoice}
        title="Send invoice"
        description="Send the proforma invoice to each selected contact by email and WhatsApp."
        confirmLabel="Send invoice"
        contactLabel={
          selectedSendInvoicePayments.length === 1
            ? selectedSendInvoicePayments[0]?.client
            : selectedSendInvoicePayments.length > 1
              ? `${selectedSendInvoicePayments.length} payments`
              : undefined
        }
      />

      <ProformaSendLanguageModal
        open={invoiceAutomationModalOpen}
        onClose={() => !savingInvoiceAutomation && setInvoiceAutomationModalOpen(false)}
        onConfirm={(language) => void handleInvoiceAutomationConfirm(language)}
        sending={savingInvoiceAutomation}
        title="Schedule invoice automation"
        description="A proforma will be created automatically when needed. Invoice email and WhatsApp will be sent to each contact on the payment due date."
        confirmLabel="Enable automation"
        contactLabel={
          selectedAutomationPayments.length === 1
            ? selectedAutomationPayments[0]?.client
            : selectedAutomationPayments.length > 1
              ? `${selectedAutomationPayments.length} payments`
              : undefined
        }
      />

      {showPaymentHistoryModal && ReactDOM.createPortal(
        (() => {
          const paidPayments = (financePlan?.payments || []).filter((p: PaymentPlan) => p.paid === true);
          const sorted = [...paidPayments].sort((a, b) => {
            const aTs = a.paid_at ? new Date(a.paid_at).getTime() : 0;
            const bTs = b.paid_at ? new Date(b.paid_at).getTime() : 0;
            return bTs - aTs;
          });

          const totalsByCurrency = sorted.reduce<Record<string, number>>((acc, p) => {
            const sym = getCurrencySymbol(p.currency) || '';
            const gross = (Number(p.value) || 0) + (Number(p.valueVat) || 0);
            acc[sym] = (acc[sym] || 0) + gross;
            return acc;
          }, {});

          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center">
              <div className="fixed inset-0 bg-black/30" onClick={() => setShowPaymentHistoryModal(false)} />
              <div className="relative mx-4 flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl z-[110]">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white p-6">
                  <div className="flex items-center gap-3">
                    <ClockIcon className="h-6 w-6 text-slate-800" />
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Payment History</h2>
                      <p className="text-sm text-gray-500">All paid payments across every contact of this lead.</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-circle btn-ghost text-gray-600 hover:bg-gray-100"
                    onClick={() => setShowPaymentHistoryModal(false)}
                    aria-label="Close"
                  >
                    <XMarkIcon className="h-6 w-6" />
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto bg-white p-6">
                  {sorted.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <ClockIcon className="mb-3 h-10 w-10 text-gray-300" />
                      <p className="text-base font-semibold text-gray-700">No paid payments yet</p>
                      <p className="text-sm text-gray-500">Payments marked as paid will appear here.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                          <tr>
                            <th className="px-3 py-2 text-left">#</th>
                            <th className="px-3 py-2 text-left">Contact</th>
                            <th className="px-3 py-2 text-left">Due date</th>
                            <th className="px-3 py-2 text-left">Paid date</th>
                            <th className="px-3 py-2 text-right">Amount</th>
                            <th className="px-3 py-2 text-right">VAT</th>
                            <th className="px-3 py-2 text-right">Total</th>
                            <th className="px-3 py-2 text-left">Paid by</th>
                            <th className="px-3 py-2 text-left">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {sorted.map((p) => {
                            const sym = getCurrencySymbol(p.currency) || '';
                            const baseAmt = Number(p.value) || 0;
                            const vatAmt = Number(p.valueVat) || 0;
                            const total = baseAmt + vatAmt;
                            return (
                              <tr key={String(p.id)} className="hover:bg-slate-50">
                                <td className="px-3 py-2 text-slate-700">{p.order || '—'}</td>
                                <td className="px-3 py-2 font-medium text-slate-900">{p.client || '—'}</td>
                                <td className="px-3 py-2 text-slate-700">{formatDateDDMMYYYY(p.dueDate) || '—'}</td>
                                <td className="px-3 py-2">
                                  <PaidPaymentDateBadge date={p.paid_at} />
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                                  {sym}{baseAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                                  {vatAmt > 0 ? `${sym}${vatAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                                  {sym}{total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-3 py-2 text-slate-700">{p.paid_by || '—'}</td>
                                <td className="max-w-[16rem] truncate px-3 py-2 text-slate-600" title={p.notes || ''}>
                                  {p.notes || '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-6 py-3">
                  <div className="text-sm text-slate-600">
                    {sorted.length} paid payment{sorted.length === 1 ? '' : 's'}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {Object.entries(totalsByCurrency).map(([sym, sum]) => (
                      <div key={sym || 'none'} className="rounded-lg bg-slate-100 px-3 py-1 tabular-nums text-slate-800">
                        <span className="mr-1 text-xs uppercase tracking-wide text-slate-500">Total</span>
                        <span className="font-semibold">{sym}{sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setShowPaymentHistoryModal(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
      <style>{`
        .finances-payments-table-shell table.finances-payments-table {
          border-collapse: separate !important;
          border-spacing: 0 12px !important;
          width: 100% !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr {
          background: transparent !important;
          box-shadow: none !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr:hover {
          background: transparent !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody td {
          border: none !important;
          background: #ffffff !important;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08) !important;
          vertical-align: middle;
          padding: 1rem 1.1rem !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody td:first-child {
          position: relative;
          border-top-left-radius: 18px !important;
          border-bottom-left-radius: 18px !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody td:first-child::before {
          content: '';
          position: absolute;
          left: 0.35rem;
          top: 0.45rem;
          bottom: 0.45rem;
          width: 3px;
          border-radius: 999px;
          background: var(--contact-accent, #94a3b8);
        }

        .finances-payments-table-shell table.finances-payments-table tbody td:last-child {
          border-top-right-radius: 18px !important;
          border-bottom-right-radius: 18px !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr:hover td {
          background: #ffffff !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr.finance-payment-row-paid td {
          background: #ffffff !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr.finance-payment-row-paid:hover td {
          background: #ffffff !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr.finance-payment-row-new td {
          background: #ffffff !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr.finance-payment-row-new:hover td {
          background: #eef2ff !important;
        }

        .finances-payments-table-shell table.finances-payments-table tbody tr.finance-payment-row-picked td {
          box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.45), 0 1px 3px rgba(15, 23, 42, 0.08) !important;
        }

        .finances-payments-table-shell table.finances-payments-table thead,
        .finances-payments-table-shell table.finances-payments-table thead tr,
        .finances-payments-table-shell table.finances-payments-table thead th {
          background: transparent !important;
          background-image: none !important;
          border: none !important;
          box-shadow: none !important;
        }

        .finance-payment-row-paid .text-white {
          color: #ffffff !important;
        }
      `}</style>
    </>
  );
};

export default FinancesTab; 