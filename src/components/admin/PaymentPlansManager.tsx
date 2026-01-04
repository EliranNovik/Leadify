import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import { 
  PlusIcon, 
  PencilIcon, 
  TrashIcon, 
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon
} from '@heroicons/react/24/outline';

interface LegacyPaymentPlan {
  id: number;
  lead_id: string;
  client_id: number | null;
  date: string | null;
  due_date: string | null;
  value: number;
  vat_value: number;
  due_percent: string;
  order: number;
  currency_id: number;
  notes: string;
  cancel_date: string | null;
  ready_to_pay: boolean;
  actual_date: string | null;
  cdate: string;
  udate: string;
  accounting_currencies?: {
    name: string;
    iso_code: string;
  };
}

interface NewPaymentPlan {
  id: number;
  lead_id: string;
  due_date: string | null;
  value: number;
  value_vat: number;
  due_percent: number;
  percent?: number;
  payment_order: string;
  currency: string;
  notes: string;
  client_name: string;
  contract_id: string | null;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  cancel_date: string | null;
  ready_to_pay: boolean;
  created_at?: string;
  cdate?: string;
  date?: string;
  updated_at?: string;
  udate?: string;
  created_by?: string | null;
  updated_by?: string | null;
  proforma: string | null;
}

interface UnifiedPaymentPlan {
  id: number;
  lead_id: string;
  lead_type: 'legacy' | 'new';
  lead_number?: string;
  lead_name?: string;
  due_date: string | null;
  value: number;
  value_vat: number;
  due_percent: string | number;
  payment_order: string;
  currency: string;
  currency_symbol: string;
  notes: string;
  client_name: string;
  paid: boolean;
  paid_at: string | null;
  paid_by: string | null;
  cancel_date: string | null;
  ready_to_pay: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  // Legacy specific
  order?: number;
  actual_date?: string | null;
  // New specific
  contract_id?: string | null;
  proforma?: string | null;
}

interface Lead {
  id: string;
  lead_number: string;
  name: string;
  email: string;
  phone: string;
}

interface LegacyLead {
  id: number;
  name: string;
  email: string;
  phone: string;
}

interface LegacyContact {
  name: string;
  email?: string;
  phone?: string;
}

const PaymentPlansManager: React.FC = () => {
  const [paymentPlans, setPaymentPlans] = useState<UnifiedPaymentPlan[]>([]);
  const [leads, setLeads] = useState<{ [key: string]: Lead }>({});
  const [legacyLeads, setLegacyLeads] = useState<{ [key: string]: LegacyLead }>({});
  const [selectedPlan, setSelectedPlan] = useState<UnifiedPaymentPlan | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlan, setEditedPlan] = useState<UnifiedPaymentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearchTerm, setActiveSearchTerm] = useState(''); // The search term actually used in queries
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);

  // State for total count
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Handle search button click - set active search term and reset to page 1
  const handleSearch = () => {
    setActiveSearchTerm(searchTerm);
    setCurrentPage(1);
  };

  // Handle clear search
  const handleClearSearch = () => {
    setSearchTerm('');
    setActiveSearchTerm('');
    setCurrentPage(1);
  };

  // Fetch payment plans and leads
  useEffect(() => {
    fetchLeads();
    fetchLegacyLeads();
  }, []);

  // Fetch payment plans when page or active search changes
  useEffect(() => {
    fetchPaymentPlans();
  }, [currentPage, activeSearchTerm]);

  const fetchLeads = async (): Promise<{ [key: string]: Lead }> => {
    try {
      const { data, error } = await supabase
        .from('leads')
        .select('id, lead_number, name, email, phone');

      if (error) throw error;
      
      const leadsMap: { [key: string]: Lead } = {};
      data?.forEach(lead => {
        leadsMap[lead.id] = lead;
      });
      setLeads(leadsMap);
      return leadsMap;
    } catch (error) {
      console.error('Error fetching leads:', error);
      return {};
    }
  };

  const fetchLegacyLeads = async (): Promise<{ [key: string]: LegacyLead }> => {
    try {
      const { data, error } = await supabase
        .from('leads_lead')
        .select('id, name, email, phone');

      if (error) throw error;
      
      const legacyLeadsMap: { [key: string]: LegacyLead } = {};
      data?.forEach(lead => {
        legacyLeadsMap[String(lead.id)] = lead;
      });
      setLegacyLeads(legacyLeadsMap);
      return legacyLeadsMap;
    } catch (error) {
      console.error('Error fetching legacy leads:', error);
      return {};
    }
  };

  const fetchLegacyClients = async (clientIds: (number | null)[]): Promise<{ [key: number]: { name: string; email?: string; phone?: string } }> => {
    try {
      // Filter out null values
      const validClientIds = clientIds.filter((id): id is number => id !== null);
      
      if (validClientIds.length === 0) {
        return {};
      }

      console.log('🔍 [PaymentPlansManager] Fetching legacy clients via lead_leadcontact:', {
        clientIdsCount: validClientIds.length,
        sampleIds: validClientIds.slice(0, 10)
      });

      // Batch the queries (Supabase has limits on .in() clause size, typically 1000)
      const batchSize = 1000;
      const allLeadContacts: any[] = [];
      
      for (let i = 0; i < validClientIds.length; i += batchSize) {
        const batch = validClientIds.slice(i, i + batchSize);
        console.log(`🔍 [PaymentPlansManager] Fetching lead_leadcontact batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validClientIds.length / batchSize)} (${batch.length} IDs)...`);
        
        const { data: leadContactsBatch, error: leadContactsError } = await supabase
          .from('lead_leadcontact')
          .select('id, contact_id')
          .in('id', batch);

        if (leadContactsError) {
          console.error(`❌ [PaymentPlansManager] Error fetching lead_leadcontact batch ${Math.floor(i / batchSize) + 1}:`, leadContactsError);
          // Continue with other batches instead of throwing
          continue;
        }

        if (leadContactsBatch) {
          allLeadContacts.push(...leadContactsBatch);
        }
      }

      console.log('🔍 [PaymentPlansManager] Found lead-contact relationships:', {
        count: allLeadContacts.length,
        sample: allLeadContacts.slice(0, 5)
      });

      if (allLeadContacts.length === 0) {
        return {};
      }

      // Extract unique contact_ids
      const contactIdsSet = new Set<number>();
      allLeadContacts.forEach(lc => {
        if (lc.contact_id !== null && lc.contact_id !== undefined) {
          contactIdsSet.add(lc.contact_id);
        }
      });
      const contactIds = Array.from(contactIdsSet);

      console.log('🔍 [PaymentPlansManager] Fetching contacts from leads_contact:', {
        contactIdsCount: contactIds.length,
        sampleIds: contactIds.slice(0, 10)
      });

      if (contactIds.length === 0) {
        return {};
      }

      // Batch the contact queries as well
      const allContacts: any[] = [];
      for (let i = 0; i < contactIds.length; i += batchSize) {
        const batch = contactIds.slice(i, i + batchSize);
        console.log(`🔍 [PaymentPlansManager] Fetching leads_contact batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(contactIds.length / batchSize)} (${batch.length} IDs)...`);
        
        const { data: contactsBatch, error: contactsError } = await supabase
          .from('leads_contact')
          .select('id, name, email, phone')
          .in('id', batch);

        if (contactsError) {
          console.error(`❌ [PaymentPlansManager] Error fetching leads_contact batch ${Math.floor(i / batchSize) + 1}:`, contactsError);
          // Continue with other batches instead of throwing
          continue;
        }

        if (contactsBatch) {
          allContacts.push(...contactsBatch);
        }
      }

      console.log('🔍 [PaymentPlansManager] Found contacts:', {
        count: allContacts.length,
        sample: allContacts.slice(0, 5)
      });

      // Create a map: contact_id -> contact info
      const contactsMap = new Map<number, { name: string; email?: string; phone?: string }>();
      allContacts.forEach(contact => {
        contactsMap.set(contact.id, {
          name: contact.name || 'Unknown',
          email: contact.email || undefined,
          phone: contact.phone || undefined
        });
      });

      // Create the final map: client_id (lead_leadcontact.id) -> contact info
      const clientsMap: { [key: number]: { name: string; email?: string; phone?: string } } = {};
      allLeadContacts.forEach(lc => {
        if (lc.contact_id && contactsMap.has(lc.contact_id)) {
          clientsMap[lc.id] = contactsMap.get(lc.contact_id)!;
        }
      });

      console.log('🔍 [PaymentPlansManager] Final clients map:', {
        count: Object.keys(clientsMap).length,
        sample: Object.keys(clientsMap).slice(0, 5).map(key => ({
          clientId: key,
          name: clientsMap[Number(key)]?.name
        }))
      });

      return clientsMap;
    } catch (error) {
      console.error('❌ [PaymentPlansManager] Error fetching legacy clients:', error);
      return {};
    }
  };

  const getCurrencySymbol = (currency: string | number): string => {
    if (typeof currency === 'number') {
      // Legacy currency_id mapping
      switch (currency) {
        case 1: return '₪';
        case 2: return '€';
        case 3: return '$';
        case 4: return '£';
        default: return '₪';
      }
    }
    // New currency string
    switch (currency?.toUpperCase()) {
      case 'USD': return '$';
      case 'NIS':
      case 'ILS': 
      case '₪': return '₪';
      case 'EUR': 
      case '€': return '€';
      case 'GBP':
      case '£': return '£';
      default: return currency || '₪';
    }
  };

  const getOrderText = (order: number | string): string => {
    if (typeof order === 'number') {
      // Legacy order number
      switch (order) {
        case 1: return 'First Payment';
        case 5: return 'Intermediate Payment';
        case 9: return 'Final Payment';
        case 90: return 'Single Payment';
        case 99: return 'Expense (no VAT)';
        default: return 'First Payment';
      }
    }
    // New order string
    return order as string;
  };

  const fetchPaymentPlans = async () => {
    setLoading(true);
    try {
      // Get legacy leads map (for fallback names)
      const legacyLeadsMap = await fetchLegacyLeads();

      // Helper function to build legacy count query with filters
      const buildLegacyCountQuery = () => {
        let query = supabase
          .from('finances_paymentplanrow')
          .select('*', { count: 'exact', head: true })
          .is('cancel_date', null);

        // Apply exact match search filter at database level for legacy plans
        if (activeSearchTerm) {
          const searchAsNumber = parseInt(activeSearchTerm);
          const isNumeric = !isNaN(searchAsNumber) && activeSearchTerm.trim() === String(searchAsNumber);
          
          if (isNumeric) {
            // Exact match on lead_id if search term is a number
            query = query.eq('lead_id', activeSearchTerm);
          }
          // If not numeric, no search (exact match only works on numeric lead_id)
        }
        
        return query;
      };

      // Helper function to build legacy data query with filters and pagination
      const buildLegacyDataQuery = (from: number, to: number) => {
        let query = supabase
          .from('finances_paymentplanrow')
          .select(`
            *,
            accounting_currencies!finances_paymentplanrow_currency_id_fkey (
              name,
              iso_code
            )
          `, { count: 'exact' })
          .is('cancel_date', null);

        // Apply exact match search filter at database level for legacy plans
        if (activeSearchTerm) {
          const searchAsNumber = parseInt(activeSearchTerm);
          const isNumeric = !isNaN(searchAsNumber) && activeSearchTerm.trim() === String(searchAsNumber);
          
          if (isNumeric) {
            // Exact match on lead_id if search term is a number
            query = query.eq('lead_id', activeSearchTerm);
          }
          // If not numeric, no search (exact match only works on numeric lead_id)
        }
        
        return query
          .order('cdate', { ascending: false })
          .range(from, to);
      };

      // Helper function to build new count query with filters
      const buildNewCountQuery = () => {
        let query = supabase
          .from('payment_plans')
          .select('*', { count: 'exact', head: true })
          .is('cancel_date', null);

        // Apply exact match search filter at database level for new plans
        if (activeSearchTerm) {
          // Exact match on lead_id
          query = query.eq('lead_id', activeSearchTerm);
        }
        
        return query;
      };

      // Helper function to build new data query with filters and pagination
      const buildNewDataQuery = (from: number, to: number) => {
        let query = supabase
          .from('payment_plans')
          .select('*', { count: 'exact' })
          .is('cancel_date', null);

        // Apply exact match search filter at database level for new plans
        if (activeSearchTerm) {
          // Exact match on lead_id
          query = query.eq('lead_id', activeSearchTerm);
        }
        
        return query
          .order('id', { ascending: false })
          .range(from, to);
      };

      // Get total count for legacy plans (with filters applied)
      const { count: legacyCount, error: legacyCountError } = await buildLegacyCountQuery();

      if (legacyCountError) {
        console.error('❌ [PaymentPlansManager] Error getting legacy count:', legacyCountError);
      }

      // Get total count for new plans (with filters applied)
      const { count: newCount, error: newCountError } = await buildNewCountQuery();

      if (newCountError) {
        console.error('❌ [PaymentPlansManager] Error getting new count:', newCountError);
      }

      // Calculate totals - always show all (legacy + new)
      let totalLegacyCount = legacyCount || 0;
      let totalNewCount = newCount || 0;
      let totalCountValue = totalLegacyCount + totalNewCount;

      const calculatedTotalPages = Math.ceil(totalCountValue / pageSize);
      setTotalCount(totalCountValue);
      setTotalPages(calculatedTotalPages);

      console.log('🔍 [PaymentPlansManager] Fetching page data:', {
        currentPage,
        pageSize,
        totalCount: totalCountValue,
        totalPages: calculatedTotalPages,
        legacyCount: totalLegacyCount,
        newCount: totalNewCount,
        searchTerm: activeSearchTerm
      });

      // Fetch legacy data - always fetch all (we'll combine and paginate client-side)
      let legacyData: any[] = [];
      let legacyError: any = null;

      // Fetch all legacy (we'll combine and paginate client-side)
      let legacyFrom = 0;
      let legacyTo = Math.max(0, totalLegacyCount - 1);

      const { data: fetchedLegacyData, error: fetchedLegacyError } = await buildLegacyDataQuery(
        Math.max(0, legacyFrom), 
        Math.max(0, legacyTo)
      );

      legacyData = fetchedLegacyData || [];
      legacyError = fetchedLegacyError;

      if (fetchedLegacyError) {
        console.error('❌ [PaymentPlansManager] Error fetching legacy payment plans:', fetchedLegacyError);
      }

      // Extract unique client_ids from legacy payment plans
      const clientIds = (legacyData || [])
        .map((plan: LegacyPaymentPlan) => plan.client_id)
        .filter((id): id is number => id !== null);
      
      console.log('🔍 [PaymentPlansManager] Client IDs to fetch:', {
        count: clientIds.length,
        sample: clientIds.slice(0, 10)
      });
      
      // Fetch client information using client_id
      const legacyClientsMap = await fetchLegacyClients(clientIds);
      console.log('🔍 [PaymentPlansManager] Legacy clients map:', {
        count: Object.keys(legacyClientsMap).length,
        sample: Object.keys(legacyClientsMap).slice(0, 5).map(key => ({
          id: key,
          name: legacyClientsMap[Number(key)]?.name
        }))
      });

      // Fetch new data - always fetch all (we'll combine and paginate client-side)
      let newData: any[] = [];
      let newError: any = null;

      // Fetch all new (we'll combine and paginate client-side)
      let newFrom = 0;
      let newTo = Math.max(0, totalNewCount - 1);

      const { data: fetchedNewData, error: fetchedNewError } = await buildNewDataQuery(
        Math.max(0, newFrom), 
        Math.max(0, newTo)
      );

      newData = fetchedNewData || [];
      newError = fetchedNewError;

      if (fetchedNewError) {
        console.error('❌ [PaymentPlansManager] Error fetching new payment plans:', fetchedNewError);
      }

      // Get leads map for new payment plans
      const leadsMap = await fetchLeads();

      // Collect unique lead_ids that we need but don't have in the map yet
      const missingLeadIds = new Set<number>();
      (legacyData || []).forEach((plan: LegacyPaymentPlan) => {
        if (plan.lead_id && !plan.client_id) {
          // Only fetch lead if client_id is null (no contact available)
          const leadIdStr = String(plan.lead_id);
          if (!legacyLeadsMap[leadIdStr]) {
            missingLeadIds.add(Number(plan.lead_id));
          }
        }
      });

      // Fetch missing leads in batches
      if (missingLeadIds.size > 0) {
        console.log(`🔍 [PaymentPlansManager] Fetching ${missingLeadIds.size} missing leads for fallback...`);
        const missingLeadIdsArray = Array.from(missingLeadIds);
        const batchSize = 1000;
        
        for (let i = 0; i < missingLeadIdsArray.length; i += batchSize) {
          const batch = missingLeadIdsArray.slice(i, i + batchSize);
          const { data: missingLeads, error: missingLeadsError } = await supabase
            .from('leads_lead')
            .select('id, name, email, phone')
            .in('id', batch);
          
          if (!missingLeadsError && missingLeads) {
            missingLeads.forEach(lead => {
              legacyLeadsMap[String(lead.id)] = lead;
            });
          }
        }
        
        console.log(`✅ [PaymentPlansManager] Fetched ${missingLeadIds.size} missing leads, total in map: ${Object.keys(legacyLeadsMap).length}`);
      }

      // Transform legacy payment plans
      console.log('🔍 [PaymentPlansManager] Transforming legacy payment plans...');
      const legacyPlans: UnifiedPaymentPlan[] = (legacyData || []).map((plan: LegacyPaymentPlan) => {
        const currency = plan.accounting_currencies?.name || '₪';
        // Use client_id to get client name from lead_leadcontact -> leads_contact
        // If no contact found, fallback to lead name from leads_lead
        const client = plan.client_id ? legacyClientsMap[plan.client_id] : null;
        const lead = plan.lead_id ? legacyLeadsMap[String(plan.lead_id)] : null;
        
        // Fallback logic: contact name -> lead name -> Unknown
        let clientName = 'Unknown';
        if (client?.name) {
          clientName = client.name;
        } else if (lead?.name) {
          clientName = lead.name;
        }
        
        // Debug for specific lead_id 74225
        if (Number(plan.lead_id) === 74225) {
          console.log(`🔍 [PaymentPlansManager] Transforming lead_id 74225 plan:`, {
            planId: plan.id,
            client_id: plan.client_id,
            lead_id: plan.lead_id,
            hasClient: !!client,
            clientName: client?.name,
            hasLead: !!lead,
            leadName: lead?.name,
            finalClientName: clientName
          });
        }
        
        return {
          id: plan.id,
          lead_id: String(plan.lead_id || ''),
          lead_type: 'legacy',
          due_date: plan.due_date,
          value: Number(plan.value || 0),
          value_vat: Number(plan.vat_value || 0),
          due_percent: plan.due_percent,
          payment_order: getOrderText(plan.order),
          currency: currency,
          currency_symbol: getCurrencySymbol(plan.currency_id),
          notes: plan.notes || '',
          client_name: clientName,
          paid: !!plan.actual_date,
          paid_at: plan.actual_date,
          paid_by: null,
          cancel_date: plan.cancel_date,
          ready_to_pay: plan.ready_to_pay || false,
          created_at: plan.cdate,
          updated_at: plan.udate,
          created_by: null,
          updated_by: null,
          order: plan.order,
          actual_date: plan.actual_date,
        };
      });

      console.log('🔍 [PaymentPlansManager] Legacy plans transformed:', {
        count: legacyPlans.length,
        sample: legacyPlans.slice(0, 3).map(p => ({
          id: p.id,
          lead_id: p.lead_id,
          client_name: p.client_name
        }))
      });

      // Check if lead_id 74225 is in transformed plans
      const targetLeadId = '74225';
      const transformedPlansWith74225 = legacyPlans.filter(p => p.lead_id === targetLeadId);
      console.log(`🔍 [PaymentPlansManager] Transformed plans with lead_id ${targetLeadId}:`, {
        count: transformedPlansWith74225.length,
        plans: transformedPlansWith74225.map(p => ({
          id: p.id,
          lead_id: p.lead_id,
          client_name: p.client_name,
          value: p.value
        }))
      });

      // Transform new payment plans
      console.log('🔍 [PaymentPlansManager] Transforming new payment plans...');
      const newPlans: UnifiedPaymentPlan[] = (newData || []).map((plan: any) => {
        const lead = leadsMap[plan.lead_id];
        // Handle different possible date column names
        const createdDate = plan.created_at || plan.cdate || plan.date || new Date().toISOString();
        const updatedDate = plan.updated_at || plan.udate || createdDate;
        
        return {
          id: plan.id,
          lead_id: plan.lead_id,
          lead_type: 'new',
          lead_number: lead?.lead_number,
          lead_name: lead?.name,
          due_date: plan.due_date,
          value: Number(plan.value || 0),
          value_vat: Number(plan.value_vat || 0),
          due_percent: plan.due_percent,
          payment_order: plan.payment_order,
          currency: plan.currency,
          currency_symbol: getCurrencySymbol(plan.currency),
          notes: plan.notes || '',
          client_name: plan.client_name || lead?.name || 'Unknown',
          paid: plan.paid || false,
          paid_at: plan.paid_at,
          paid_by: plan.paid_by,
          cancel_date: plan.cancel_date,
          ready_to_pay: plan.ready_to_pay || false,
          created_at: createdDate,
          updated_at: updatedDate,
          created_by: plan.created_by || null,
          updated_by: plan.updated_by || null,
          contract_id: plan.contract_id,
          proforma: plan.proforma,
        };
      });

      // Combine plans
      let combined = [...legacyPlans, ...newPlans];
      
      // Sort by creation date (newest first)
      combined.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Apply client-side pagination only if we have 'all' filter (mixed legacy + new)
      // Otherwise, pagination was already applied at DB level
      // Paginate the combined results
      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize;
      let finalPlans = combined.slice(from, to);

      console.log('🔍 [PaymentPlansManager] Final plans:', {
        fetchedLegacy: legacyPlans.length,
        fetchedNew: newPlans.length,
        combined: combined.length,
        final: finalPlans.length,
        currentPage,
        totalCount: totalCountValue
      });

      setPaymentPlans(finalPlans);
    } catch (error) {
      console.error('Error fetching payment plans:', error);
      toast.error('Failed to fetch payment plans');
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = (plan: UnifiedPaymentPlan) => {
    setSelectedPlan(plan);
    setEditedPlan({ ...plan });
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editedPlan) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.email || 'System';

      if (editedPlan.lead_type === 'legacy') {
        // Update legacy payment plan
        const currencyId = editedPlan.currency === '₪' ? 1 :
                          editedPlan.currency === '€' ? 2 :
                          editedPlan.currency === '$' ? 3 :
                          editedPlan.currency === '£' ? 4 : 1;

        const orderNumber = editedPlan.payment_order === 'First Payment' ? 1 :
                           editedPlan.payment_order === 'Intermediate Payment' ? 5 :
                           editedPlan.payment_order === 'Final Payment' ? 9 :
                           editedPlan.payment_order === 'Single Payment' ? 90 :
                           editedPlan.payment_order === 'Expense (no VAT)' ? 99 : 1;

        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({
            date: editedPlan.due_date,
            due_date: editedPlan.due_date,
            value: editedPlan.value,
            vat_value: editedPlan.value_vat,
            due_percent: String(editedPlan.due_percent),
            order: orderNumber,
            currency_id: currencyId,
            notes: editedPlan.notes,
            ready_to_pay: editedPlan.ready_to_pay,
            udate: new Date().toISOString().split('T')[0],
          })
          .eq('id', editedPlan.id);

        if (error) throw error;
      } else {
        // Update new payment plan
        const { error } = await supabase
          .from('payment_plans')
          .update({
            due_date: editedPlan.due_date,
            value: editedPlan.value,
            value_vat: editedPlan.value_vat,
            due_percent: Number(editedPlan.due_percent),
            percent: Number(editedPlan.due_percent),
            payment_order: editedPlan.payment_order,
            currency: editedPlan.currency,
            notes: editedPlan.notes,
            client_name: editedPlan.client_name,
            ready_to_pay: editedPlan.ready_to_pay,
            updated_at: new Date().toISOString(),
            updated_by: currentUser,
          })
          .eq('id', editedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment plan updated successfully');
      await fetchPaymentPlans();
      setIsEditing(false);
      setSelectedPlan(editedPlan);
    } catch (error) {
      console.error('Error saving payment plan:', error);
      toast.error('Failed to save payment plan');
    }
  };

  const handleChangeStatus = async () => {
    if (!selectedPlan || !selectedPlan.paid) return;

    if (!confirm('Are you sure you want to change this payment status from Paid to Pending?')) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentUser = user?.email || 'System';

      if (selectedPlan.lead_type === 'legacy') {
        // For legacy leads, clear actual_date
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ 
            actual_date: null,
            udate: new Date().toISOString().split('T')[0]
          })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      } else {
        // For new leads, set paid to false and clear paid_at
        const { error } = await supabase
          .from('payment_plans')
          .update({ 
            paid: false,
            paid_at: null,
            paid_by: null,
            updated_at: new Date().toISOString(),
            updated_by: currentUser
          })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment status changed to Pending');
      
      // Refresh payment plans first
      await fetchPaymentPlans();
      
      // Update the selected plan to reflect the change
      const updatedPlan: UnifiedPaymentPlan = {
        ...selectedPlan,
        paid: false,
        paid_at: null,
        actual_date: null,
      };
      setSelectedPlan(updatedPlan);
      setEditedPlan({ ...updatedPlan });
    } catch (error) {
      console.error('Error changing payment status:', error);
      toast.error('Failed to change payment status');
    }
  };

  const handleDelete = async () => {
    if (!selectedPlan) return;

    if (!confirm('Are you sure you want to delete this payment plan?')) return;

    try {
      if (selectedPlan.lead_type === 'legacy') {
        // Soft delete legacy payment plan
        const { error } = await supabase
          .from('finances_paymentplanrow')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      } else {
        // Soft delete new payment plan
        const { error } = await supabase
          .from('payment_plans')
          .update({ cancel_date: new Date().toISOString().split('T')[0] })
          .eq('id', selectedPlan.id);

        if (error) throw error;
      }

      toast.success('Payment plan deleted successfully');
      setSelectedPlan(null);
      setEditedPlan(null);
      setIsEditing(false);
      await fetchPaymentPlans();
    } catch (error) {
      console.error('Error deleting payment plan:', error);
      toast.error('Failed to delete payment plan');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // No client-side filtering - all filtering done at database level with exact match
  const paginatedPlans = paymentPlans;

  // Show loading spinner when fetching
  const isActuallyLoading = loading;
  
  if (isActuallyLoading && paginatedPlans.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="w-full">
      {!selectedPlan ? (
        // Table View
        <>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold">Payment Plans</h2>
            <div className="text-sm text-gray-500">
              Total: {totalCount} payment plans
            </div>
          </div>

          {/* Search */}
          <div className="mb-6 flex items-center gap-2">
            <div className="flex items-center gap-2 border border-base-300 rounded-lg p-1">
              <span className="px-2 text-base-content/60">
                <MagnifyingGlassIcon className="w-4 h-4" />
              </span>
              <input
                type="text"
                placeholder="Search by lead ID (exact match)..."
                className="input input-sm border-0 focus:outline-none w-48 bg-transparent"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearch();
                  }
                }}
              />
            </div>
            <div className="h-8 w-px bg-base-300"></div>
            <button 
              className="btn btn-primary btn-sm"
              onClick={handleSearch}
            >
              Search
            </button>
            {activeSearchTerm && (
              <>
                <div className="h-8 w-px bg-base-300"></div>
                <button 
                  className="btn btn-square btn-outline btn-sm"
                  onClick={handleClearSearch}
                  title="Clear search"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </>
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto bg-base-100 rounded-lg shadow">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="text-left">Lead #</th>
                  <th className="text-left">Client</th>
                  <th className="text-left">Order</th>
                  <th className="text-left">Currency</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">VAT</th>
                  <th className="text-right">Total</th>
                  <th className="text-left">Due Date</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPlans.map((plan) => {
                  const total = plan.value + plan.value_vat;
                  
                  return (
                    <tr 
                      key={`${plan.lead_type}-${plan.id}`}
                      className="cursor-pointer"
                      onClick={() => handleRowClick(plan)}
                    >
                      <td className="font-bold">
                        {plan.lead_number || plan.lead_id}
                      </td>
                      <td className="max-w-xs truncate">
                        {plan.client_name}
                      </td>
                      <td className="text-sm">
                        {plan.payment_order}
                      </td>
                      <td className="font-mono">
                        {plan.currency_symbol}
                      </td>
                      <td className="font-mono text-right">
                        {plan.value.toLocaleString()}
                      </td>
                      <td className="font-mono text-right">
                        {plan.value_vat.toLocaleString()}
                      </td>
                      <td className="font-mono text-right font-bold">
                        {total.toLocaleString()}
                      </td>
                      <td className="font-mono text-sm">
                        {formatDate(plan.due_date)}
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded font-semibold ${plan.paid ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>
                          {plan.paid ? 'Paid' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-4">
            {paginatedPlans.map((plan) => {
              const total = plan.value + plan.value_vat;
              
              return (
                <div 
                  key={`${plan.lead_type}-${plan.id}`}
                  className="card bg-base-100 shadow-lg cursor-pointer group"
                  onClick={() => handleRowClick(plan)}
                >
                  <div className="card-body p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors">
                        {plan.client_name}
                      </h2>
                      <div className="badge badge-primary badge-sm">
                        {plan.currency_symbol}{total.toLocaleString()}
                      </div>
                    </div>
                    
                    <p className="text-sm text-base-content/60 font-mono mb-4">
                      #{plan.lead_number || plan.lead_id} • {plan.payment_order}
                    </p>

                    <div className="divider my-0"></div>

                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mt-4">
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Due Date</div>
                        <div className="font-medium">{formatDate(plan.due_date)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Status</div>
                        <div>
                          <span className={`px-2 py-1 rounded font-semibold ${plan.paid ? 'bg-green-500 text-white' : 'bg-yellow-500 text-white'}`}>
                            {plan.paid ? 'Paid' : 'Pending'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">Value</div>
                        <div>{plan.currency_symbol}{plan.value.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-base-content/60 mb-1">VAT</div>
                        <div>{plan.currency_symbol}{plan.value_vat.toLocaleString()}</div>
                      </div>
                    </div>

                    {plan.notes && (
                      <div className="mt-4 pt-4 border-t border-base-200/50">
                        <p className="text-sm font-semibold text-base-content/80">
                          {plan.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-6">
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeftIcon className="w-4 h-4" />
              </button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        // Detail/Edit View
        <div className="bg-base-100 rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-4">
              <button 
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSelectedPlan(null);
                  setEditedPlan(null);
                  setIsEditing(false);
                }}
              >
                ← Back to List
              </button>
              <h3 className="text-xl font-bold">Payment Plan Details</h3>
              <span className={`badge ${selectedPlan.lead_type === 'legacy' ? 'badge-warning' : 'badge-info'}`}>
                {selectedPlan.lead_type === 'legacy' ? 'Legacy Lead' : 'New Lead'}
              </span>
            </div>
            <div className="flex gap-2">
              {!isEditing ? (
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={handleEdit}
                >
                  <PencilIcon className="w-4 h-4 mr-1" />
                  Edit
                </button>
              ) : (
                <>
                  <button 
                    className="btn btn-success btn-sm"
                    onClick={handleSave}
                  >
                    Save
                  </button>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setIsEditing(false);
                      setEditedPlan({ ...selectedPlan });
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
              <button 
                className="btn btn-error btn-sm"
                onClick={handleDelete}
              >
                <TrashIcon className="w-4 h-4 mr-1" />
                Delete
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            {/* Column 1 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Lead Number</span>
                </label>
                <div className="p-3">
                  {selectedPlan.lead_number || selectedPlan.lead_id}
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Client Name</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editedPlan?.client_name || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, client_name: e.target.value } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.client_name}
                  </div>
                )}
              </div>
            </div>

            {/* Column 2 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Payment Order</span>
                </label>
                {isEditing ? (
                  <select
                    className="select select-bordered w-full"
                    value={editedPlan?.payment_order || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, payment_order: e.target.value } : null)}
                  >
                    <option value="First Payment">First Payment</option>
                    <option value="Intermediate Payment">Intermediate Payment</option>
                    <option value="Final Payment">Final Payment</option>
                    <option value="Single Payment">Single Payment</option>
                    <option value="Expense (no VAT)">Expense (no VAT)</option>
                    <option value="One-time Payment">One-time Payment</option>
                  </select>
                ) : (
                  <div className="p-3">
                    {selectedPlan.payment_order}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Due Date</span>
                </label>
                {isEditing ? (
                  <input
                    type="date"
                    className="input input-bordered w-full"
                    value={editedPlan?.due_date || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, due_date: e.target.value || null } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {formatDate(selectedPlan.due_date)}
                  </div>
                )}
              </div>
            </div>

            {/* Column 3 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Currency</span>
                </label>
                {isEditing ? (
                  <select
                    className="select select-bordered w-full"
                    value={editedPlan?.currency || '₪'}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, currency: e.target.value } : null)}
                  >
                    <option value="₪">₪ (NIS)</option>
                    <option value="USD">$ (USD)</option>
                    <option value="EUR">€ (EUR)</option>
                    <option value="GBP">£ (GBP)</option>
                  </select>
                ) : (
                  <div className="p-3">
                    {selectedPlan.currency_symbol} ({selectedPlan.currency})
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Due Percent</span>
                </label>
                {isEditing ? (
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={editedPlan?.due_percent || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, due_percent: e.target.value } : null)}
                    placeholder="e.g., 25% or 25"
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.due_percent}
                  </div>
                )}
              </div>
            </div>

            {/* Column 4 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Value</span>
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={editedPlan?.value || 0}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, value: parseFloat(e.target.value) || 0 } : null)}
                  />
                ) : (
                  <div className="p-3 font-mono">
                    {selectedPlan.currency_symbol}{selectedPlan.value.toLocaleString()}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">VAT</span>
                </label>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    className="input input-bordered w-full"
                    value={editedPlan?.value_vat || 0}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, value_vat: parseFloat(e.target.value) || 0 } : null)}
                  />
                ) : (
                  <div className="p-3 font-mono">
                    {selectedPlan.currency_symbol}{selectedPlan.value_vat.toLocaleString()}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Total</span>
                </label>
                <div className="p-3 font-mono font-bold text-lg">
                  {selectedPlan.currency_symbol}{(selectedPlan.value + selectedPlan.value_vat).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Column 5 */}
            <div className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Ready to Pay</span>
                </label>
                {isEditing ? (
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={editedPlan?.ready_to_pay || false}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, ready_to_pay: e.target.checked } : null)}
                  />
                ) : (
                  <div className="p-3">
                    {selectedPlan.ready_to_pay ? 'Yes (sent to finance)' : 'No'}
                  </div>
                )}
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Status</span>
                </label>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span>{selectedPlan.paid ? 'Paid' : 'Pending'}</span>
                    {selectedPlan.paid && !isEditing && (
                      <button
                        className="btn btn-xs btn-outline btn-warning"
                        onClick={handleChangeStatus}
                        title="Change status from Paid to Pending"
                      >
                        Mark as Pending
                      </button>
                    )}
                  </div>
                  {selectedPlan.paid && (
                    <div className="text-xs text-gray-500 mt-1">
                      {selectedPlan.lead_type === 'legacy' && selectedPlan.actual_date ? (
                        <>Paid on: {formatDate(selectedPlan.actual_date)}</>
                      ) : selectedPlan.lead_type === 'new' && selectedPlan.paid_at ? (
                        <>Paid on: {formatDate(selectedPlan.paid_at)}</>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-semibold">Notes</span>
                </label>
                {isEditing ? (
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={3}
                    value={editedPlan?.notes || ''}
                    onChange={(e) => setEditedPlan(prev => prev ? { ...prev, notes: e.target.value } : null)}
                  />
                ) : (
                  <div className="p-3 min-h-[4rem]">
                    {selectedPlan.notes || 'No notes'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="mt-6 pt-6 border-t border-base-300">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-semibold">Created:</span> {formatDateTime(selectedPlan.created_at)}
                {selectedPlan.created_by && (
                  <div className="text-xs text-gray-500">by {selectedPlan.created_by}</div>
                )}
              </div>
              <div>
                <span className="font-semibold">Updated:</span> {formatDateTime(selectedPlan.updated_at)}
                {selectedPlan.updated_by && (
                  <div className="text-xs text-gray-500">by {selectedPlan.updated_by}</div>
                )}
              </div>
              {selectedPlan.paid_by && (
                <div>
                  <span className="font-semibold">Paid By:</span> {selectedPlan.paid_by}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentPlansManager;

