import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, EyeIcon, ChartBarIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';
import { useNavigate } from 'react-router-dom';
import { calculateNewLeadFullAmount, calculateLegacyLeadFullAmount } from '../utils/salesContributionCalculator';
import { legacyLeadMatchesExpert, newLeadFieldMatchesEmployee, newLeadMatchesExpert } from '../utils/rolePercentageCalculator';
import {
  collectHandlerEmployeeIdsForLookup,
  getNewLeadHandlerDisplayName,
  paymentDueDateBoundsUtc,
  resolveNewLeadIdsForHandler,
} from '../utils/handlerNewLeadIds';
import {
  DUE_INVOICED_EXTRA_COLUMNS,
  DUE_INVOICED_LEGACY_EXTRA_COLUMNS,
  dueInvoicedAllRowsFilter,
  dueInvoicedReadyToPayFilter,
  scopeDueInvoicedQuery,
  scopeLegacyInvoicedWithoutDueDate,
} from '../utils/contributionDueInvoiced';

interface LeadRow {
  role: string;
  leadNumber: string;
  clientName: string;
  category: string;
  applicants: number;
  total: number;
  leadId: string | number;
  leadType: 'new' | 'legacy';
  signedAt: string;
}

interface PaymentRow {
  id: string;
  name: string; // Client name
  client: string; // Contact name
  amount: number; // Value only (no VAT)
  currency: string;
  order: string;
  handler: string;
  case: string; // Formatted display number
  caseNav: string; // Actual lead number/ID for navigation
  isSubLead: boolean;
  category: string;
  notes: string;
  leadType: 'new' | 'legacy';
  leadId: string | number;
  dueAt: string;
}

interface EmployeeRoleLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
  role: string;
  fromDate: string;
  toDate: string;
}

const formatGraphDate = (value: string): string => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date).replace(/\//g, '.');
};

const formatGraphWeekday = (value: string): string => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
};

const formatGraphPeriodDate = (value: string): string => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date).replace(/\//g, '.');
};

// Helper to convert numeric order back to descriptive text
const getOrderText = (orderNumber: number | string | null | undefined): string => {
  if (typeof orderNumber === 'string') {
    const lowerStr = orderNumber.toLowerCase();
    if (lowerStr.includes('first') || lowerStr.includes('intermediate') || lowerStr.includes('final') || lowerStr.includes('single') || lowerStr.includes('expense')) {
      return orderNumber;
    }
    const num = parseInt(orderNumber, 10);
    if (!isNaN(num)) {
      orderNumber = num;
    } else {
      return orderNumber;
    }
  }

  if (typeof orderNumber === 'number') {
    switch (orderNumber) {
      case 1: return 'First Payment';
      case 5: return 'Intermediate Payment';
      case 9: return 'Final Payment';
      case 90: return 'Single Payment';
      case 99: return 'Expense (no VAT)';
      default: return 'First Payment';
    }
  }

  return 'First Payment';
};

const EmployeeRoleLeadsModal: React.FC<EmployeeRoleLeadsModalProps> = ({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  role,
  fromDate,
  toDate,
}) => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [employeePhotoUrl, setEmployeePhotoUrl] = useState<string | null>(null);
  const [headerPhotoError, setHeaderPhotoError] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'charts'>('table');

  useEffect(() => {
    if (isOpen) setViewMode('table');
  }, [isOpen, employeeId, role]);

  // Profile image in modal title (tenants_employee)
  useEffect(() => {
    if (!isOpen || !employeeId) {
      setEmployeePhotoUrl(null);
      setHeaderPhotoError(false);
      return;
    }
    setHeaderPhotoError(false);
    (async () => {
      const { data } = await supabase
        .from('tenants_employee')
        .select('photo_url, photo')
        .eq('id', employeeId)
        .maybeSingle();
      const raw = data?.photo_url ?? data?.photo;
      const u = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null;
      setEmployeePhotoUrl(u);
    })();
  }, [isOpen, employeeId]);

  // Fetch categories for getCategoryName helper
  useEffect(() => {
    const fetchCategories = async () => {
      const { data: categoriesData } = await supabase
        .from('misc_category')
        .select(`
          id,
          name,
          parent_id,
          misc_maincategory!parent_id(
            id,
            name
          )
        `)
        .order('name', { ascending: true });

      if (categoriesData) {
        setAllCategories(categoriesData);
      }
    };
    fetchCategories();
  }, []);

  // Helper function to get category name from ID with main category
  const getCategoryName = (categoryId: string | number | null | undefined, fallbackCategory?: string | number) => {
    if (!categoryId || categoryId === '---' || categoryId === '--') {
      if (fallbackCategory && String(fallbackCategory).trim() !== '') {
        let foundCategory = null;
        if (typeof fallbackCategory === 'number') {
          foundCategory = allCategories.find((cat: any) =>
            cat.id.toString() === fallbackCategory.toString()
          );
        }
        if (!foundCategory) {
          foundCategory = allCategories.find((cat: any) =>
            cat.name.toLowerCase().trim() === String(fallbackCategory).toLowerCase().trim()
          );
        }
        if (foundCategory) {
          if (foundCategory.misc_maincategory?.name) {
            return `${foundCategory.name} (${foundCategory.misc_maincategory.name})`;
          } else {
            return foundCategory.name;
          }
        } else {
          return String(fallbackCategory);
        }
      }
      return '--';
    }

    if (!allCategories || allCategories.length === 0) {
      return String(categoryId);
    }

    const categoryById = allCategories.find((cat: any) => cat.id.toString() === categoryId.toString());
    if (categoryById) {
      if (categoryById.misc_maincategory?.name) {
        return `${categoryById.name} (${categoryById.misc_maincategory.name})`;
      } else {
        return categoryById.name;
      }
    }

    const categoryByName = allCategories.find((cat: any) => cat.name === categoryId);
    if (categoryByName) {
      if (categoryByName.misc_maincategory?.name) {
        return `${categoryByName.name} (${categoryByName.misc_maincategory.name})`;
      } else {
        return categoryByName.name;
      }
    }

    return String(categoryId);
  };

  useEffect(() => {
    if (!isOpen || !employeeId || !role) return;

    if (role === 'ALL') {
      (async () => {
        setLoading(true);
        setLeads([]);
        setPaymentRows([]);
        try {
          await fetchLeads(false);
          await fetchPaymentRows(false);
        } catch (e) {
          console.error('Error loading full lead breakdown:', e);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    if (role === 'Handler') {
      fetchPaymentRows();
    } else {
      fetchLeads();
    }
  }, [isOpen, employeeId, role, fromDate, toDate]);

  const fetchPaymentRows = async (manageLoading = true) => {
    if (manageLoading) setLoading(true);
    try {
      // UTC bounds — same as fetchDueAmounts / computeDateBounds in SalesContributionPage
      const { startIso: fromDateTimeForPayments, endIso: toDateTimeForPayments } = paymentDueDateBoundsUtc(
        fromDate,
        toDate
      );

      // Get employee display name for matching
      const { data: employeeData } = await supabase
        .from('tenants_employee')
        .select('id, display_name')
        .eq('id', employeeId)
        .single();

      if (!employeeData) {
        setPaymentRows([]);
        return;
      }

      const employeeDisplayName = employeeData.display_name;
      const paymentRowsData: PaymentRow[] = [];

      // New leads where this employee is handler — must match fetchLeads / newLeadFieldMatchesEmployee:
      // .or(handler.eq.name, case_handler_id) missed leads when handler is numeric id, or name casing differed.
      // Same as fetchDueAmounts: merge case_handler, handler as id, name match (not only displayName OR in one .or)
      const handlerNewLeadIds = await resolveNewLeadIdsForHandler(employeeId, employeeDisplayName);

      if (handlerNewLeadIds && handlerNewLeadIds.length > 0) {

        // Fetch payment plans for these leads with due dates in range.
        // Scoped by the same Due / Invoiced rule as the report behind this modal: from October 2026 a row
        // counts because its invoice went out, not because it reached finance. The query only widens the
        // net — `dueInvoicedReadyToPayFilter` below makes the actual call, per row.
        let newPaymentsQuery = scopeDueInvoicedQuery(
          supabase
            .from('payment_plans')
            .select(`
            id,
            lead_id,
            value,
            value_vat,
            currency,
            due_date,
            cancel_date,
            payment_order,
            notes,
            ${DUE_INVOICED_EXTRA_COLUMNS}
          `)
            .not('due_date', 'is', null)
            .is('cancel_date', null)
            .in('lead_id', handlerNewLeadIds),
        );

        if (fromDateTimeForPayments) {
          newPaymentsQuery = newPaymentsQuery.gte('due_date', fromDateTimeForPayments);
        }
        if (toDateTimeForPayments) {
          newPaymentsQuery = newPaymentsQuery.lte('due_date', toDateTimeForPayments);
        }

        const { data: newPayments, error: newPaymentsError } = await newPaymentsQuery;

        if (!newPaymentsError && newPayments && newPayments.length > 0) {
          // Get unique lead IDs from payments
          const uniqueLeadIds = Array.from(new Set(newPayments.map((p: any) => p.lead_id).filter(Boolean)));

          // Fetch lead metadata
          const { data: newLeads, error: newLeadsError } = await supabase
            .from('leads')
            .select(`
              id,
              lead_number,
              master_id,
              name,
              handler,
              case_handler_id,
              category_id,
              category,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name,
                  department_id,
                  tenant_departement!department_id(
                    id,
                    name
                  )
                )
              )
            `)
            .in('id', uniqueLeadIds);

          if (!newLeadsError && newLeads) {
            // Fetch contacts for client names
            const contactsByLead = new Map<string, string>();
            const { data: leadContacts, error: leadContactsError } = await supabase
              .from('lead_leadcontact')
              .select('newlead_id, main, leads_contact:contact_id(name)')
              .eq('main', 'true')
              .in('newlead_id', uniqueLeadIds);

            if (!leadContactsError && leadContacts) {
              leadContacts.forEach((entry: any) => {
                const leadId = entry.newlead_id?.toString();
                const contactName = entry.leads_contact?.name;
                if (leadId && contactName) {
                  contactsByLead.set(leadId, contactName);
                }
              });
            }

            // Fallback: fetch from contacts table
            if (contactsByLead.size === 0) {
              const { data: contacts, error: contactsError } = await supabase
                .from('contacts')
                .select('id, name, lead_id')
                .in('lead_id', uniqueLeadIds)
                .eq('is_persecuted', false);

              if (!contactsError && contacts) {
                contacts.forEach((contact: any) => {
                  if (contact.lead_id && contact.name) {
                    if (!contactsByLead.has(contact.lead_id)) {
                      contactsByLead.set(contact.lead_id, contact.name);
                    }
                  }
                });
              }
            }

            // Fetch handler display names: case_handler_id and `handler` when it stores a numeric id (string or number)
            const handlerMap = new Map<number, string>();
            const handlerIds = new Set<number>();
            newLeads.forEach(lead => {
              for (const id of collectHandlerEmployeeIdsForLookup(lead)) {
                handlerIds.add(id);
              }
            });

            if (handlerIds.size > 0) {
              const { data: handlers, error: handlersError } = await supabase
                .from('tenants_employee')
                .select('id, display_name')
                .in('id', Array.from(handlerIds));

              if (!handlersError && handlers) {
                handlers.forEach((handler: any) => {
                  if (handler.id && handler.display_name) {
                    handlerMap.set(Number(handler.id), handler.display_name);
                  }
                });
              }
            }

            // Process each payment row
            newPayments.forEach(payment => {
              // The widened query above also returns rows that are merely invoiced or merely due; this is
              // where the period's rule decides which of them is income.
              if (!dueInvoicedReadyToPayFilter(payment)) return;

              const lead = newLeads.find(l => l.id === payment.lead_id);
              if (!lead) return;

              const contactName = contactsByLead.get(payment.lead_id) || null;
              const handlerName = getNewLeadHandlerDisplayName(lead, handlerMap);

              // Use joined misc_category from select (join) - fallback to getCategoryName only when join is missing
              let categoryDisplay = '—';
              const miscCategory: any = lead.misc_category;
              const categoryEntry: any = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
              const mainCategory: any = categoryEntry?.misc_maincategory;
              let mainCategoryName: string | undefined;
              if (Array.isArray(mainCategory) && mainCategory[0]) {
                mainCategoryName = mainCategory[0]?.name;
              } else if (mainCategory) {
                mainCategoryName = mainCategory?.name;
              }
              const subCategoryName: string = categoryEntry?.name || lead.category || '—';
              if (subCategoryName !== '—' || mainCategoryName) {
                categoryDisplay = mainCategoryName ? `${subCategoryName} (${mainCategoryName})` : subCategoryName;
              } else if (lead.category_id || lead.category) {
                categoryDisplay = getCategoryName(lead.category_id, lead.category);
              }

              // Calculate amount - value only (no VAT)
              const value = Number(payment.value || 0);
              const amount = value;

              const orderCode = payment.payment_order ? getOrderText(payment.payment_order) : '—';

              // Format case number
              const actualLeadNumber = lead.lead_number || lead.id?.toString() || '';
              let caseNumber: string;
              let isSubLead = false;

              if (lead.master_id) {
                isSubLead = true;
                if (lead.lead_number && lead.lead_number.includes('/')) {
                  caseNumber = `#${lead.lead_number}`;
                } else {
                  const masterLead = newLeads.find(l => l.id === lead.master_id);
                  const masterLeadNumber = masterLead?.lead_number || lead.master_id?.toString() || '';
                  caseNumber = `#${masterLeadNumber}/2`;
                }
              } else {
                caseNumber = lead.lead_number ? `#${lead.lead_number}` : `#${lead.id}`;
              }

              paymentRowsData.push({
                id: `new-${payment.id}`,
                name: lead.name || '—',
                client: contactName || '—',
                amount,
                currency: payment.currency || '₪',
                order: orderCode,
                handler: handlerName,
                case: caseNumber,
                caseNav: actualLeadNumber,
                isSubLead,
                category: categoryDisplay,
                notes: payment.notes || '—',
                leadType: 'new',
                leadId: payment.lead_id,
                dueAt: payment.due_date || payment.invoice_sent_at || payment.invoice_send_automation_sent_at || fromDate,
              });
            });
          }
        }
      }

      // Fetch legacy leads where employee is handler
      const { data: handlerLegacyLeads } = await supabase
        .from('leads_lead')
        .select('id, case_handler_id')
        .eq('case_handler_id', employeeId);

      if (handlerLegacyLeads && handlerLegacyLeads.length > 0) {
        const handlerLegacyLeadIds = handlerLegacyLeads.map(l => l.id).filter(Boolean).map(id => Number(id));

        // Fetch payment plans for these leads with due dates in range
        const legacySelect = `
            id,
            lead_id,
            client_id,
            value,
            value_base,
            vat_value,
            currency_id,
            due_date,
            cancel_date,
            order,
            notes,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code),
            ${DUE_INVOICED_LEGACY_EXTRA_COLUMNS}
          `;

        let legacyPaymentsQuery = supabase
          .from('finances_paymentplanrow')
          .select(legacySelect)
          .not('due_date', 'is', null)
          .is('cancel_date', null)
          .in('lead_id', handlerLegacyLeadIds);

        if (fromDateTimeForPayments) {
          legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTimeForPayments);
        }
        if (toDateTimeForPayments) {
          legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTimeForPayments);
        }

        const { data: legacyDuePayments, error: legacyPaymentsError } = await legacyPaymentsQuery;

        /*
         * Plus legacy rows invoiced in the window that carry no due date.
         *
         * A legacy row holds only its planned `date` until someone sends it to finance, which is what
         * fills `due_date` in — so an invoice sent before that is invisible to the query above. Fetched
         * separately rather than folded into one filter: the two are disjoint on `due_date` being null,
         * and a single query cannot express both date anchors at once.
         */
        const { data: legacyInvoicedNoDueDate } = await scopeLegacyInvoicedWithoutDueDate(
          supabase
            .from('finances_paymentplanrow')
            .select(legacySelect)
            .is('cancel_date', null)
            .in('lead_id', handlerLegacyLeadIds),
          fromDateTimeForPayments,
          toDateTimeForPayments,
        );

        const legacyPayments = [...(legacyDuePayments || []), ...(legacyInvoicedNoDueDate || [])];

        if (!legacyPaymentsError && legacyPayments.length > 0) {
          const uniqueLegacyLeadIds = Array.from(new Set(legacyPayments.map((p: any) => p.lead_id).filter(Boolean)));

          // Fetch lead metadata
          const { data: legacyLeads, error: legacyLeadsError } = await supabase
            .from('leads_lead')
            .select(`
              id,
              name,
              lead_number,
              manual_id,
              master_id,
              case_handler_id,
              category_id,
              category,
              misc_category!category_id(
                id,
                name,
                parent_id,
                misc_maincategory!parent_id(
                  id,
                  name,
                  department_id,
                  tenant_departement!department_id(
                    id,
                    name
                  )
                )
              )
            `)
            .in('id', uniqueLegacyLeadIds);

          if (!legacyLeadsError && legacyLeads) {
            // Fetch contacts
            const contactIds = Array.from(new Set(legacyPayments.map(p => p.client_id).filter(Boolean))).map(id => Number(id)).filter(id => !Number.isNaN(id));
            const contactMap = new Map<number, string>();
            if (contactIds.length > 0) {
              const { data: contacts, error: contactsError } = await supabase
                .from('leads_contact')
                .select('id, name')
                .in('id', contactIds);

              if (!contactsError && contacts) {
                contacts.forEach((contact: any) => {
                  if (contact.id && contact.name) {
                    contactMap.set(Number(contact.id), contact.name);
                  }
                });
              }
            }

            // Fetch handler names
            const handlerMap = new Map<number, string>();
            const handlerIds = new Set<number>();
            legacyLeads.forEach(lead => {
              if (lead.case_handler_id) {
                const handlerId = Number(lead.case_handler_id);
                if (!Number.isNaN(handlerId)) {
                  handlerIds.add(handlerId);
                }
              }
            });

            if (handlerIds.size > 0) {
              const { data: handlers, error: handlersError } = await supabase
                .from('tenants_employee')
                .select('id, display_name')
                .in('id', Array.from(handlerIds));

              if (!handlersError && handlers) {
                handlers.forEach((handler: any) => {
                  if (handler.id && handler.display_name) {
                    handlerMap.set(Number(handler.id), handler.display_name);
                  }
                });
              }
            }

            // Process each payment row
            legacyPayments.forEach((payment: any) => {
              // `dueInvoicedAllRowsFilter`, not the ready-to-pay one: this query never gated on
              // `ready_to_pay`, and pre-October periods have to keep counting exactly what they did.
              if (!dueInvoicedAllRowsFilter(payment)) return;

              const lead = legacyLeads.find(l => {
                if (l.id === payment.lead_id) return true;
                if (String(l.id) === String(payment.lead_id)) return true;
                if (Number(l.id) === Number(payment.lead_id)) return true;
                return false;
              });

              if (!lead) return;

              const contactId = payment.client_id ? Number(payment.client_id) : null;
              const contactName = contactId && !Number.isNaN(contactId) ? contactMap.get(contactId) : null;

              const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
              const handlerName = handlerId && !Number.isNaN(handlerId) ? (handlerMap.get(handlerId) || '—') : '—';

              // Get category
              const miscCategory: any = lead.misc_category;
              const categoryEntry: any = Array.isArray(miscCategory) ? miscCategory[0] : miscCategory;
              const mainCategory: any = categoryEntry?.misc_maincategory;
              let mainCategoryName: string | undefined = undefined;
              if (Array.isArray(mainCategory) && mainCategory[0]) {
                mainCategoryName = mainCategory[0]?.name;
              } else if (mainCategory) {
                mainCategoryName = mainCategory?.name;
              }
              const subCategoryName: string = categoryEntry?.name || lead.category || '—';
              const categoryDisplay = mainCategoryName ? `${subCategoryName} (${mainCategoryName})` : subCategoryName;

              // Calculate amount - value only (no VAT)
              const value = Number(payment.value || payment.value_base || 0);
              const amount = value;

              const accountingCurrency: any = payment.accounting_currencies
                ? (Array.isArray(payment.accounting_currencies) ? payment.accounting_currencies[0] : payment.accounting_currencies)
                : null;
              const currency = accountingCurrency?.name || accountingCurrency?.iso_code ||
                (payment.currency_id === 2 ? '€' :
                  payment.currency_id === 3 ? '$' :
                    payment.currency_id === 4 ? '£' : '₪');

              const orderCode = payment.order ? getOrderText(payment.order) : '—';

              // Format case number
              const actualLeadId = lead.id?.toString() || '';
              let caseNumber: string;
              let isSubLead = false;

              if (lead.master_id) {
                isSubLead = true;
                if (lead.lead_number && String(lead.lead_number).includes('/')) {
                  caseNumber = `#${lead.lead_number}`;
                } else {
                  const masterLead = legacyLeads.find(l => l.id === lead.master_id);
                  const masterLeadNumber = masterLead?.lead_number || masterLead?.manual_id || lead.master_id?.toString() || '';
                  caseNumber = `#${masterLeadNumber}/2`;
                }
              } else {
                const leadNumber = lead.lead_number || lead.manual_id || lead.id;
                caseNumber = `#${leadNumber}`;
              }

              paymentRowsData.push({
                id: `legacy-${payment.id}`,
                name: lead.name || '—',
                client: contactName || '—',
                amount,
                currency,
                order: orderCode,
                handler: handlerName,
                case: caseNumber,
                caseNav: actualLeadId,
                isSubLead,
                category: categoryDisplay,
                notes: payment.notes || '—',
                leadType: 'legacy',
                leadId: `legacy_${lead.id}`,
                dueAt: payment.due_date || payment.invoice_sent_at || payment.invoice_send_automation_sent_at || payment.date || fromDate,
              });
            });
          }
        }
      }

      setPaymentRows(paymentRowsData);
    } catch (error) {
      console.error('Error fetching payment rows:', error);
    } finally {
      if (manageLoading) setLoading(false);
    }
  };

  // Helper functions for amount calculation (matching SalesContributionPage logic)
  const parseNumericAmount = (val: any): number => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (typeof val === 'string') {
      const cleaned = val.replace(/[^\d.-]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const buildCurrencyMeta = (...candidates: any[]): { displaySymbol: string; conversionValue: string | number } => {
    for (const candidate of candidates) {
      if (!candidate) continue;

      if (typeof candidate === 'object') {
        if (Array.isArray(candidate) && candidate.length > 0) {
          const first = candidate[0];
          if (first?.iso_code) {
            return { displaySymbol: first.iso_code, conversionValue: first.iso_code };
          }
          if (first?.name) {
            return { displaySymbol: first.name, conversionValue: first.name };
          }
        } else if (candidate.iso_code) {
          return { displaySymbol: candidate.iso_code, conversionValue: candidate.iso_code };
        } else if (candidate.name) {
          return { displaySymbol: candidate.name, conversionValue: candidate.name };
        }
      }

      if (typeof candidate === 'string' && candidate.trim()) {
        return { displaySymbol: candidate, conversionValue: candidate };
      }

      if (typeof candidate === 'number') {
        const currencyMap: { [key: number]: string } = {
          1: 'NIS',
          2: 'EUR',
          3: 'USD',
          4: 'GBP',
        };
        const currency = currencyMap[candidate] || 'NIS';
        return { displaySymbol: currency, conversionValue: currency };
      }
    }

    return { displaySymbol: 'NIS', conversionValue: 'NIS' };
  };

  const fetchLeads = async (manageLoading = true) => {
    if (manageLoading) setLoading(true);
    try {
      // For non-Handler roles, use the existing lead-based logic
      const fromDateTime = fromDate ? `${fromDate}T00:00:00.000Z` : null;
      const toDateTime = toDate ? `${toDate}T23:59:59.999Z` : null;

      let stageHistoryQuery = supabase
        .from('leads_leadstage')
        .select('id, stage, date, cdate, lead_id, newlead_id')
        .eq('stage', 60);

      if (fromDateTime) {
        stageHistoryQuery = stageHistoryQuery.gte('date', fromDateTime);
      }
      if (toDateTime) {
        stageHistoryQuery = stageHistoryQuery.lte('date', toDateTime);
      }

      const { data: stageHistoryData, error: stageHistoryError } = await stageHistoryQuery;
      if (stageHistoryError) throw stageHistoryError;

      const newLeadIds = new Set<string>();
      const legacyLeadIds = new Set<number>();
      const newLeadSignedAt = new Map<string, string>();
      const legacyLeadSignedAt = new Map<number, string>();

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          const id = entry.newlead_id.toString();
          newLeadIds.add(id);
          newLeadSignedAt.set(id, entry.date || entry.cdate || fromDate);
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          const id = Number(entry.lead_id);
          legacyLeadIds.add(id);
          legacyLeadSignedAt.set(id, entry.date || entry.cdate || fromDate);
        }
      });

      const allLeads: LeadRow[] = [];

      // Fetch new leads data (existing logic for non-Handler roles)
      if (newLeadIds.size > 0) {
        const newLeadIdsArray = Array.from(newLeadIds);
        const { data: newLeads, error: newLeadsError } = await supabase
          .from('leads')
          .select(`
            id,
            lead_number,
            name,
            balance,
            balance_currency,
            proposal_total,
            proposal_currency,
            currency_id,
            subcontractor_fee,
            closer,
            scheduler,
            handler,
            helper,
            meeting_lawyer_id,
            lawyer,
            expert,
            expert_id,
            case_handler_id,
            manager,
            meeting_manager_id,
            category_id,
            category,
            number_of_applicants_meeting,
            potential_applicants_meeting,
            master_id,
            manual_id,
            accounting_currencies!leads_currency_id_fkey(name, iso_code),
            misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
          `)
          .in('id', newLeadIdsArray);

        if (!newLeadsError && newLeads) {
          const contactsMap = new Map<string, string>();
          if (newLeadIdsArray.length > 0) {
            try {
              const { data: contacts, error: contactsError } = await supabase
                .from('leads_contact')
                .select('lead_id, name')
                .in('lead_id', newLeadIdsArray);

              if (!contactsError && contacts) {
                contacts?.forEach(contact => {
                  if (!contactsMap.has(contact.lead_id)) {
                    contactsMap.set(contact.lead_id, contact.name);
                  }
                });
              }
            } catch (error) {
              console.error('Error in contacts fetch:', error);
            }
          }

          newLeads.forEach(lead => {
            const roles: string[] = [];

            if (lead.closer && newLeadFieldMatchesEmployee(lead.closer, employeeId, employeeName)) {
              roles.push('Closer');
            }

            if (lead.scheduler && newLeadFieldMatchesEmployee(lead.scheduler, employeeId, employeeName)) {
              roles.push('Scheduler');
            }

            // Helper Closer: check helper (name or ID e.g. "129"), meeting_lawyer_id, and lawyer (new leads)
            if (lead.helper != null && lead.helper !== '') {
              const helperValue = lead.helper;
              const matchName = typeof helperValue === 'string' && helperValue.toLowerCase() === employeeName.toLowerCase();
              const matchId = Number(helperValue) === employeeId;
              if ((matchName || matchId) && !roles.includes('Helper Closer')) roles.push('Helper Closer');
            }
            if (lead.meeting_lawyer_id != null && Number(lead.meeting_lawyer_id) === employeeId && !roles.includes('Helper Closer')) {
              roles.push('Helper Closer');
            }
            if (lead.lawyer != null && lead.lawyer !== '') {
              const lawyerValue = lead.lawyer;
              const matchName = typeof lawyerValue === 'string' && lawyerValue.toLowerCase() === employeeName.toLowerCase();
              const matchId = Number(lawyerValue) === employeeId;
              if ((matchName || matchId) && !roles.includes('Helper Closer')) roles.push('Helper Closer');
            }

            let isHandler = false;
            if (lead.handler) {
              const handlerValue = lead.handler;
              if (typeof handlerValue === 'string' && handlerValue.toLowerCase() === employeeName.toLowerCase()) {
                isHandler = true;
              } else if (Number(handlerValue) === employeeId) {
                isHandler = true;
              }
            }
            if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
              isHandler = true;
            }
            if (isHandler) {
              roles.push('Handler');
            }

            if (newLeadMatchesExpert(lead, employeeId, employeeName)) {
              roles.push('Expert');
            }

            // For new leads, check 'manager' field (not 'meeting_manager_id')
            if (lead.manager) {
              const managerValue = lead.manager;
              // Check if it's a numeric string (ID) or a number
              if (typeof managerValue === 'string') {
                const numericValue = Number(managerValue);
                // If it's a valid number, treat it as an ID
                if (!isNaN(numericValue) && numericValue.toString() === managerValue.trim()) {
                  if (numericValue === employeeId) {
                    roles.push('Meeting Manager');
                  }
                } else {
                  // Otherwise, treat it as a name
                  if (managerValue.toLowerCase() === employeeName.toLowerCase()) {
                    roles.push('Meeting Manager');
                  }
                }
              } else {
                // If it's already a number, compare directly
                if (Number(managerValue) === employeeId) {
                  roles.push('Meeting Manager');
                }
              }
            }
            // Fallback to meeting_manager_id if manager is not set
            if (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId) {
              roles.push('Meeting Manager');
            }

            const isAllRolesMode = role === 'ALL';
            const requiredRoles = isAllRolesMode ? [] : role.split(',').map(r => r.trim()).sort();
            // For a specific role row: only include leads where employee has exactly that role set (exact match so modal total matches row)
            const exactMatch = requiredRoles.length > 0 && roles.length === requiredRoles.length && requiredRoles.every((r: string) => roles.includes(r));
            const hasAllRoles = isAllRolesMode ? roles.length > 0 : exactMatch;
            if (hasAllRoles) {
              // Check if this is "Handler only" - exclude from signed totals (same logic as main report)
              const isHandlerOnly = roles.length === 1 && roles[0] === 'Handler';
              if (isAllRolesMode && isHandlerOnly) {
                return; // Show handler-only in "Handler — due payments" only, not in Signed leads
              }

              // Same as calculateEmployeeMetrics totalSigned: full NIS (no subcontractor fee) per salesContributionCalculator
              const amountNIS = calculateNewLeadFullAmount(lead);
              const totalForSigned = isHandlerOnly ? 0 : amountNIS;
              const displayRoleLabel =
                isAllRolesMode ? roles.filter((r) => r !== 'Handler').join(', ') : roles.join(', ');

              let leadNumberDisplay = lead.lead_number || lead.manual_id || lead.id?.toString() || '';
              if (lead.master_id) {
                const masterLead = newLeads.find(l => l.id === lead.master_id || l.lead_number === lead.master_id);
                const masterLeadNumber = masterLead?.lead_number || lead.master_id;
                leadNumberDisplay = `${masterLeadNumber}/2`;
              }

              const miscCategory = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
              const categoryName = miscCategory?.name || lead.category || '—';
              const mainCategory = Array.isArray(miscCategory?.misc_maincategory) ? miscCategory.misc_maincategory[0] : miscCategory?.misc_maincategory;
              const mainCategoryName = mainCategory?.name;
              const categoryDisplay = mainCategoryName
                ? `${categoryName} (${mainCategoryName})`
                : categoryName;

              const clientName = contactsMap.get(lead.id) || lead.name || '—';
              const applicants = Number(lead.number_of_applicants_meeting) || Number(lead.potential_applicants_meeting) || 0;

              allLeads.push({
                role: displayRoleLabel,
                leadNumber: leadNumberDisplay,
                clientName,
                category: categoryDisplay,
                applicants,
                total: totalForSigned, // Use signed total logic (0 for handler-only)
                leadId: lead.id,
                leadType: 'new',
                signedAt: newLeadSignedAt.get(String(lead.id)) || fromDate,
              });
            }
          });
        }
      }

      // Fetch legacy leads data (existing logic for non-Handler roles)
      if (legacyLeadIds.size > 0) {
        const legacyLeadIdsArray = Array.from(legacyLeadIds);
        const { data: legacyLeads, error: legacyLeadsError } = await supabase
          .from('leads_lead')
          .select(`
            id,
            name,
            total,
            total_base,
            currency_id,
            meeting_total_currency_id,
            subcontractor_fee,
            closer_id,
            meeting_scheduler_id,
            meeting_lawyer_id,
            case_handler_id,
            expert_id,
            meeting_manager_id,
            category_id,
            category,
            no_of_applicants,
            accounting_currencies!leads_lead_currency_id_fkey(name, iso_code),
            misc_category!category_id(id, name, parent_id, misc_maincategory!parent_id(id, name))
          `)
          .in('id', legacyLeadIdsArray);

        if (!legacyLeadsError && legacyLeads) {
          legacyLeads.forEach(lead => {
            const roles: string[] = [];

            if (lead.closer_id && Number(lead.closer_id) === employeeId) {
              roles.push('Closer');
            }

            if (lead.meeting_scheduler_id && Number(lead.meeting_scheduler_id) === employeeId) {
              roles.push('Scheduler');
            }

            if (lead.meeting_lawyer_id && Number(lead.meeting_lawyer_id) === employeeId) {
              roles.push('Helper Closer');
            }

            if (lead.case_handler_id && Number(lead.case_handler_id) === employeeId) {
              roles.push('Handler');
            }

            if (legacyLeadMatchesExpert(lead, employeeId, employeeName)) {
              roles.push('Expert');
            }

            if (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId) {
              roles.push('Meeting Manager');
            }

            const isAllRolesMode = role === 'ALL';
            const requiredRoles = isAllRolesMode ? [] : role.split(',').map(r => r.trim()).sort();
            const exactMatch = requiredRoles.length > 0 && roles.length === requiredRoles.length && requiredRoles.every((r: string) => roles.includes(r));
            const hasAllRoles = isAllRolesMode ? roles.length > 0 : exactMatch;
            if (hasAllRoles) {
              // Check if this is "Handler only" - exclude from signed totals (same logic as main report)
              const isHandlerOnly = roles.length === 1 && roles[0] === 'Handler';
              if (isAllRolesMode && isHandlerOnly) {
                return;
              }

              const amountNIS = calculateLegacyLeadFullAmount(lead);
              const totalForSigned = isHandlerOnly ? 0 : amountNIS;
              const displayRoleLabel =
                isAllRolesMode ? roles.filter((r) => r !== 'Handler').join(', ') : roles.join(', ');

              const leadNumberDisplay = lead.id?.toString() || '';
              // Use joined misc_category from select (join) - fallback to lead.category when join is missing
              const miscCategory = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
              const categoryName = miscCategory?.name || lead.category || '—';
              const mainCategory = Array.isArray(miscCategory?.misc_maincategory) ? miscCategory.misc_maincategory[0] : miscCategory?.misc_maincategory;
              const mainCategoryName = mainCategory?.name;
              const categoryDisplay = mainCategoryName
                ? `${categoryName} (${mainCategoryName})`
                : categoryName;

              const clientName = lead.name || '—';
              const applicants = Number(lead.no_of_applicants) || 0;

              allLeads.push({
                role: displayRoleLabel,
                leadNumber: leadNumberDisplay,
                clientName,
                category: categoryDisplay,
                applicants,
                total: totalForSigned, // Use signed total logic (0 for handler-only, amountAfterFee for others)
                leadId: lead.id,
                leadType: 'legacy',
                signedAt: legacyLeadSignedAt.get(Number(lead.id)) || fromDate,
              });
            }
          });
        }
      }

      setLeads(allLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      if (manageLoading) setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleLeadClick = (lead: LeadRow) => {
    if (lead.leadType === 'new') {
      navigate(`/clients/${lead.leadId}`);
    } else {
      const legacyId = typeof lead.leadId === 'string' ? lead.leadId.replace(/^L/, '') : lead.leadId;
      navigate(`/clients/${legacyId}`);
    }
  };

  const handlePaymentRowClick = (row: PaymentRow) => {
    if (row.leadType === 'new' && row.caseNav) {
      const isSubLead = row.isSubLead || (row.case && row.case.includes('/'));
      if (isSubLead) {
        const formattedCase = row.case?.replace('#', '') || '';
        navigate(`/clients/${encodeURIComponent(row.caseNav)}?lead=${encodeURIComponent(formattedCase)}`);
      } else {
        navigate(`/clients/${encodeURIComponent(row.caseNav)}`);
      }
    } else if (row.leadType === 'legacy' && row.caseNav) {
      const legacyId = row.caseNav;
      const isSubLead = row.isSubLead || (row.case && row.case.includes('/'));
      if (isSubLead) {
        const formattedCase = row.case?.replace('#', '') || '';
        navigate(`/clients/${encodeURIComponent(legacyId)}?lead=${encodeURIComponent(formattedCase)}`);
      } else {
        navigate(`/clients/${encodeURIComponent(legacyId)}`);
      }
    } else if (row.case) {
      const leadNumber = row.case.replace('#', '');
      navigate(`/clients/${encodeURIComponent(leadNumber)}`);
    }
  };

  if (!isOpen) return null;

  // Format date as dd-mm-yy for display (input YYYY-MM-DD from filters)
  const formatDateDdMmYy = (dateStr: string): string => {
    if (!dateStr || typeof dateStr !== 'string') return dateStr || '—';
    const parts = dateStr.trim().split(/[-/]/);
    if (parts.length >= 3) {
      const [y, m, d] = parts;
      const day = d.length === 1 ? `0${d}` : d;
      const month = m.length === 1 ? `0${m}` : m;
      const year = y.length === 4 ? y.slice(2) : y;
      return `${day}-${month}-${year}`;
    }
    return dateStr;
  };

  const isAllRolesMode = role === 'ALL';
  const isHandlerRole = role === 'Handler';
  const displayCount = isHandlerRole
    ? paymentRows.length
    : isAllRolesMode
      ? leads.length + paymentRows.length
      : leads.length;

  const totalSignedNis = leads.reduce((sum, lead) => sum + (lead.total || 0), 0);
  const totalDueNis = paymentRows.reduce((sum, row) => {
    const currencyForConversion = row.currency || 'NIS';
    const normalizedCurrency =
      currencyForConversion === '₪' ? 'NIS' : currencyForConversion === '€' ? 'EUR' : currencyForConversion === '$' ? 'USD' : currencyForConversion === '£' ? 'GBP' : currencyForConversion;
    return sum + convertToNIS(row.amount, normalizedCurrency);
  }, 0);

  const signedProgressData = useMemo(() => {
    const daily = new Map<string, { amount: number; leadNumbers: Set<string> }>();
    leads.forEach((lead) => {
      const day = String(lead.signedAt || fromDate).slice(0, 10);
      const entry = daily.get(day) || { amount: 0, leadNumbers: new Set<string>() };
      entry.amount += lead.total || 0;
      if (lead.leadNumber) entry.leadNumbers.add(lead.leadNumber);
      daily.set(day, entry);
    });
    const points: Array<{ date: string; total: number; leadNumbers: string[] }> = [];
    const cursor = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (cursor <= end && points.length < 400) {
      const date = cursor.toISOString().slice(0, 10);
      const entry = daily.get(date);
      points.push({
        date,
        total: entry?.amount || 0,
        leadNumbers: entry ? Array.from(entry.leadNumbers) : [],
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
  }, [leads, fromDate, toDate]);

  const dueProgressData = useMemo(() => {
    const daily = new Map<string, { amount: number; leadNumbers: Set<string> }>();
    paymentRows.forEach((row) => {
      const currency = row.currency === '₪' ? 'NIS' : row.currency === '€' ? 'EUR' : row.currency === '$' ? 'USD' : row.currency === '£' ? 'GBP' : row.currency || 'NIS';
      const day = String(row.dueAt || fromDate).slice(0, 10);
      const entry = daily.get(day) || { amount: 0, leadNumbers: new Set<string>() };
      entry.amount += convertToNIS(row.amount, currency);
      if (row.case) entry.leadNumbers.add(row.case);
      daily.set(day, entry);
    });
    const points: Array<{ date: string; total: number; leadNumbers: string[] }> = [];
    const cursor = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${toDate}T00:00:00Z`);
    while (cursor <= end && points.length < 400) {
      const date = cursor.toISOString().slice(0, 10);
      const entry = daily.get(date);
      points.push({
        date,
        total: entry?.amount || 0,
        leadNumbers: entry ? Array.from(entry.leadNumbers) : [],
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return points;
  }, [paymentRows, fromDate, toDate]);

  const renderProgressChart = (
    title: string,
    data: Array<{ date: string; total: number; leadNumbers: string[] }>,
    color: string
  ) => (
    <section className="rounded-2xl bg-white p-5">
      <div className="mb-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <span className="text-sm font-medium text-gray-500">
            {formatGraphPeriodDate(fromDate)} – {formatGraphPeriodDate(toDate)}
          </span>
        </div>
        <p className="text-sm text-gray-500">Daily totals during the selected period</p>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
            <defs>
              <linearGradient id={`progress-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="date"
              tick={({ x, y, payload }: any) => (
                <text x={x} y={y + 12} textAnchor="middle" fontSize={11}>
                  <tspan fill="#374151">{formatGraphDate(payload.value)}</tspan>
                  <tspan fill={color}>{` ${formatGraphWeekday(payload.value)}`}</tspan>
                </text>
              )}
            />
            <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 11 }} width={45} />
            <Tooltip content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const point = payload[0]?.payload;
              return (
                <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                  <div className="font-semibold text-gray-900">
                    {formatGraphDate(String(label))} · {formatGraphWeekday(String(label))}
                  </div>
                  <div className="mt-1 font-semibold" style={{ color }}>
                    Daily total: {formatCurrency(Number(point?.total || 0))}
                  </div>
                  {point?.leadNumbers?.length > 0 && (
                    <div className="mt-1 max-w-64 text-xs text-gray-500">
                      Lead: {point.leadNumbers.join(', ')}
                    </div>
                  )}
                </div>
              );
            }} />
            <Area
              type="monotone"
              dataKey="total"
              stroke={color}
              strokeWidth={3}
              fill={`url(#progress-${color.replace('#', '')})`}
              dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
              activeDot={{ r: 5 }}
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );

  const showAllRolesSummary =
    isAllRolesMode && (leads.length > 0 || paymentRows.length > 0) && !loading;
  const showHandlerOnlyDueSummary = isHandlerRole && paymentRows.length > 0 && !loading;

  const headerTitleInitials = (employeeName || '??')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const modal = (
    <div
      className="fixed inset-0 z-[20000] isolate overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="employee-role-leads-modal-title"
    >
      <style>{`
        @keyframes modalChartFlip {
          from { opacity: 0; transform: perspective(1200px) rotateY(8deg) scale(0.985); }
          to { opacity: 1; transform: perspective(1200px) rotateY(0deg) scale(1); }
        }
      `}</style>
      <div
        className="fixed inset-0 z-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-lg bg-white shadow-2xl">
          <div className="relative flex items-start justify-between gap-3 p-6">
            <div className="relative z-10 flex items-start gap-3 md:gap-4 min-w-0 pr-2">
              {employeePhotoUrl && !headerPhotoError ? (
                <img
                  src={employeePhotoUrl}
                  alt=""
                  className="h-12 w-12 md:h-14 md:w-14 rounded-full object-cover flex-shrink-0"
                  onError={() => setHeaderPhotoError(true)}
                />
              ) : (
                <div
                  className="h-12 w-12 md:h-14 md:w-14 rounded-full flex-shrink-0 flex items-center justify-center bg-primary/10 text-primary text-sm md:text-base font-bold"
                  aria-hidden
                >
                  {headerTitleInitials}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="employee-role-leads-modal-title" className="truncate text-2xl font-bold leading-tight text-gray-900">
                    {employeeName}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setViewMode((current) => current === 'table' ? 'charts' : 'table')}
                    className="btn btn-ghost btn-sm btn-circle shrink-0"
                    title={viewMode === 'table' ? 'Show progress charts' : 'Show tables'}
                    aria-label={viewMode === 'table' ? 'Show progress charts' : 'Show tables'}
                  >
                    {viewMode === 'table' ? <ChartBarIcon className="h-5 w-5" /> : <TableCellsIcon className="h-5 w-5" />}
                  </button>
                </div>
                <p className="text-sm font-medium text-gray-700 mt-0.5">
                  {isAllRolesMode
                    ? 'All leads & handler payments'
                    : `${role} ${isHandlerRole ? 'Payment Rows' : 'Leads'}`}
                </p>
              </div>
            </div>
            <div className="relative z-10 ml-auto flex shrink-0 items-start gap-4">
              {showAllRolesSummary && (
                <div
                  className="pt-1"
                  role="status"
                  aria-label={`Total signed NIS ${totalSignedNis}, total due NIS ${totalDueNis}`}
                >
                  <div className="flex flex-wrap items-baseline justify-end gap-x-2 gap-y-1 text-right text-xs leading-tight sm:flex-nowrap sm:gap-x-4 sm:text-sm">
                  <span className="text-gray-600 font-medium">
                    Total signed
                    <span className="ms-1.5 sm:ms-2 font-bold text-gray-900 tabular-nums">
                      {formatCurrency(totalSignedNis)}
                    </span>
                  </span>
                  <span className="hidden sm:inline text-gray-300" aria-hidden>
                    |
                  </span>
                  <span className="text-gray-600 font-medium">
                    Total due
                    <span className="ms-1.5 sm:ms-2 font-bold text-gray-900 tabular-nums">
                      {formatCurrency(totalDueNis)}
                    </span>
                  </span>
                </div>
                </div>
              )}
              {showHandlerOnlyDueSummary && !isAllRolesMode && (
                <div
                  className="pt-1 text-right"
                  role="status"
                  aria-label={`Total due NIS ${totalDueNis}`}
                >
                  <p className="text-xs sm:text-sm text-gray-600 font-medium leading-tight">
                    Total due
                    <span className="ms-1.5 sm:ms-2 font-bold text-gray-900 tabular-nums">
                      {formatCurrency(totalDueNis)}
                    </span>
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-2">Loading...</span>
              </div>
            ) : (isHandlerRole ? paymentRows.length > 0 : isAllRolesMode ? leads.length + paymentRows.length > 0 : leads.length > 0) ? (
              <div className="overflow-x-auto space-y-8">
                {viewMode === 'charts' ? (
                  <div className="grid grid-cols-1 animate-[modalChartFlip_450ms_ease-out] gap-5 [transform-style:preserve-3d]">
                    {!isHandlerRole && leads.length > 0 && renderProgressChart('Signed leads', signedProgressData, '#4f46e5')}
                    {(isHandlerRole || isAllRolesMode) && paymentRows.length > 0 && renderProgressChart('Due/Invoiced payments', dueProgressData, '#0d9488')}
                  </div>
                ) : (
                <>
                {isHandlerRole ? (
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th className="text-left w-[1%] whitespace-nowrap pr-2">Handler</th>
                        <th>Case</th>
                        <th>Name</th>
                        <th>Client</th>
                        <th className="text-center">Order</th>
                        <th>Category</th>
                        <th>Notes</th>
                        <th className="text-right w-[1%] whitespace-nowrap pl-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRows.map((row, index) => (
                        <tr
                          key={row.id || index}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => handlePaymentRowClick(row)}
                        >
                          <td className="text-left align-top pr-2 whitespace-nowrap font-medium">{row.handler || '—'}</td>
                          <td className="font-mono text-sm align-top">{row.case || '—'}</td>
                          <td className="font-semibold">{row.name || '—'}</td>
                          <td>{row.client || '—'}</td>
                          <td className="text-center">{row.order || '—'}</td>
                          <td>{row.category || '—'}</td>
                          <td className="text-sm text-gray-600 align-top">{row.notes || '—'}</td>
                          <td className="text-right align-top pl-2 whitespace-nowrap">
                            {row.amount > 0
                              ? `${row.currency || '₪'}${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold bg-base-200">
                        <td className="text-left pl-2">Total</td>
                        <td colSpan={6}></td>
                        <td className="text-right pl-2 whitespace-nowrap">
                          {formatCurrency(
                            paymentRows.reduce((sum, row) => {
                              const currencyForConversion = row.currency || 'NIS';
                              const normalizedCurrency = currencyForConversion === '₪' ? 'NIS' :
                                currencyForConversion === '€' ? 'EUR' :
                                  currencyForConversion === '$' ? 'USD' :
                                    currencyForConversion === '£' ? 'GBP' : currencyForConversion;
                              return sum + convertToNIS(row.amount, normalizedCurrency);
                            }, 0)
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <>
                    {leads.length > 0 && (
                      <div>
                        {isAllRolesMode && (
                          <h3 className="text-lg font-semibold text-gray-800 mb-2">Signed leads</h3>
                        )}
                        <table className="table w-full">
                          <thead>
                            <tr>
                              <th>Role</th>
                              <th>Lead</th>
                              <th>Client Name</th>
                              <th>Category</th>
                              <th className="text-right">Applicants</th>
                              <th className="text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leads.map((lead, index) => (
                              <tr key={`${lead.leadId}-${index}`} className="hover:bg-gray-50">
                                <td>{lead.role}</td>
                                <td>
                                  <button
                                    onClick={() => handleLeadClick(lead)}
                                    className="text-primary hover:underline font-mono text-sm"
                                  >
                                    {lead.leadNumber}
                                  </button>
                                </td>
                                <td className="font-medium">{lead.clientName}</td>
                                <td>{lead.category}</td>
                                <td className="text-right">{lead.applicants}</td>
                                <td className="text-right font-semibold">{formatCurrency(lead.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="font-bold bg-base-200">
                              <td colSpan={4}>Total</td>
                              <td className="text-right">
                                {leads.reduce((sum, lead) => sum + lead.applicants, 0)}
                              </td>
                              <td className="text-right">
                                {formatCurrency(leads.reduce((sum, lead) => sum + lead.total, 0))}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                    {paymentRows.length > 0 && isAllRolesMode && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Handler — due payments (in range)</h3>
                        <table className="table w-full">
                          <thead>
                            <tr>
                              <th className="text-left w-[1%] whitespace-nowrap pr-2">Handler</th>
                              <th>Case</th>
                              <th>Name</th>
                              <th>Client</th>
                              <th className="text-center">Order</th>
                              <th>Category</th>
                              <th>Notes</th>
                              <th className="text-right w-[1%] whitespace-nowrap pl-2">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paymentRows.map((row, index) => (
                              <tr
                                key={row.id || index}
                                className="hover:bg-gray-50 cursor-pointer transition-colors"
                                onClick={() => handlePaymentRowClick(row)}
                              >
                                <td className="text-left align-top pr-2 whitespace-nowrap font-medium">{row.handler || '—'}</td>
                                <td className="font-mono text-sm align-top">{row.case || '—'}</td>
                                <td className="font-semibold">{row.name || '—'}</td>
                                <td>{row.client || '—'}</td>
                                <td className="text-center">{row.order || '—'}</td>
                                <td>{row.category || '—'}</td>
                                <td className="text-sm text-gray-600 align-top">{row.notes || '—'}</td>
                                <td className="text-right align-top pl-2 whitespace-nowrap">
                                  {row.amount > 0
                                    ? `${row.currency || '₪'}${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="font-bold bg-base-200">
                              <td className="text-left pl-2">Total</td>
                              <td colSpan={6}></td>
                              <td className="text-right pl-2 whitespace-nowrap">
                                {formatCurrency(
                                  paymentRows.reduce((sum, row) => {
                                    const currencyForConversion = row.currency || 'NIS';
                                    const normalizedCurrency = currencyForConversion === '₪' ? 'NIS' :
                                      currencyForConversion === '€' ? 'EUR' :
                                        currencyForConversion === '$' ? 'USD' :
                                          currencyForConversion === '£' ? 'GBP' : currencyForConversion;
                                    return sum + convertToNIS(row.amount, normalizedCurrency);
                                  }, 0)
                                )}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </>
                )}
                </>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                {isHandlerRole
                  ? 'No payment rows found for this role'
                  : isAllRolesMode
                    ? 'No signed leads or handler payments in this range'
                    : 'No leads found for this role'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default EmployeeRoleLeadsModal;
