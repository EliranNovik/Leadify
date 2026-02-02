import React, { useState, useEffect } from 'react';
import { XMarkIcon, EyeIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { convertToNIS } from '../lib/currencyConversion';
import { useNavigate } from 'react-router-dom';
import { buildCurrencyMeta, parseNumericAmount } from '../utils/salesContributionCalculator';

interface LeadRow {
  role: string;
  leadNumber: string;
  clientName: string;
  category: string;
  applicants: number;
  total: number;
  leadId: string | number;
  leadType: 'new' | 'legacy';
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
    if (isOpen && employeeId && role) {
      if (role === 'Handler') {
        fetchPaymentRows();
      } else {
        fetchLeads();
      }
    }
  }, [isOpen, employeeId, role, fromDate, toDate]);

  const fetchPaymentRows = async () => {
    setLoading(true);
    try {
      const fromDateTimeForPayments = fromDate ? `${fromDate}T00:00:00` : null;
      const toDateTimeForPayments = toDate ? `${toDate}T23:59:59` : null;

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

      // Fetch new leads where employee is handler
      const { data: handlerNewLeads } = await supabase
        .from('leads')
        .select('id, handler, case_handler_id')
        .or(`handler.eq.${employeeDisplayName},case_handler_id.eq.${employeeId}`);

      if (handlerNewLeads && handlerNewLeads.length > 0) {
        const handlerNewLeadIds = handlerNewLeads.map(l => l.id).filter(Boolean);

        // Fetch payment plans for these leads with due dates in range
        let newPaymentsQuery = supabase
          .from('payment_plans')
          .select(`
            id,
            lead_id,
            value,
            value_vat,
            currency,
            due_date,
            cancel_date,
            ready_to_pay,
            payment_order,
            notes
          `)
          .eq('ready_to_pay', true)
          .not('due_date', 'is', null)
          .is('cancel_date', null)
          .in('lead_id', handlerNewLeadIds);

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

            // Fetch handler names
            const handlerMap = new Map<number, string>();
            const handlerIds = new Set<number>();
            newLeads.forEach(lead => {
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
            newPayments.forEach(payment => {
              const lead = newLeads.find(l => l.id === payment.lead_id);
              if (!lead) return;

              const contactName = contactsByLead.get(payment.lead_id) || null;
              const handlerId = lead.case_handler_id ? Number(lead.case_handler_id) : null;
              const handlerName = handlerId ? (handlerMap.get(handlerId) || '—') : '—';

              let categoryDisplay = '—';
              if (lead.category_id) {
                categoryDisplay = getCategoryName(lead.category_id, lead.category);
              } else if (lead.category) {
                categoryDisplay = getCategoryName(null, lead.category);
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
        let legacyPaymentsQuery = supabase
          .from('finances_paymentplanrow')
          .select(`
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
            accounting_currencies!finances_paymentplanrow_currency_id_fkey(name, iso_code)
          `)
          .not('due_date', 'is', null)
          .is('cancel_date', null)
          .in('lead_id', handlerLegacyLeadIds);

        if (fromDateTimeForPayments) {
          legacyPaymentsQuery = legacyPaymentsQuery.gte('due_date', fromDateTimeForPayments);
        }
        if (toDateTimeForPayments) {
          legacyPaymentsQuery = legacyPaymentsQuery.lte('due_date', toDateTimeForPayments);
        }

        const { data: legacyPayments, error: legacyPaymentsError } = await legacyPaymentsQuery;

        if (!legacyPaymentsError && legacyPayments && legacyPayments.length > 0) {
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
            legacyPayments.forEach(payment => {
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
              });
            });
          }
        }
      }

      setPaymentRows(paymentRowsData);
    } catch (error) {
      console.error('Error fetching payment rows:', error);
    } finally {
      setLoading(false);
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

  const fetchLeads = async () => {
    setLoading(true);
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

      stageHistoryData?.forEach((entry: any) => {
        if (entry.newlead_id) {
          newLeadIds.add(entry.newlead_id.toString());
        }
        if (entry.lead_id !== null && entry.lead_id !== undefined) {
          legacyLeadIds.add(Number(entry.lead_id));
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
            expert,
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

            if (lead.closer) {
              const closerValue = lead.closer;
              const matches = typeof closerValue === 'string'
                ? closerValue.toLowerCase() === employeeName.toLowerCase()
                : Number(closerValue) === employeeId;
              if (matches) roles.push('Closer');
            }

            if (lead.scheduler) {
              const schedulerValue = lead.scheduler;
              const matches = typeof schedulerValue === 'string'
                ? schedulerValue.toLowerCase() === employeeName.toLowerCase()
                : Number(schedulerValue) === employeeId;
              if (matches) roles.push('Scheduler');
            }

            if (lead.helper) {
              const helperValue = lead.helper;
              const matches = typeof helperValue === 'string'
                ? helperValue.toLowerCase() === employeeName.toLowerCase()
                : Number(helperValue) === employeeId;
              if (matches) roles.push('Helper Closer');
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

            if (lead.expert) {
              if (Number(lead.expert) === employeeId) {
                roles.push('Expert');
              }
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

            const requiredRoles = role.split(',').map(r => r.trim());
            const hasAllRoles = requiredRoles.every(reqRole => roles.includes(reqRole));
            const hasExactMatch = requiredRoles.length === roles.length && hasAllRoles;

            if (hasExactMatch) {
              // Check if this is "Handler only" - exclude from signed totals (same logic as main report)
              const isHandlerOnly = roles.length === 1 && roles[0] === 'Handler';

              const balanceAmount = parseFloat(lead.balance || 0);
              const proposalAmount = parseFloat(lead.proposal_total || 0);
              const rawAmount = balanceAmount || proposalAmount || 0;
              const accountingCurrencies = Array.isArray(lead.accounting_currencies) ? lead.accounting_currencies[0] : lead.accounting_currencies;
              const currencyCode = accountingCurrencies?.iso_code || lead.balance_currency || lead.proposal_currency || 'NIS';
              const amountNIS = convertToNIS(rawAmount, currencyCode);

              // For signed total logic: exclude handler-only leads (set to 0)
              // Use full amount (without subtracting fee) - modal is correct
              const totalForSigned = isHandlerOnly ? 0 : amountNIS;

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
                role: roles.join(', '),
                leadNumber: leadNumberDisplay,
                clientName,
                category: categoryDisplay,
                applicants,
                total: totalForSigned, // Use signed total logic (0 for handler-only)
                leadId: lead.id,
                leadType: 'new',
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

            if (lead.expert_id && Number(lead.expert_id) === employeeId) {
              roles.push('Expert');
            }

            if (lead.meeting_manager_id && Number(lead.meeting_manager_id) === employeeId) {
              roles.push('Meeting Manager');
            }

            const requiredRoles = role.split(',').map(r => r.trim());
            const hasAllRoles = requiredRoles.every(reqRole => roles.includes(reqRole));
            const hasExactMatch = requiredRoles.length === roles.length && hasAllRoles;

            if (hasExactMatch) {
              // Check if this is "Handler only" - exclude from signed totals (same logic as main report)
              const isHandlerOnly = roles.length === 1 && roles[0] === 'Handler';

              // Calculate amount same way as SalesContributionPage (lines 1451-1480)
              // For legacy leads: if currency_id is 1 (NIS/ILS), use total_base; otherwise use total
              const currencyId = lead.currency_id;
              const numericCurrencyId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : Number(currencyId);
              let resolvedAmount = 0;
              if (numericCurrencyId === 1) {
                // Use total_base for NIS/ILS currency
                resolvedAmount = parseNumericAmount(lead.total_base) || 0;
              } else {
                // Use total for other currencies
                resolvedAmount = parseNumericAmount(lead.total) || 0;
              }

              // Build currency meta - prioritize accounting_currencies.iso_code (actual currency) over currency_id
              const currencyMeta = buildCurrencyMeta(
                lead.accounting_currencies,
                lead.meeting_total_currency_id,
                lead.currency_id
              );

              // Convert to NIS using currencyMeta.conversionValue
              const amountNIS = convertToNIS(resolvedAmount, currencyMeta.conversionValue);

              // For signed total logic: exclude handler-only leads (set to 0)
              // Use full amount (without subtracting fee) - modal is correct
              const totalForSigned = isHandlerOnly ? 0 : amountNIS;

              const leadNumberDisplay = lead.id?.toString() || '';
              const miscCategory = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
              const categoryName = miscCategory?.name || '—';
              const mainCategory = Array.isArray(miscCategory?.misc_maincategory) ? miscCategory.misc_maincategory[0] : miscCategory?.misc_maincategory;
              const mainCategoryName = mainCategory?.name;
              const categoryDisplay = mainCategoryName
                ? `${categoryName} (${mainCategoryName})`
                : categoryName;

              const clientName = lead.name || '—';
              const applicants = Number(lead.no_of_applicants) || 0;

              allLeads.push({
                role: roles.join(', '),
                leadNumber: leadNumberDisplay,
                clientName,
                category: categoryDisplay,
                applicants,
                total: totalForSigned, // Use signed total logic (0 for handler-only, amountAfterFee for others)
                leadId: lead.id,
                leadType: 'legacy',
              });
            }
          });
        }
      }

      setLeads(allLeads);
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
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

  const isHandlerRole = role === 'Handler';
  const displayData = isHandlerRole ? paymentRows : leads;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {role} {isHandlerRole ? 'Payment Rows' : 'Leads'} - {employeeName}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {displayData.length} {isHandlerRole ? 'payment row' : 'lead'}{displayData.length !== 1 ? 's' : ''} • {fromDate} to {toDate}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="ml-2">Loading...</span>
              </div>
            ) : displayData.length > 0 ? (
              <div className="overflow-x-auto">
                {isHandlerRole ? (
                  <table className="table w-full">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Client</th>
                        <th className="text-right">Amount</th>
                        <th className="text-center">Order</th>
                        <th>Handler</th>
                        <th>Case</th>
                        <th>Category</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRows.map((row, index) => (
                        <tr
                          key={row.id || index}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => handlePaymentRowClick(row)}
                        >
                          <td className="font-semibold">{row.name || '—'}</td>
                          <td>{row.client || '—'}</td>
                          <td className="text-right">
                            {row.amount > 0
                              ? `${row.currency || '₪'}${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'
                            }
                          </td>
                          <td className="text-center">{row.order || '—'}</td>
                          <td>{row.handler || '—'}</td>
                          <td className="font-mono text-sm">{row.case || '—'}</td>
                          <td>{row.category || '—'}</td>
                          <td className="text-sm text-gray-600">{row.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold bg-base-200">
                        <td colSpan={2}>Total</td>
                        <td className="text-right">
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
                        <td colSpan={5}></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
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
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                {isHandlerRole ? 'No payment rows found for this role' : 'No leads found for this role'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeRoleLeadsModal;
