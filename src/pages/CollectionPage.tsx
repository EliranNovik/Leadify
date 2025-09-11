import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ExclamationTriangleIcon, CurrencyDollarIcon, CalendarIcon, DocumentTextIcon, Squares2X2Icon, Bars3Icon, PrinterIcon, EnvelopeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useNavigate } from 'react-router-dom';
import FinancesTab from '../components/client-tabs/FinancesTab'; // If not already imported
import toast from 'react-hot-toast';

const COLLECTION_LABEL_OPTIONS = [
  { value: 'Important' },
  { value: 'Follow up' },
  { value: 'No answer' },
  { value: 'Due' },
  { value: 'Overdue' },
];

const CollectionPage: React.FC = () => {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'no_payment' | 'awaiting' | 'paid' | 'paid_cases'>('no_payment');
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
  const navigate = useNavigate();

  // --- Summary values (mock logic for now) ---
  const [totalPaid, setTotalPaid] = useState(0);
  const [dueSoon, setDueSoon] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [showPaidChart, setShowPaidChart] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [labelInput, setLabelInput] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [showContractModal, setShowContractModal] = useState(false);
  const [showProformaModal, setShowProformaModal] = useState(false);
  const [selectedProforma, setSelectedProforma] = useState<any>(null);

  // Add state for mock data arrays for all tabs
  const [awaitingPayments, setAwaitingPayments] = useState<any[]>([]);

  // Legacy leads state for each category
  const [legacyNoPaymentLeads, setLegacyNoPaymentLeads] = useState<any[]>([]);
  const [legacyAwaitingPayments, setLegacyAwaitingPayments] = useState<any[]>([]);
  const [legacyPaidMeetings, setLegacyPaidMeetings] = useState<any[]>([]);
  const [legacyPaidCases, setLegacyPaidCases] = useState<any[]>([]);
  const [legacyLeadsLoading, setLegacyLeadsLoading] = useState(false);

  const [paidMeetings, setPaidMeetings] = useState<any[]>([
    {
      id: 1,
      lead_number: 'L20001',
      name: 'Noah Cohen',
      date: '2024-07-03',
      total: 600,
      details: 'Paid in full',
    },
    {
      id: 2,
      lead_number: 'L20002',
      name: 'Olivia Levi',
      date: '2024-07-04',
      total: 200,
      details: 'Paid in full',
    },
    {
      id: 3,
      lead_number: 'L20003',
      name: 'Liam Katz',
      date: '2024-07-05',
      total: 1200,
      details: 'Paid in full',
    },
    {
      id: 4,
      lead_number: 'L20004',
      name: 'Maya Gold',
      date: '2024-07-06',
      total: 950,
      details: 'Paid in full',
    },
  ]);

  // Mock data for paid by month (last 5 months)
  // const paidByMonth = [ ... ];

  // Helper for currency symbol (copied from Clients.tsx)
  const getCurrencySymbol = (currencyCode?: string) => {
    switch (currencyCode) {
      case 'USD':
        return '$';
      case 'EUR':
        return '€';
      case 'NIS':
        return '₪';
      default:
        return '₪';
    }
  };

  // Function to fetch legacy leads for each category
  const fetchLegacyLeads = async () => {
    setLegacyLeadsLoading(true);
    try {
      console.log('🔍 Fetching legacy leads for collection page...');
      
      // First, fetch leads that have stage 60 (contract signed) from leads_leadstage
      console.log('📋 Fetching leads with stage 60 (contract signed)...');
      const { data: stage60Leads, error: stageError } = await supabase
        .from('leads_leadstage')
        .select(`
          id,
          lead_id,
          date,
          stage
        `)
        .eq('stage', 60)
        .order('date', { ascending: false });

      if (stageError) {
        console.error('❌ Error fetching stage 60 leads:', stageError);
        return;
      }

      console.log('✅ Stage 60 leads fetched:', stage60Leads?.length || 0);

      if (!stage60Leads || stage60Leads.length === 0) {
        console.log('ℹ️ No stage 60 leads found');
        setLegacyLeadsLoading(false);
        return;
      }

      // Extract unique lead IDs from stage 60 records
      const leadIds = [...new Set(stage60Leads.map(record => record.lead_id).filter(Boolean))];
      console.log('📄 Unique lead IDs from stage 60:', leadIds.length);

      // Fetch the actual lead details for these leads
      const { data: legacyLeads, error } = await supabase
        .from('leads_lead')
        .select(`
          id,
          name,
          stage,
          total,
          currency_id,
          cdate,
          udate,
          status,
          expert_id,
          meeting_manager_id,
          category_id,
          collection_label,
          collection_comments,
          meeting_paid
        `)
        .in('id', leadIds)
        .eq('status', 0) // Only active leads
        .order('cdate', { ascending: false });

      if (error) {
        console.error('❌ Error fetching legacy leads:', error);
        return;
      }

      console.log('✅ Legacy leads fetched:', legacyLeads?.length || 0);

      if (legacyLeads && legacyLeads.length > 0) {
        // Create a map of lead_id to stage 60 date (contract signed date)
        const leadToStage60DateMap = new Map();
        stage60Leads.forEach(record => {
          if (record.lead_id) {
            leadToStage60DateMap.set(record.lead_id, record.date);
          }
        });

        // Check for payment plans in finances_paymentplanrow
        console.log('💰 Checking for payment plans in finances_paymentplanrow...');
        const { data: paymentPlans, error: paymentError } = await supabase
          .from('finances_paymentplanrow')
          .select('lead_id')
          .in('lead_id', leadIds);

        if (paymentError) {
          console.error('❌ Error fetching payment plans:', paymentError);
        } else {
          console.log('✅ Payment plans found:', paymentPlans?.length || 0);
        }

        // Create a set of lead IDs that have payment plans
        // Handle potential type mismatches between lead.id and plan.lead_id
        const leadsWithPaymentPlans = new Set();
        (paymentPlans || []).forEach(plan => {
          if (plan.lead_id) {
            // Add both string and number versions to handle type mismatches
            leadsWithPaymentPlans.add(plan.lead_id);
            leadsWithPaymentPlans.add(Number(plan.lead_id));
            leadsWithPaymentPlans.add(String(plan.lead_id));
          }
        });

        console.log('🔍 Payment plan debugging:');
        console.log('  - Total payment plans found:', paymentPlans?.length || 0);
        console.log('  - Sample payment plan lead_ids:', paymentPlans?.slice(0, 5).map(p => ({ id: p.lead_id, type: typeof p.lead_id })));
        console.log('  - Sample legacy lead IDs:', leadIds.slice(0, 5).map(id => ({ id, type: typeof id })));
        console.log('  - Payment plan lead_ids set size:', leadsWithPaymentPlans.size);
        console.log('  - Payment plan set contents:', Array.from(leadsWithPaymentPlans).slice(0, 10));
        
        // Debug: Check if any legacy leads have matching payment plans
        const sampleLegacyLeads = legacyLeads.slice(0, 5);
        sampleLegacyLeads.forEach(lead => {
          const hasPaymentPlan = leadsWithPaymentPlans.has(lead.id);
          const hasPaymentPlanString = leadsWithPaymentPlans.has(String(lead.id));
          const hasPaymentPlanNumber = leadsWithPaymentPlans.has(Number(lead.id));
          console.log(`  - Legacy lead ${lead.id} (${lead.name}): hasPaymentPlan=${hasPaymentPlan}, hasPaymentPlanString=${hasPaymentPlanString}, hasPaymentPlanNumber=${hasPaymentPlanNumber}, meeting_paid=${lead.meeting_paid}`);
          console.log(`  - Full lead object keys:`, Object.keys(lead));
          console.log(`  - Lead object sample:`, {
            id: lead.id,
            name: lead.name,
            stage: lead.stage,
            meeting_paid: lead.meeting_paid,
            meeting_paid_type: typeof lead.meeting_paid,
            has_meeting_paid: 'meeting_paid' in lead
          });
        });
        
        // Debug: Check all unique meeting_paid values
        const uniqueMeetingPaidValues = [...new Set(legacyLeads.map(lead => lead.meeting_paid))];
        console.log('🔍 Unique meeting_paid values found:', uniqueMeetingPaidValues);

        // Fetch related data for better display
        const employeeIds = [...new Set([
          ...legacyLeads.map(lead => lead.expert_id).filter(Boolean),
          ...legacyLeads.map(lead => lead.meeting_manager_id).filter(Boolean)
        ])];
        const categoryIds = [...new Set(legacyLeads.map(lead => lead.category_id).filter(Boolean))];
        const stageIds = [...new Set(legacyLeads.map(lead => lead.stage).filter(Boolean))];
        console.log('🔍 Stage IDs to fetch:', stageIds.slice(0, 10));
        console.log('🔍 Stage IDs types:', stageIds.slice(0, 5).map(id => ({ id, type: typeof id })));

        // Fetch employee names, category names, and stage names
        const [employeeResult, categoryResult, stageResult] = await Promise.allSettled([
          employeeIds.length > 0 ? supabase.from('tenants_employee').select('id, display_name').in('id', employeeIds) : Promise.resolve({ data: [] }),
          categoryIds.length > 0 ? supabase.from('misc_category').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [] }),
          stageIds.length > 0 ? supabase.from('lead_stages').select('id, name').in('id', stageIds) : Promise.resolve({ data: [] })
        ]);

        const employeeMap = new Map();
        const categoryMap = new Map();
        const stageMap = new Map();

        if (employeeResult.status === 'fulfilled' && employeeResult.value.data) {
          employeeResult.value.data.forEach(emp => {
            employeeMap.set(emp.id, emp.display_name);
          });
        }

        if (categoryResult.status === 'fulfilled' && categoryResult.value.data) {
          categoryResult.value.data.forEach(cat => {
            categoryMap.set(cat.id, cat.name);
          });
        }

        if (stageResult.status === 'fulfilled' && stageResult.value.data) {
          console.log('🔍 Stage result data:', stageResult.value.data.slice(0, 3));
          stageResult.value.data.forEach(stage => {
            stageMap.set(stage.id, stage.name);
          });
          console.log('🔍 Stage map created with', stageMap.size, 'entries');
          console.log('🔍 Sample stage entries:', Array.from(stageMap.entries()).slice(0, 5));
        } else {
          console.log('❌ Stage result not fulfilled or no data:', stageResult);
        }

        // Process and categorize legacy leads
        const processedLegacyLeads = legacyLeads.map(lead => ({
          ...lead,
          lead_type: 'legacy',
          lead_number: lead.id?.toString() || '',
          expert_name: employeeMap.get(lead.expert_id) || 'Not assigned',
          manager_name: employeeMap.get(lead.meeting_manager_id) || 'Not assigned',
          category_name: categoryMap.get(lead.category_id) || 'Not specified',
          stage_name: stageMap.get(lead.stage) || `Stage ${lead.stage}`,
          currency_symbol: getCurrencySymbol(lead.currency_id?.toString()),
          amount: lead.total || 0,
          cdate: lead.cdate, // Add cdate field for date filtering
          contract_signed_date: leadToStage60DateMap.get(lead.id) || null, // Date when contract was signed (stage 60)
          meeting_paid: lead.meeting_paid || false // Add meeting_paid field for categorization
        }));

        // Categorize leads based on payment plan availability, contract status, and meeting_paid status
        // Note: We show leads at stage 60 and over stage 60 in noPaymentLeads
        // But exclude stages 100, 105, and 110 from noPaymentLeads
        // Also exclude leads where meeting_paid stage is reached (they go to paid meetings tab)
        
        const noPaymentLeads = processedLegacyLeads.filter(lead => {
          const hasPaymentPlan = leadsWithPaymentPlans.has(lead.id);
          const meetsStageCriteria = lead.stage && lead.stage >= 60 && ![100, 105, 110].includes(lead.stage);
          const isMeetingPaid = lead.meeting_paid === true || lead.meeting_paid === "true" || lead.stage_name === 'meeting_paid';
          const shouldInclude = !hasPaymentPlan && meetsStageCriteria && !isMeetingPaid;
          
          // Debug logging for first few leads
          if (lead.id <= 5 || lead.id % 100 === 0) {
            console.log(`🔍 Lead ${lead.id} (${lead.name}): stage=${lead.stage}, stage_name=${lead.stage_name}, hasPaymentPlan=${hasPaymentPlan}, meetsStageCriteria=${meetsStageCriteria}, meeting_paid=${isMeetingPaid}, shouldInclude=${shouldInclude}`);
          }
          
          return shouldInclude;
        });

        const awaitingPaymentLeads = processedLegacyLeads.filter(lead => 
          leadsWithPaymentPlans.has(lead.id) && lead.stage && lead.stage < 100 // Has payment plan but not completed
        );

        // Updated paid meetings logic: include leads with meeting_paid=true OR meeting_paid stage OR leads with payment plans meeting criteria
        const paidMeetingsLeads = processedLegacyLeads.filter(lead => {
          const hasPaymentPlan = leadsWithPaymentPlans.has(lead.id);
          const meetsPaymentPlanCriteria = hasPaymentPlan && lead.stage && lead.stage >= 60 && lead.stage < 100 && lead.total && lead.total > 0;
          const isMeetingPaid = lead.meeting_paid === true || lead.meeting_paid === "true" || lead.stage_name === 'meeting_paid';
          
          return meetsPaymentPlanCriteria || isMeetingPaid;
        });

        const paidCasesLeads = processedLegacyLeads.filter(lead => 
          leadsWithPaymentPlans.has(lead.id) && lead.stage && lead.stage >= 100 // Has payment plan and completed
        );

        console.log('📊 Legacy leads categorized:', {
          total: processedLegacyLeads.length,
          noPayment: noPaymentLeads.length,
          awaiting: awaitingPaymentLeads.length,
          paidMeetings: paidMeetingsLeads.length,
          paidCases: paidCasesLeads.length,
          withPaymentPlans: leadsWithPaymentPlans.size,
          withoutPaymentPlans: processedLegacyLeads.length - leadsWithPaymentPlans.size,
          stage60Leads: processedLegacyLeads.filter(lead => lead.stage === 60).length,
          stage60PlusLeads: processedLegacyLeads.filter(lead => lead.stage && lead.stage >= 60).length,
          stage100Leads: processedLegacyLeads.filter(lead => lead.stage === 100).length,
          stage105Leads: processedLegacyLeads.filter(lead => lead.stage === 105).length,
          stage110Leads: processedLegacyLeads.filter(lead => lead.stage === 110).length,
          excludedStages: processedLegacyLeads.filter(lead => [100, 105, 110].includes(lead.stage) && !leadsWithPaymentPlans.has(lead.id)).length,
          meetingPaidLeads: processedLegacyLeads.filter(lead => lead.meeting_paid === true || lead.meeting_paid === "true" || lead.stage_name === 'meeting_paid').length
        });

        console.log('🔍 Sample no payment leads:', noPaymentLeads.slice(0, 3).map(lead => ({
          id: lead.id,
          name: lead.name,
          stage: lead.stage,
          stage_name: lead.stage_name,
          contract_signed_date: lead.contract_signed_date,
          hasPaymentPlan: leadsWithPaymentPlans.has(lead.id)
        })));
        
        // Debug: Check what stage names are actually being assigned
        console.log('🔍 Stage name debugging:');
        noPaymentLeads.slice(0, 5).forEach(lead => {
          console.log(`  Lead ${lead.id} (${lead.name}): stage=${lead.stage}, stage_name="${lead.stage_name}", stageMap.get(${lead.stage})="${stageMap.get(lead.stage)}"`);
        });

        console.log('🔍 Stage mapping sample:', Array.from(stageMap.entries()).slice(0, 5));
        
        // Debug: Check for meeting_paid stage
        const meetingPaidStageId = Array.from(stageMap.entries()).find(([id, name]) => name === 'meeting_paid');
        console.log('🔍 Meeting paid stage lookup:', meetingPaidStageId ? `ID: ${meetingPaidStageId[0]}, Name: ${meetingPaidStageId[1]}` : 'Not found');
        
        // Debug: Check how many leads have the meeting_paid stage
        const leadsWithMeetingPaidStage = processedLegacyLeads.filter(lead => lead.stage_name === 'meeting_paid');
        console.log('🔍 Leads with meeting_paid stage:', leadsWithMeetingPaidStage.length);
        if (leadsWithMeetingPaidStage.length > 0) {
          console.log('🔍 Sample leads with meeting_paid stage:', leadsWithMeetingPaidStage.slice(0, 3).map(lead => ({
            id: lead.id,
            name: lead.name,
            stage: lead.stage,
            stage_name: lead.stage_name
          })));
        }
        
        // Debug: Check how many leads have meeting_paid: "true" (string)
        const leadsWithMeetingPaidTrue = processedLegacyLeads.filter(lead => lead.meeting_paid === "true");
        console.log('🔍 Leads with meeting_paid: "true" (string):', leadsWithMeetingPaidTrue.length);
        if (leadsWithMeetingPaidTrue.length > 0) {
          console.log('🔍 Sample leads with meeting_paid: "true":', leadsWithMeetingPaidTrue.slice(0, 3).map(lead => ({
            id: lead.id,
            name: lead.name,
            stage: lead.stage,
            meeting_paid: lead.meeting_paid
          })));
        }

        // Log breakdown of leads by stage and payment plan status
        console.log('🔍 Detailed breakdown:');
        const stageBreakdown = new Map();
        processedLegacyLeads.forEach(lead => {
          const stage = lead.stage || 'unknown';
          const hasPaymentPlan = leadsWithPaymentPlans.has(lead.id);
          const key = `Stage ${stage} (${hasPaymentPlan ? 'with' : 'without'} payment plan)`;
          stageBreakdown.set(key, (stageBreakdown.get(key) || 0) + 1);
        });
        console.log('Stage breakdown:', Object.fromEntries(stageBreakdown));

        setLegacyNoPaymentLeads(noPaymentLeads);
        setLegacyAwaitingPayments(awaitingPaymentLeads);
        setLegacyPaidMeetings(paidMeetingsLeads);
        setLegacyPaidCases(paidCasesLeads);
      }
    } catch (error) {
      console.error('❌ Error in fetchLegacyLeads:', error);
    } finally {
      setLegacyLeadsLoading(false);
    }
  };

  // Mock proforma data
  const mockProformaData = {
    number: 'PR-2024-001',
    date: '2024-07-01',
    dueDate: '2024-07-15',
    createdAt: '2024-07-01T10:30:00Z',
    createdBy: 'Sarah Cohen',
    client: {
      name: 'David Lee',
      address: '123 Business Street, Tel Aviv, Israel',
      phone: '+972-50-123-4567',
      email: 'david.lee@example.com'
    },
    company: {
      name: 'Decker Pex Levi Lawoffices',
      address: 'WE Tower TLV, 150 Begin Rd., Tel Aviv, Israel',
      phone: '+972-3-123-4567',
      email: 'info@lawoffices.org.il',
      vatNumber: 'IL123456789',
      companyNumber: '12345678'
    },
    items: [
      {
        description: 'German Citizenship Application Services',
        quantity: 1,
        unitPrice: 10000,
        vatRate: 17,
        amount: 10000
      },
      {
        description: 'Document Preparation & Translation',
        quantity: 1,
        unitPrice: 2000,
        vatRate: 17,
        amount: 2000
      }
    ]
  };

  const calculateTotals = (items: any[]) => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const vat = items.reduce((sum, item) => sum + (item.amount * item.vatRate / 100), 0);
    const total = subtotal + vat;
    return { subtotal, vat, total };
  };

  const handleProformaClick = (proformaNumber: string) => {
    setSelectedProforma({ 
      ...mockProformaData, 
      number: proformaNumber,
      createdAt: new Date().toISOString(),
      createdBy: 'Current User' // In real app, get from auth context
    });
    setShowProformaModal(true);
  };

  const handlePrintProforma = () => {
    window.print();
  };

  const handleSendToClient = () => {
    // Mock functionality - in real app, this would send email
    alert(`Proforma ${selectedProforma?.number} sent to ${selectedProforma?.client.email}`);
  };

  // 1. Add state for collection comments and label
  const [collectionLabelInput, setCollectionLabelInput] = useState('');
  const [collectionComments, setCollectionComments] = useState<any[]>([]);
  const [newCollectionComment, setNewCollectionComment] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);

  // Add state for current user
  const [currentUserName, setCurrentUserName] = useState<string>('');

  // Add state for total paid this month
  const [totalPaidThisMonth, setTotalPaidThisMonth] = useState<number>(0);

  // Add handler to remove payment from awaitingPayments
  const handlePaymentMarkedPaid = async (paymentId: string | number) => {
    let paidBy = 'Unknown';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        const { data: userData, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && userData?.full_name) {
          paidBy = userData.full_name;
        } else {
          paidBy = user.email;
        }
      }
    } catch {}
    // Update DB
    const { error } = await supabase
      .from('payment_plans')
      .update({
        paid: true,
        paid_at: new Date().toISOString(),
        paid_by: paidBy,
      })
      .eq('id', paymentId);
    if (!error) {
      setAwaitingPayments(prev => prev.filter(p => p.id !== paymentId));
      toast.success('Payment marked as paid!');
    } else {
      toast.error('Failed to mark as paid.');
    }
  };

  useEffect(() => {
    if (tab === 'no_payment') {
      const fetchLeads = async () => {
        setLoading(true);
        const { data, error } = await supabase
          .from('leads')
          .select('id, lead_number, name, date_signed, balance, stage, collection_label, collection_comments')
          .in('stage', ['Client Signed Agreement', 'Client signed agreement']);
        if (!error && data) {
          setLeads(data);
        } else {
          setLeads([]);
        }
        setLoading(false);
      };
      fetchLeads();
    }

    // Mock logic: Replace with real queries as needed
    // Total Paid (this month): sum of paidMeetings in current month
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const paidThisMonth = paidMeetings.filter(m => {
      const d = new Date(m.date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    setTotalPaid(paidThisMonth.reduce((sum, m) => sum + (m.total || 0), 0));

    // Due Soon: count of awaitingPayments (mock: all in array)
    setDueSoon(awaitingPayments.length);

    // Overdue: count of leads with next_followup in the past (mock: 1)
    setOverdue(1);

    // Fetch current user info on mount
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user && user.email) {
        // Try to get full_name from users table
        const { data, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('email', user.email)
          .single();
        if (!error && data?.full_name) {
          setCurrentUserName(data.full_name);
        } else {
          setCurrentUserName(user.email);
        }
      }
    };
    fetchUser();
  }, [tab, paidMeetings, awaitingPayments]);

  // Fetch total paid this month independently
  useEffect(() => {
    const fetchTotalPaidThisMonth = async () => {
      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();
      const startOfMonth = new Date(thisYear, thisMonth, 1);
      const endOfMonth = new Date(thisYear, thisMonth + 1, 0);

      const { data, error } = await supabase
        .from('payment_plans')
        .select('value, value_vat, paid_at')
        .eq('paid', true)
        .gte('paid_at', startOfMonth.toISOString())
        .lte('paid_at', endOfMonth.toISOString());

      if (!error && data) {
        const total = data.reduce((sum, row) => {
          return sum + (Number(row.value) + Number(row.value_vat));
        }, 0);
        setTotalPaidThisMonth(total);
      } else {
        setTotalPaidThisMonth(0);
      }
    };

    fetchTotalPaidThisMonth();
  }, []); // Empty dependency array means this runs once on mount

  // Fetch legacy leads when component mounts
  useEffect(() => {
    fetchLegacyLeads();
  }, []); // Empty dependency array means this runs once on mount

  useEffect(() => {
    const fetchAwaitingPayments = async () => {
      setLoading(true);
      
      // Fetch legacy payment plan rows where actual_date IS NULL (payment hasn't been made yet)
      console.log('🔍 Fetching awaiting payments from finances_paymentplanrow (legacy)...');
      console.log('🔍 Filtering: paid=false, actual_date IS NULL, date NOT NULL, due_date NOT NULL');
      const { data: legacyData, error: legacyError } = await supabase
        .from('finances_paymentplanrow')
        .select(`
          id,
          lead_id,
          date,
          due_date,
          value,
          value_base,
          vat_value,
          vat_value_base,
          "order",
          notes,
          currency_id
        `)
        .is('actual_date', null) // Payment hasn't been made yet
        .not('date', 'is', null) // Payment is scheduled
        .not('due_date', 'is', null) // Only fetch payment plans with a due date
        .order('date', { ascending: true });
      
      if (legacyError) {
        console.log('❌ Error fetching legacy payment plans:', legacyError);
        setAwaitingPayments([]);
        setLoading(false);
        return;
      }
      
      console.log('✅ Legacy payment plans fetched:', legacyData?.length || 0);
      
      // Now fetch new payment plans from payment_plans table where paid = false
      console.log('🔍 Fetching awaiting payments from payment_plans (new)...');
      console.log('🔍 Filtering: paid=false, due_date NOT NULL');
      const { data: newData, error: newError } = await supabase
        .from('payment_plans')
        .select(`
          id,
          lead_id,
          date,
          due_date,
          value,
          value_base,
          value_vat,
          vat_value_base,
          "order",
          notes,
          currency_id,
          client_name,
          payment_order,
          proforma,
          currency
        `)
        .eq('paid', false) // Payment hasn't been made yet
        .not('due_date', 'is', null) // Only fetch payment plans with a due date
        .order('date', { ascending: true });
      
      if (newError) {
        console.log('❌ Error fetching new payment plans:', newError);
        setAwaitingPayments([]);
        setLoading(false);
        return;
      }
      
      console.log('✅ New payment plans fetched:', newData?.length || 0);
      
      if (newData && newData.length > 0) {
        console.log('🔍 Sample new payment plan columns:', Object.keys(newData[0]));
        console.log('🔍 Sample new payment plan data:', newData[0]);
      }
      
      // Combine both datasets
      const allPaymentPlans = [
        ...(legacyData || []).map(row => ({ ...row, source: 'legacy' })),
        ...(newData || []).map(row => ({ ...row, source: 'new' }))
      ];
      
      console.log('✅ Combined payment plans:', allPaymentPlans.length);
      
      if (allPaymentPlans.length === 0) {
        setAwaitingPayments([]);
        setLoading(false);
        return;
      }
      
      // Now fetch the lead information for these payment plans
      if (allPaymentPlans && allPaymentPlans.length > 0) {
        const leadIds = [...new Set(allPaymentPlans.map(row => row.lead_id))];
        console.log('🔍 Fetching lead information for payment plan lead_ids:', leadIds.slice(0, 10));
        
        // Log some sample currency_ids to see what we're working with
        const sampleCurrencyIds = allPaymentPlans.slice(0, 10).map(row => row.currency_id).filter(Boolean);
        console.log('🔍 Sample currency_ids from payment plans:', sampleCurrencyIds);
        
        // Show the breakdown of currency_ids
        const currencyIdCounts = allPaymentPlans.reduce((acc: any, row) => {
          if (row.currency_id) {
            acc[row.currency_id] = (acc[row.currency_id] || 0) + 1;
          }
          return acc;
        }, {});
        console.log('🔍 Currency ID breakdown:', currencyIdCounts);
        
        // Separate legacy and new lead IDs
        const legacyLeadIds = allPaymentPlans
          .filter(row => row.source === 'legacy')
          .map(row => row.lead_id);
        
        const newLeadIds = allPaymentPlans
          .filter(row => row.source === 'new' && row.lead_id)
          .map(row => row.lead_id);
        
        console.log('🔍 Legacy lead IDs:', legacyLeadIds.length, 'New lead IDs:', newLeadIds.length);
        
        // Fetch legacy leads from leads_lead table
        let legacyLeadData = null;
        if (legacyLeadIds.length > 0) {
          const { data: legacyData, error: legacyLeadError } = await supabase
            .from('leads_lead')
            .select('id, name, lead_number')
            .in('id', legacyLeadIds);
          
          if (legacyLeadError) {
            console.log('❌ Error fetching legacy leads from leads_lead:', legacyLeadError);
          } else {
            console.log('✅ Legacy leads fetched from leads_lead:', legacyData?.length || 0);
            legacyLeadData = legacyData;
          }
        }
        
        // Fetch new leads from leads table
        let newLeadData = null;
        if (newLeadIds.length > 0) {
          const { data: newData, error: newLeadError } = await supabase
            .from('leads')
            .select('id, name, lead_number')
            .in('id', newLeadIds);
          
          if (newLeadError) {
            console.log('❌ Error fetching new leads from leads:', newLeadError);
          } else {
            console.log('✅ New leads fetched from leads:', newData?.length || 0);
            newLeadData = newData;
          }
        }
        
        // Create a combined map for quick lookup
        const leadMap = new Map();
        if (legacyLeadData) {
          legacyLeadData.forEach(lead => {
            leadMap.set(String(lead.id), { ...lead, source: 'legacy' });
          });
        }
        if (newLeadData) {
          newLeadData.forEach(lead => {
            leadMap.set(String(lead.id), { ...lead, source: 'new' });
          });
        }
        
        console.log('🔍 Combined lead map created with', leadMap.size, 'entries');
        
        // Fetch currency information for all unique currency_ids
        const currencyIds = [...new Set(allPaymentPlans.filter(row => row.currency_id).map(row => row.currency_id))];
        console.log('🔍 Fetching currency information for currency_ids:', currencyIds.slice(0, 10));
        
        const { data: currencyData, error: currencyError } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .in('id', currencyIds);
        
        if (currencyError) {
          console.log('❌ Error fetching currencies:', currencyError);
        } else {
          console.log('✅ Currencies fetched:', currencyData?.length || 0);
          if (currencyData && currencyData.length > 0) {
            console.log('🔍 Sample currencies:', currencyData.slice(0, 3).map(c => ({ id: c.id, name: c.name, iso_code: c.iso_code })));
          }
        }
        
        // Create a currency map for quick lookup
        const currencyMap = new Map();
        if (currencyData) {
          currencyData.forEach(currency => {
            currencyMap.set(currency.id, currency);
          });
        }
        
        console.log('🔍 Currency map created with', currencyMap.size, 'entries');
        
        // Map to display format using the fetched lead data
        const mapped = allPaymentPlans.map((row: any) => {
          let totalAmount, totalAmountBase, lead, currency, contactName, proformaName, order;
          
          if (row.source === 'legacy') {
            // Legacy payment plan from finances_paymentplanrow
            totalAmount = (Number(row.value) || 0) + (Number(row.vat_value) || 0);
            totalAmountBase = (Number(row.value_base) || 0) + (Number(row.vat_value_base) || 0);
            
            // Try to find the lead information from the fetched leads
            lead = leadMap.get(String(row.lead_id));
            contactName = lead?.name || 'Unknown Lead';
            proformaName = 'Payment Plan';
            order = getOrderDescription(row.order) || '';
          } else {
            // New payment plan from payment_plans table
            totalAmount = Number(row.value) || 0;
            totalAmountBase = Number(row.value_base) || 0;
            
            // For new payment plans, try to get lead info first, fallback to client_name
            lead = leadMap.get(String(row.lead_id));
            contactName = lead?.name || row.client_name || 'Unknown Client';
            proformaName = row.proforma || 'Payment Plan';
            order = row.payment_order || getOrderDescription(row.order) || '';
          }
          
          // Try to find the currency information
          currency = currencyMap.get(row.currency_id);
          
          // Debug: Log the payment plan processing
          if (row.id <= 5) { // Only log first 5 for debugging
            console.log(`🔍 Payment plan ${row.id} (${row.source}): lead_id=${row.lead_id}, contact: ${contactName}`);
            console.log(`🔍 Payment plan ${row.id}: currency_id=${row.currency_id}, found currency:`, currency ? `${currency.name} (${currency.iso_code})` : 'NOT FOUND');
          }
          
          return {
            id: row.id,
            lead_number: row.source === 'legacy' ? (lead ? `L${lead.id}` : `L${row.lead_id}`) : `N${row.id}`,
            name: row.source === 'legacy' ? (lead?.name || 'Unknown Lead') : row.client_name || 'Unknown Client',
            contact_name: contactName,
            date: row.date || row.due_date,
            total_amount: totalAmount,
            total_amount_base: totalAmountBase,
            currency_symbol: currency?.name || '₪',
            currency_code: currency?.iso_code || 'ILS',
            proformaName: proformaName,
            order: order,
            currency_id: row.currency_id,
            notes: row.notes || '',
            lead_id: row.lead_id,
            source: row.source
          };
        });
        
        setAwaitingPayments(mapped);
        setLoading(false);
      } else {
        setAwaitingPayments([]);
        setLoading(false);
      }
      

    };
    fetchAwaitingPayments();
  }, [legacyNoPaymentLeads, legacyPaidMeetings, legacyAwaitingPayments, legacyPaidCases]); // Re-run when legacy leads are populated

  // Helper to open drawer for a lead/meeting
  const handleOpenDrawer = (item: any) => {
    setSelectedItem(item);
    setCollectionLabelInput(item.collection_label || '');
    setCollectionComments(item.collection_comments || []);
    setNewCollectionComment('');
    setDrawerOpen(true);
  };
  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedItem(null);
    setLabelInput('');
    setCommentInput('');
  };
  const handleSaveDrawer = () => {
    // For mock: update label/comment in the correct array
    if (!selectedItem) return;
    const updateArray = (arr: any[]) => arr.map(l => l.id === selectedItem.id ? { ...l, label: labelInput, comment: commentInput } : l);
    if (tab === 'no_payment') setLeads(updateArray(leads));
    if (tab === 'awaiting') setAwaitingPayments(updateArray(awaitingPayments));
    if (tab === 'paid') setPaidMeetings(updateArray(paidMeetings));
    handleCloseDrawer();
  };

  // 4. Add handler to save label
  const handleSaveCollectionLabel = async () => {
    if (!selectedItem) return;
    setSavingCollection(true);
    await supabase.from('leads').update({ collection_label: collectionLabelInput }).eq('id', selectedItem.id);
    setLeads(leads => leads.map(l => l.id === selectedItem.id ? { ...l, collection_label: collectionLabelInput } : l));
    setSavingCollection(false);
  };
  // 5. Add handler to add a comment
  const handleAddCollectionComment = async () => {
    if (!selectedItem || !newCollectionComment.trim()) return;
    setSavingCollection(true);
    const commentObj = { text: newCollectionComment.trim(), timestamp: new Date().toISOString(), user: currentUserName || 'User' };
    const updatedComments = [...collectionComments, commentObj];
    await supabase.from('leads').update({ collection_comments: updatedComments }).eq('id', selectedItem.id);
    setCollectionComments(updatedComments);
    setLeads(leads => leads.map(l => l.id === selectedItem.id ? { ...l, collection_comments: updatedComments } : l));
    setNewCollectionComment('');
    setSavingCollection(false);
  };

  // 1. Add a new tab state for paid cases
  const [paidCases, setPaidCases] = useState<any[]>([]);

  // 3. Fetch paid cases when tab is selected
  useEffect(() => {
    if (tab === 'paid_cases') {
      const fetchPaidCases = async () => {
        setLoading(true);
        // Fetch all paid payment_plans, join to leads for client info
        const { data, error } = await supabase
          .from('payment_plans')
          .select('*, leads:lead_id(name, lead_number), proforma')
          .eq('paid', true)
          .order('paid_at', { ascending: false });
        if (!error && data) {
          setPaidCases(data);
        } else {
          setPaidCases([]);
        }
        setLoading(false);
      };
      fetchPaidCases();
    }
  }, [tab]);

  // Add filter state for Awaiting Payment tab
  const [awaitingStatusFilter, setAwaitingStatusFilter] = useState<'all' | 'due' | 'overdue' | 'due_soon'>('all');
  const [awaitingDateFilter, setAwaitingDateFilter] = useState<string>('');
  const [awaitingSearch, setAwaitingSearch] = useState('');

  // Awaiting Payment tab date range filter
  const [awaitingDateFrom, setAwaitingDateFrom] = useState('');
  const [awaitingDateTo, setAwaitingDateTo] = useState('');

  // Paid Cases tab date range filter
  const [paidCasesDateFrom, setPaidCasesDateFrom] = useState('');
  const [paidCasesDateTo, setPaidCasesDateTo] = useState('');

  // Helper to determine if a payment is overdue
  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const now = new Date();
    // Set both dates to start of day for accurate comparison
    due.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    return due < now;
  };

  // Helper to determine if a payment is due soon (today or tomorrow)
  const isDueSoon = (dueDate: string) => {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return (
      due.toDateString() === now.toDateString() ||
      due.toDateString() === tomorrow.toDateString()
    );
  };

  // Helper to convert order numbers to meaningful descriptions
  const getOrderDescription = (orderNumber: number | string) => {
    if (!orderNumber) return '';
    const num = Number(orderNumber);
    if (num === 1) return 'First Payment';
    if (num === 2) return 'Second Payment';
    if (num === 3) return 'Third Payment';
    if (num === 4) return 'Fourth Payment';
    if (num === 5) return 'Fifth Payment';
    if (num === 6) return 'Sixth Payment';
    if (num === 7) return 'Seventh Payment';
    if (num === 8) return 'Eighth Payment';
    if (num === 9) return 'Ninth Payment';
    if (num === 10) return 'Tenth Payment';
    return `Payment ${num}`;
  };

  // Calculate the number of due soon payments
  const dueSoonCount = awaitingPayments.filter(row => isDueSoon(row.date)).length;

  // Combine new and legacy awaiting payments
  // Note: awaitingPayments now comes from finances_paymentplanrow directly
  const combinedAwaitingPayments = [
    ...awaitingPayments.map(payment => ({ 
      ...payment, 
      lead_type: 'legacy', // All payments from finances_paymentplanrow are legacy leads
    }))
  ];

  // Filtered awaiting payments
  const filteredAwaitingPayments = combinedAwaitingPayments.filter(row => {
    let statusMatch = true;
    if (awaitingStatusFilter === 'due') statusMatch = !isOverdue(row.date) && !isDueSoon(row.date);
    if (awaitingStatusFilter === 'overdue') statusMatch = isOverdue(row.date);
    if (awaitingStatusFilter === 'due_soon') statusMatch = isDueSoon(row.date);
    let dateMatch = true;
    if (awaitingDateFrom || awaitingDateTo) {
      const rowDate = row.date ? new Date(row.date) : null;
      dateMatch = !!rowDate;
      if (dateMatch && awaitingDateFrom && rowDate) {
        const fromDate = new Date(awaitingDateFrom);
        dateMatch = dateMatch && rowDate >= fromDate;
      }
      if (dateMatch && awaitingDateTo && rowDate) {
        const toDate = new Date(awaitingDateTo);
        dateMatch = dateMatch && rowDate <= toDate;
      }
    }
    let searchMatch = true;
    if (awaitingSearch.trim()) {
      const q = awaitingSearch.trim().toLowerCase();
      searchMatch = (
        (row.lead_number && row.lead_number.toLowerCase().includes(q)) ||
        (row.name && row.name.toLowerCase().includes(q)) ||
        (row.contact_name && row.contact_name.toLowerCase().includes(q)) ||
        (row.proformaName && row.proformaName.toLowerCase().includes(q))
      );
    }
    return statusMatch && dateMatch && searchMatch;
  });

  // State for combined and filtered paid meetings
  const [combinedPaidMeetings, setCombinedPaidMeetings] = useState<any[]>([]);
  const [filteredPaidMeetings, setFilteredPaidMeetings] = useState<any[]>([]);

  // Update combined and filtered paid meetings when dependencies change
  useEffect(() => {
    const combined = [
      ...paidMeetings.map(meeting => ({ ...meeting, lead_type: 'new' })),
      ...legacyPaidMeetings.map(lead => ({
        ...lead,
        lead_type: 'legacy',
        date: lead.contract_signed_date || lead.cdate, // Use contract_signed_date if available, otherwise cdate
        lead_number: `L${lead.id}`,
        name: lead.name,
        total: lead.total,
        details: lead.meeting_paid === "true" ? 'Meeting Paid' : 'Payment Plan Available'
      }))
    ];

    const filtered = combined.filter(row => {
      // Add any filtering logic here if needed
      return true; // For now, show all combined paid meetings
    });

    setCombinedPaidMeetings(combined);
    setFilteredPaidMeetings(filtered);

    // Debug: Log the counts for paid meetings
    console.log('🔍 Paid Meetings Debug:', {
      newPaidMeetings: paidMeetings.length,
      legacyPaidMeetings: legacyPaidMeetings.length,
      combinedPaidMeetings: combined.length,
      filteredPaidMeetings: filtered.length
    });
    
    // Debug: Log the actual arrays to see their content
    console.log('🔍 combinedPaidMeetings array:', combined);
    console.log('🔍 filteredPaidMeetings array:', filtered);
  }, [paidMeetings, legacyPaidMeetings]);

  // Calculate the number of overdue payments
  const overdueCount = awaitingPayments.filter(row => isOverdue(row.date)).length;

  const [paidCasesOrderFilter, setPaidCasesOrderFilter] = useState('all');
  const [paidCasesDateFilter, setPaidCasesDateFilter] = useState('');
  const [paidCasesSearch, setPaidCasesSearch] = useState('');

  // Combine new and legacy paid cases
  const combinedPaidCases = [
    ...paidCases.map(case_ => ({ ...case_, lead_type: 'new' })),
    ...legacyPaidCases.map(lead => ({
      ...lead,
      lead_type: 'legacy',
      leads: { lead_number: lead.lead_number, name: lead.name },
      client_name: lead.expert_name,
      paid_at: lead.cdate,
      value: lead.amount,
      value_vat: 0,
      payment_order: lead.category_name
    }))
  ];

  const filteredPaidCases = combinedPaidCases.filter(row => {
    let orderMatch = true;
    if (paidCasesOrderFilter !== 'all') orderMatch = (row.payment_order || '').toLowerCase() === paidCasesOrderFilter.toLowerCase();
    let dateMatch = true;
    if (paidCasesDateFrom || paidCasesDateTo) {
      const rowDate = row.paid_at ? new Date(row.paid_at) : null;
      dateMatch = !!rowDate;
      if (dateMatch && paidCasesDateFrom && rowDate) {
        const fromDate = new Date(paidCasesDateFrom);
        dateMatch = dateMatch && rowDate >= fromDate;
      }
      if (dateMatch && paidCasesDateTo && rowDate) {
        const toDate = new Date(paidCasesDateTo);
        dateMatch = dateMatch && rowDate <= toDate;
      }
    }
    let searchMatch = true;
    if (paidCasesSearch.trim()) {
      const q = paidCasesSearch.trim().toLowerCase();
      let proformaName = '';
      if (row.proforma) {
        try { proformaName = JSON.parse(row.proforma)?.proformaName?.toLowerCase() || ''; } catch {}
      }
      searchMatch = (
        (row.leads?.name && row.leads.name.toLowerCase().includes(q)) ||
        (row.leads?.lead_number && row.leads.lead_number.toLowerCase().includes(q)) ||
        (row.client_name && row.client_name.toLowerCase().includes(q)) ||
        (proformaName && proformaName.includes(q))
      );
    }
    return orderMatch && dateMatch && searchMatch;
  });

  const [noPaymentDateFrom, setNoPaymentDateFrom] = useState('');
  const [noPaymentDateTo, setNoPaymentDateTo] = useState('');
  const [noPaymentLabel, setNoPaymentLabel] = useState('all');
  const [noPaymentComments, setNoPaymentComments] = useState('all');
  const [noPaymentSearch, setNoPaymentSearch] = useState('');

  // Combine new leads and legacy leads for no payment plan
  const combinedNoPaymentLeads = [
    ...leads.map(lead => ({ ...lead, lead_type: 'new' })),
    ...legacyNoPaymentLeads
  ];

  const filteredNoPaymentLeads = combinedNoPaymentLeads.filter(lead => {
    let dateMatch = true;
    if (noPaymentDateFrom || noPaymentDateTo) {
      const rowDate = lead.date_signed ? new Date(lead.date_signed) : 
                     lead.lead_type === 'legacy' && lead.contract_signed_date ? new Date(lead.contract_signed_date) :
                     lead.cdate ? new Date(lead.cdate) : null;
      dateMatch = !!rowDate;
      if (dateMatch && noPaymentDateFrom && rowDate) {
        const fromDate = new Date(noPaymentDateFrom);
        dateMatch = dateMatch && rowDate >= fromDate;
      }
      if (dateMatch && noPaymentDateTo && rowDate) {
        const toDate = new Date(noPaymentDateTo);
        dateMatch = dateMatch && rowDate <= toDate;
      }
    }
    let labelMatch = true;
    if (noPaymentLabel !== 'all') labelMatch = lead.collection_label === noPaymentLabel;
    let commentsMatch = true;
    if (noPaymentComments === 'with') commentsMatch = Array.isArray(lead.collection_comments) && lead.collection_comments.length > 0;
    if (noPaymentComments === 'without') commentsMatch = !Array.isArray(lead.collection_comments) || lead.collection_comments.length === 0;
    let searchMatch = true;
    if (noPaymentSearch.trim()) {
      const q = noPaymentSearch.trim().toLowerCase();
      searchMatch = (
        (lead.lead_number && lead.lead_number.toLowerCase().includes(q)) ||
        (lead.name && lead.name.toLowerCase().includes(q)) ||
        (lead.expert_name && lead.expert_name.toLowerCase().includes(q)) ||
        (lead.category_name && lead.category_name.toLowerCase().includes(q))
      );
    }
    return dateMatch && labelMatch && commentsMatch && searchMatch;
  });

  // Calculate the real total paid this month from paidCases or payment_plans
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  const realTotalPaidThisMonth = paidCases
    .filter(row => {
      if (!row.paid_at) return false;
      const d = new Date(row.paid_at);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    })
    .reduce((sum, row) => sum + (Number(row.value) + Number(row.value_vat)), 0);

  // Calculate real paid by month for the last 5 months from database
  const getMonthLabel = (date: Date) => date.toLocaleString('default', { month: 'long' });
  const [paidByMonth, setPaidByMonth] = useState<{ month: string; total: number }[]>([]);

  // Fetch paid by month data independently
  useEffect(() => {
    const fetchPaidByMonth = async () => {
      const months: { month: string; total: number }[] = [];
      const now = new Date();
      
      for (let i = 4; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = getMonthLabel(d);
        const year = d.getFullYear();
        const startOfMonth = new Date(year, d.getMonth(), 1);
        const endOfMonth = new Date(year, d.getMonth() + 1, 0);

        const { data, error } = await supabase
          .from('payment_plans')
          .select('value, value_vat, paid_at')
          .eq('paid', true)
          .gte('paid_at', startOfMonth.toISOString())
          .lte('paid_at', endOfMonth.toISOString());

        let total = 0;
        if (!error && data) {
          total = data.reduce((sum, row) => {
            return sum + (Number(row.value) + Number(row.value_vat));
          }, 0);
        }
        months.push({ month, total });
      }
      setPaidByMonth(months);
    };

    fetchPaidByMonth();
  }, []); // Empty dependency array means this runs once on mount

  return (
    <div className="p-4 md:p-6 lg:p-8 w-full">
      {/* Summary Boxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 w-full">
        {/* Total Paid (this month) */}
        <div
          className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white relative overflow-hidden cursor-pointer"
          onClick={() => setShowPaidChart((v) => !v)}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <CurrencyDollarIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">₪{totalPaidThisMonth.toLocaleString()}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Total Paid (This Month)</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>
        {/* Due Soon */}
        <div
          className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white relative overflow-hidden cursor-pointer"
          onClick={() => {
            setTab('awaiting');
            setAwaitingStatusFilter('due_soon');
          }}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <CalendarIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{dueSoonCount}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Due Soon</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-16 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 64 32"><path d="M2 28 Q16 8 32 20 T62 8" /></svg>
        </div>
        {/* Overdue */}
        <div
          className="rounded-2xl transition-all duration-300 shadow-xl bg-gradient-to-tr from-purple-600 via-blue-600 to-blue-500 text-white relative overflow-hidden cursor-pointer"
          onClick={() => {
            setTab('awaiting');
            setAwaitingStatusFilter('overdue');
          }}
        >
          <div className="flex items-center gap-4 p-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 shadow">
              <ExclamationTriangleIcon className="w-7 h-7 text-white opacity-90" />
            </div>
            <div>
              <div className="text-4xl font-extrabold text-white leading-tight">{overdueCount}</div>
              <div className="text-white/80 text-sm font-medium mt-1">Overdue</div>
            </div>
          </div>
          <svg className="absolute bottom-4 right-4 w-12 h-8 opacity-40" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 48 32"><rect x="2" y="20" width="4" height="10"/><rect x="10" y="10" width="4" height="20"/><rect x="18" y="16" width="4" height="14"/><rect x="26" y="6" width="4" height="24"/><rect x="34" y="14" width="4" height="16"/></svg>
        </div>
      </div>
      {/* Paid by Month Curve Chart */}
      {showPaidChart && (
        <div className="w-full bg-white rounded-2xl shadow-lg p-8 mb-8 flex flex-col items-center animate-fade-in">
          <h2 className="text-xl font-bold mb-4 text-primary">Total Paid by Month (Last 5 Months)</h2>
          <div className="w-full" style={{ minHeight: 280, height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={paidByMonth} margin={{ top: 24, right: 32, left: 8, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edeafd" />
                <XAxis dataKey="month" tick={{ fontSize: 16, fill: '#3b28c7', fontWeight: 600 }} axisLine={{ stroke: '#a21caf' }} tickLine={false} />
                <YAxis tick={{ fontSize: 14, fill: '#3b28c7' }} axisLine={{ stroke: '#a21caf' }} tickLine={false} width={60} />
                <Tooltip formatter={(value: number) => `₪${value.toLocaleString()}`} />
                <Line type="monotone" dataKey="total" name="Total Paid" stroke="#a21caf" strokeWidth={4} dot={{ r: 7, fill: '#fff', stroke: '#a21caf', strokeWidth: 3 }} activeDot={{ r: 10, fill: '#a21caf', stroke: '#3b28c7', strokeWidth: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-gray-800">
        <div className="w-full">
          {/* Desktop version */}
          <div className="hidden md:flex items-center px-4 py-4">
            <div className="flex bg-white dark:bg-gray-800 p-1 gap-1 overflow-hidden w-full">
              <button
                className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                  tab === 'no_payment'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                }`}
                onClick={() => setTab('no_payment')}
              >
                <span className={`whitespace-nowrap saira-light font-bold ${tab === 'no_payment' ? 'text-white' : 'text-gray-600'}`}>No Payment Plan</span>
                {tab === 'no_payment' && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                )}
              </button>
              <button
                className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                  tab === 'awaiting'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                }`}
                onClick={() => setTab('awaiting')}
              >
                <span className={`whitespace-nowrap saira-light font-bold ${tab === 'awaiting' ? 'text-white' : 'text-gray-600'}`}>Awaiting Payment</span>
                {tab === 'awaiting' && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                )}
              </button>
              <button
                className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                  tab === 'paid'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                }`}
                onClick={() => setTab('paid')}
              >
                <span className={`whitespace-nowrap saira-light font-bold ${tab === 'paid' ? 'text-white' : 'text-gray-600'}`}>Paid Meetings</span>
                {tab === 'paid' && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                )}
              </button>
              <button
                className={`relative flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-300 hover:scale-[1.02] flex-1 ${
                  tab === 'paid_cases'
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg transform scale-[1.02]'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                }`}
                onClick={() => setTab('paid_cases')}
              >
                <span className={`whitespace-nowrap saira-light font-bold ${tab === 'paid_cases' ? 'text-white' : 'text-gray-600'}`}>Paid Cases</span>
                {tab === 'paid_cases' && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-white dark:bg-gray-800 rounded-full shadow-lg"></div>
                )}
              </button>
            </div>
          </div>
          {/* Mobile version: modern card-based design */}
          <div className="md:hidden px-6 py-4">
            <div className="overflow-x-auto scrollbar-hide bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 dark:border-gray-700 p-3 w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="flex gap-2 pb-1">
                <button
                  className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                    tab === 'no_payment'
                      ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => setTab('no_payment')}
                >
                  <span className={`text-xs font-semibold truncate max-w-[70px] ${tab === 'no_payment' ? 'text-white' : 'text-gray-600'}`}>No Payment</span>
                  {tab === 'no_payment' && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white dark:bg-gray-800 rounded-full"></div>
                  )}
                </button>
                <button
                  className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                    tab === 'awaiting'
                      ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => setTab('awaiting')}
                >
                  <span className={`text-xs font-semibold truncate max-w-[70px] ${tab === 'awaiting' ? 'text-white' : 'text-gray-600'}`}>Awaiting</span>
                  {tab === 'awaiting' && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white dark:bg-gray-800 rounded-full"></div>
                  )}
                </button>
                <button
                  className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                    tab === 'paid'
                      ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => setTab('paid')}
                >
                  <span className={`text-xs font-semibold truncate max-w-[70px] ${tab === 'paid' ? 'text-white' : 'text-gray-600'}`}>Paid Meetings</span>
                  {tab === 'paid' && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white dark:bg-gray-800 rounded-full"></div>
                  )}
                </button>
                <button
                  className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all duration-300 min-w-[80px] ${
                    tab === 'paid_cases'
                      ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white shadow-lg transform scale-105'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:bg-gray-700 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => setTab('paid_cases')}
                >
                  <span className={`text-xs font-semibold truncate max-w-[70px] ${tab === 'paid_cases' ? 'text-white' : 'text-gray-600'}`}>Paid Cases</span>
                  {tab === 'paid_cases' && (
                    <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-white dark:bg-gray-800 rounded-full"></div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* View Mode Toggle */}
      <div className="flex justify-end mb-4">
        <button
          className="btn btn-outline btn-primary btn-sm flex items-center gap-2"
          onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')}
          title={viewMode === 'cards' ? 'Switch to List View' : 'Switch to Card View'}
        >
          {viewMode === 'cards' ? (
            <Bars3Icon className="w-5 h-5" />
          ) : (
            <Squares2X2Icon className="w-5 h-5" />
          )}
          <span className="hidden md:inline">{viewMode === 'cards' ? 'List View' : 'Card View'}</span>
        </button>
      </div>
      {tab === 'no_payment' && (
        <>
          <div className="space-y-4 mb-6">
            {/* Date Range */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <label className="font-semibold text-sm whitespace-nowrap">Date Signed:</label>
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                  <span className="text-xs text-gray-500 sm:hidden">From:</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm w-full"
                    value={noPaymentDateFrom}
                    onChange={e => setNoPaymentDateFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                  <span className="text-xs text-gray-500 sm:hidden">To:</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm w-full"
                    value={noPaymentDateTo}
                    onChange={e => setNoPaymentDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
            
            {/* Filters Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                <label className="font-semibold text-sm whitespace-nowrap">Label:</label>
                <select
                  className="select select-bordered w-full"
                  value={noPaymentLabel}
                  onChange={e => setNoPaymentLabel(e.target.value)}
                >
                  <option value="all">All</option>
                  {COLLECTION_LABEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.value}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                <label className="font-semibold text-sm whitespace-nowrap">Comments:</label>
                <select
                  className="select select-bordered w-full"
                  value={noPaymentComments}
                  onChange={e => setNoPaymentComments(e.target.value)}
                >
                  <option value="all">All</option>
                  <option value="with">With Comments</option>
                  <option value="without">Without Comments</option>
                </select>
              </div>
            </div>
            
            {/* Search Bar */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <label className="font-semibold text-sm whitespace-nowrap">Search:</label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Search by lead #, client, contact, payment plan..."
                value={noPaymentSearch}
                onChange={e => setNoPaymentSearch(e.target.value)}
              />
            </div>
            
            {/* Clear Filters Button */}
            <div className="flex justify-start">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setNoPaymentDateFrom('');
                  setNoPaymentDateTo('');
                  setNoPaymentLabel('all');
                  setNoPaymentComments('all');
                  setNoPaymentSearch('');
                }}
              >
                Clear Filters
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-40">
              <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
          ) : filteredNoPaymentLeads.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">No leads found where the client has signed the contract.</div>
          ) : viewMode === 'list' ? (
            <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="text-lg font-bold">&nbsp;</th>
                    <th className="text-lg font-bold">Lead</th>
                    <th className="text-lg font-bold">Client Name</th>
                    <th className="text-lg font-bold">Date Signed</th>
                    <th className="text-lg font-bold">Total Amount</th>
                    <th className="text-lg font-bold">Label</th>
                    <th className="text-lg font-bold">Comments</th>
                  </tr>
                </thead>
                <tbody className="text-base">
                  {filteredNoPaymentLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td><span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-400 text-white shadow">NEW!</span></td>
                      <td className="font-bold text-primary">{lead.lead_number}</td>
                      <td>{lead.name}</td>
                      <td>{lead.date_signed ? new Date(lead.date_signed).toLocaleDateString() : '-'}</td>
                      <td>{lead.balance ? `₪${lead.balance.toLocaleString()}` : '-'}</td>
                      <td>{lead.collection_label || '-'}</td>
                      <td>{Array.isArray(lead.collection_comments) && lead.collection_comments.length > 0 ? lead.collection_comments[lead.collection_comments.length - 1].text : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
              {filteredNoPaymentLeads.map((lead) => (
                <div 
                  key={lead.id} 
                  className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                  onClick={() => handleOpenDrawer(lead)}
                >
                  {lead.collection_label && (
                    <div className="flex justify-end">
                      <span className="mt-[-18px] mb-2 px-3 py-1 rounded-full font-bold text-xs shadow bg-white border-2 border-[#3b28c7] text-[#3b28c7]">
                        {lead.collection_label}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 flex flex-col">
                    {/* Lead Number and Name */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-400 text-white shadow">NEW!</span>
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{lead.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{lead.name}</span>
                    </div>
                    {/* Stage */}
                    <div className="flex justify-between items-center py-1">
                      <span className="text-xs font-semibold text-gray-500">Stage</span>
                      <span className="text-xs font-bold ml-2 px-2 py-1 rounded bg-[#3b28c7] text-white">
                        {lead.lead_type === 'legacy' 
                          ? (lead.stage_name || `Stage ${lead.stage}`)
                          : (lead.stage ? lead.stage.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'N/A')
                        }
                      </span>
                    </div>
                    <div className="space-y-2 divide-y divide-gray-100">
                      {/* Date Signed */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Date Signed</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">
                          {lead.lead_type === 'legacy' && lead.contract_signed_date 
                            ? new Date(lead.contract_signed_date).toLocaleDateString()
                            : lead.date_signed 
                            ? new Date(lead.date_signed).toLocaleDateString() 
                            : '-'
                          }
                        </span>
                      </div>
                      {/* Total Amount */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Total Amount</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">
                          {lead.lead_type === 'legacy'
                            ? (lead.total ? `${lead.currency_symbol || '₪'}${Number(lead.total).toLocaleString()}` : 'N/A')
                            : (lead.balance !== undefined && lead.balance !== null
                              ? `${getCurrencySymbol(lead.balance_currency)}${lead.balance.toLocaleString()}`
                              : 'N/A')
                          }
                        </span>
                      </div>
                      {/* Details */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Details</span>
                        <span className="flex items-center gap-2 text-sm font-bold text-gray-800 ml-2">
                          Client signed contract <ExclamationTriangleIcon className="w-5 h-5 text-primary" />
                        </span>
                      </div>
                    </div>
                    {lead.collection_comments && lead.collection_comments.length > 0 && (
                      <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                        <div className="flex items-start gap-2">
                          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                          </div>
                          <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                            <div className="font-medium leading-snug max-w-xs truncate" title={lead.collection_comments[lead.collection_comments.length - 1].text}>{lead.collection_comments[lead.collection_comments.length - 1].text}</div>
                            <div className="text-[11px] text-base-content/50 text-right mt-1">
                              {lead.collection_comments[lead.collection_comments.length - 1].user} · {new Date(lead.collection_comments[lead.collection_comments.length - 1].timestamp).toLocaleString()}
                            </div>
                            <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {/* Awaiting Payment Tab */}
      {tab === 'awaiting' && (
        <>
          <div className="space-y-4 mb-6">
            {/* Status Filter */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <label className="font-semibold text-sm whitespace-nowrap">Status:</label>
              <select
                className="select select-bordered w-full md:w-auto"
                value={awaitingStatusFilter}
                onChange={e => setAwaitingStatusFilter(e.target.value as any)}
              >
                <option value="all">All</option>
                <option value="due">Due</option>
                <option value="due_soon">Due Soon</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
            
            {/* Date Range */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <label className="font-semibold text-sm whitespace-nowrap">Due Date:</label>
              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                  <span className="text-xs text-gray-500 sm:hidden">From:</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm w-full"
                    value={awaitingDateFrom}
                    onChange={e => setAwaitingDateFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
                  <span className="text-xs text-gray-500 sm:hidden">To:</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm w-full"
                    value={awaitingDateTo}
                    onChange={e => setAwaitingDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>
            
            {/* Search Bar */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
              <label className="font-semibold text-sm whitespace-nowrap">Search:</label>
              <input
                type="text"
                className="input input-bordered w-full"
                placeholder="Search by lead #, client, contact, payment plan..."
                value={awaitingSearch}
                onChange={e => setAwaitingSearch(e.target.value)}
              />
            </div>
            
            {/* Clear Filters Button */}
            <div className="flex justify-start">
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setAwaitingStatusFilter('all');
                  setAwaitingDateFrom('');
                  setAwaitingDateTo('');
                  setAwaitingSearch('');
                }}
              >
                Clear Filters
              </button>
            </div>
          </div>
          {loading ? (
            <div className="text-center text-gray-500 mt-12">Loading...</div>
          ) : filteredAwaitingPayments.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">No payments awaiting.</div>
          ) : viewMode === 'list' ? (
            <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="text-lg font-bold">&nbsp;</th>
                    <th className="text-lg font-bold">Lead</th>
                    <th className="text-lg font-bold">Client Name</th>
                    <th className="text-lg font-bold">Contact Name</th>
                    <th className="text-lg font-bold">Date</th>
                    <th className="text-lg font-bold">Total Amount</th>
                    <th className="text-lg font-bold">Order</th>
                    <th className="text-lg font-bold">Payment Plan</th>
                    <th className="text-lg font-bold">Source</th>
                    <th className="text-lg font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-base">
                  {filteredAwaitingPayments.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className={`flex items-center gap-1 px-3 py-1 rounded-full font-bold shadow ${isOverdue(row.date) ? 'bg-gradient-to-tr from-red-500 via-pink-500 to-orange-400 text-white' : isDueSoon(row.date) ? 'bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white' : 'bg-gradient-to-tr from-purple-500 via-primary to-pink-400 text-white'}`}>
                          {isOverdue(row.date) ? 'Overdue' : isDueSoon(row.date) ? 'Due Soon' : 'Due'}
                        </span>
                      </td>
                      <td className="font-bold text-primary">{row.lead_number}</td>
                      <td>{row.name}</td>
                      <td className="font-semibold text-purple-600">{row.contact_name}</td>
                      <td>{row.date ? new Date(row.date).toLocaleDateString() : '-'}</td>
                      <td>{row.total_amount ? `${row.currency_symbol || '₪'}${row.total_amount.toLocaleString()}` : '-'}</td>
                      <td>{row.order || '-'}</td>
                      <td>
                        <span className="text-sm font-bold text-blue-600">
                          {row.proformaName}
                        </span>
                      </td>
                      <td>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          row.source === 'legacy' 
                            ? 'bg-orange-100 text-orange-700 border border-orange-200' 
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {row.source === 'legacy' ? 'Legacy' : 'New'}
                        </span>
                      </td>
                      <td>
                        {/* Dollar icon button to mark as paid and remove row */}
                        <button
                          className="btn btn-xs btn-circle bg-green-100 hover:bg-green-200 text-green-700 border-green-300 border-2 shadow-sm flex items-center justify-center"
                          title="Mark as Paid"
                          onClick={() => handlePaymentMarkedPaid(row.id)}
                          style={{ padding: 0 }}
                        >
                          <CurrencyDollarIcon className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {filteredAwaitingPayments.map((row) => (
                <div 
                  key={row.id} 
                  className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                  onClick={() => handleOpenDrawer(row)}
                >
                  <div className="flex-1 flex flex-col">
                    {/* Lead Number and Name */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`flex items-center gap-1 px-3 py-1 rounded-full font-bold shadow ${isOverdue(row.date) ? 'bg-gradient-to-tr from-red-500 via-pink-500 to-orange-400 text-white' : isDueSoon(row.date) ? 'bg-gradient-to-tr from-teal-400 via-green-400 to-green-600 text-white' : 'bg-gradient-to-tr from-purple-500 via-primary to-pink-400 text-white'}`}>
                        {isOverdue(row.date) ? 'Overdue' : isDueSoon(row.date) ? 'Due Soon' : 'Due'}
                      </span>
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{row.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{row.name}</span>
                    </div>
                    <div className="space-y-2 divide-y divide-gray-100">
                      {/* Contact Name */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Contact</span>
                        <span className="text-sm font-bold text-purple-600 ml-2">{row.contact_name}</span>
                      </div>
                      {/* Date */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Date</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.date ? new Date(row.date).toLocaleDateString() : '-'}</span>
                      </div>
                      {/* Total Amount */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Total Amount</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">
                          {row.total_amount ? `${row.currency_symbol || '₪'}${row.total_amount.toLocaleString()}` : 'N/A'}
                        </span>
                      </div>
                      {/* Order */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Order</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.order || '-'}</span>
                      </div>
                      {/* Payment Plan */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Payment Plan</span>
                        <span className="text-sm font-bold text-blue-600 ml-2">
                          {row.proformaName}
                        </span>
                      </div>
                      {/* Source */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Source</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                          row.source === 'legacy' 
                            ? 'bg-orange-100 text-orange-700 border border-orange-200' 
                            : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {row.source === 'legacy' ? 'Legacy' : 'New'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'paid' && (
        <>
          {filteredPaidMeetings.length === 0 ? (
            <div className="text-center text-gray-500 mt-12">No paid meetings found.</div>
          ) : viewMode === 'list' ? (
            <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="text-lg font-bold">&nbsp;</th>
                    <th className="text-lg font-bold">Lead</th>
                    <th className="text-lg font-bold">Client Name</th>
                    <th className="text-lg font-bold">Date</th>
                    <th className="text-lg font-bold">Total</th>
                    <th className="text-lg font-bold">Details</th>
                  </tr>
                </thead>
                <tbody className="text-base">
                  {filteredPaidMeetings.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <CurrencyDollarIcon className="w-5 h-5 text-green-600" />
                          <CalendarIcon className="w-5 h-5 text-blue-500" />
                          {row.lead_type === 'legacy' && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Legacy</span>
                          )}
                        </span>
                      </td>
                      <td className="font-bold text-primary">{row.lead_number}</td>
                      <td>{row.name}</td>
                      <td>{row.date ? new Date(row.date).toLocaleDateString() : '-'}</td>
                      <td>{row.total ? `₪${row.total.toLocaleString()}` : '-'}</td>
                      <td>{row.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
              {filteredPaidMeetings.map((row) => (
                <div 
                  key={row.id} 
                  className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1 border border-gray-100 group flex flex-col justify-between h-full min-h-[300px] relative pb-8 cursor-pointer"
                  onClick={() => handleOpenDrawer(row)}
                >
                  {row.collection_label && (
                    <div className="flex justify-end">
                      <span className="mt-[-18px] mb-2 px-3 py-1 rounded-full font-bold text-xs shadow bg-white border-2 border-[#3b28c7] text-[#3b28c7]">
                        {row.collection_label}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 flex flex-col">
                    {/* Lead Number and Name */}
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex items-center gap-2">
                        <CurrencyDollarIcon className="w-5 h-5 text-green-600" />
                        <CalendarIcon className="w-5 h-5 text-blue-500" />
                        {row.lead_type === 'legacy' && (
                          <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Legacy</span>
                        )}
                      </span>
                      <span className="text-xs font-semibold text-gray-400 tracking-widest">{row.lead_number}</span>
                      <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                      <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{row.name}</span>
                    </div>
                    <div className="space-y-2 divide-y divide-gray-100">
                      {/* Date */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Date</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.date ? new Date(row.date).toLocaleDateString() : '-'}</span>
                      </div>
                      {/* Total */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Total</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">
                          {row.total ? `₪${row.total.toLocaleString()}` : 'N/A'}
                        </span>
                      </div>
                      {/* Details */}
                      <div className="flex justify-between items-center py-1">
                        <span className="text-xs font-semibold text-gray-500">Details</span>
                        <span className="text-sm font-bold text-gray-800 ml-2">{row.details}</span>
                      </div>
                    </div>
                  </div>
                  {row.collection_comments && row.collection_comments.length > 0 && (
                    <div className="absolute left-5 bottom-5 max-w-[85%] flex items-end">
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center shadow text-white text-sm font-bold">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4-4.03 7-9 7a9.77 9.77 0 01-4-.8l-4.28 1.07a1 1 0 01-1.21-1.21l1.07-4.28A7.94 7.94 0 013 12c0-4 4.03-7 9-7s9 3 9 7z"/></svg>
                        </div>
                        <div className="relative bg-white border border-base-200 rounded-2xl px-4 py-2 shadow-md text-sm text-base-content/90" style={{minWidth: '120px'}}>
                          <div className="font-medium leading-snug max-w-xs truncate" title={row.collection_comments[row.collection_comments.length - 1].text}>{row.collection_comments[row.collection_comments.length - 1].text}</div>
                          <div className="text-[11px] text-base-content/50 text-right mt-1">
                            {row.collection_comments[row.collection_comments.length - 1].user} · {new Date(row.collection_comments[row.collection_comments.length - 1].timestamp).toLocaleString()}
                          </div>
                          <div className="absolute left-[-10px] bottom-2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-white border-l-0"></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
  
  {tab === 'paid_cases' && (
    <>
      <div className="space-y-4 mb-6">
        {/* Order Filter */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
          <label className="font-semibold text-sm whitespace-nowrap">Order:</label>
          <select
            className="select select-bordered w-full md:w-auto"
            value={paidCasesOrderFilter}
            onChange={e => setPaidCasesOrderFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="first payment">First Payment</option>
            <option value="intermediate payment">Intermediate Payment</option>
            <option value="one payment">One Payment</option>
            <option value="final payment">Final Payment</option>
          </select>
        </div>
        
        {/* Date Range */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
          <label className="font-semibold text-sm whitespace-nowrap">Date Paid:</label>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
              <span className="text-xs text-gray-500 sm:hidden">From:</span>
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={paidCasesDateFrom}
                onChange={e => setPaidCasesDateFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-1">
              <span className="text-xs text-gray-500 sm:hidden">To:</span>
              <input
                type="date"
                className="input input-bordered input-sm w-full"
                value={paidCasesDateTo}
                onChange={e => setPaidCasesDateTo(e.target.value)}
              />
            </div>
          </div>
        </div>
        
        {/* Search Bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
          <label className="font-semibold text-sm whitespace-nowrap">Search:</label>
          <input
            type="text"
            className="input input-bordered w-full"
            placeholder="Search by lead #, client, contact, proforma..."
            value={paidCasesSearch}
            onChange={e => setPaidCasesSearch(e.target.value)}
          />
        </div>
        
        {/* Clear Filters Button */}
        <div className="flex justify-start">
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              setPaidCasesOrderFilter('all');
              setPaidCasesDateFrom('');
              setPaidCasesDateTo('');
              setPaidCasesSearch('');
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>
      {loading ? (
        <div className="text-center text-gray-500 mt-12">Loading...</div>
      ) : filteredPaidCases.length === 0 ? (
        <div className="text-center text-gray-500 mt-12">No paid cases found.</div>
      ) : viewMode === 'list' ? (
        <div className="overflow-x-auto bg-white rounded-2xl shadow-lg p-6 w-full">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-lg font-bold">Lead</th>
                <th className="text-lg font-bold">Client Name</th>
                <th className="text-lg font-bold">Contact Name</th>
                <th className="text-lg font-bold">Date Paid</th>
                <th className="text-lg font-bold">Amount (with VAT)</th>
                <th className="text-lg font-bold">Order</th>
                <th className="text-lg font-bold">Invoice</th>
              </tr>
            </thead>
                <tbody className="text-base">
                  {filteredPaidCases.map((row) => {
                    let proforma = null;
                    if (row.proforma) {
                      try { proforma = JSON.parse(row.proforma); } catch {}
                    }
                    return (
                      <tr key={row.id}>
                        <td className="font-bold text-primary">{row.leads?.lead_number}</td>
                        <td>{row.leads?.name}</td>
                        <td className="font-semibold text-purple-600">{row.client_name}</td>
                        <td>{row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '-'}</td>
                        <td>₪{(Number(row.value) + Number(row.value_vat)).toLocaleString()}</td>
                        <td>{row.payment_order || '-'}</td>
                        <td className="text-blue-600 font-bold">{proforma?.proformaName || 'N/A'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
              {filteredPaidCases.map((row) => {
                let proforma = null;
                if (row.proforma) {
                  try { proforma = JSON.parse(row.proforma); } catch {}
                }
                return (
                  <div key={row.id} className="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all duration-200 border border-gray-100 group flex flex-col justify-between h-full min-h-[260px] relative pb-8 cursor-pointer">
                    <div className="flex-1 flex flex-col">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex items-center gap-1 px-3 py-1 rounded-full font-bold bg-gradient-to-tr from-green-500 via-emerald-500 to-teal-400 text-white shadow">PAID</span>
                        <span className="text-xs font-semibold text-gray-400 tracking-widest">{row.leads?.lead_number}</span>
                        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                        <span className="text-lg font-extrabold text-gray-900 group-hover:text-primary transition-colors truncate flex-1">{row.leads?.name}</span>
                      </div>
                      <div className="space-y-2 divide-y divide-gray-100">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Contact</span>
                          <span className="text-sm font-bold text-purple-600 ml-2">{row.client_name}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Date Paid</span>
                          <span className="text-sm font-bold text-gray-800 ml-2">{row.paid_at ? new Date(row.paid_at).toLocaleDateString() : '-'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Amount (with VAT)</span>
                          <span className="text-sm font-bold text-gray-800 ml-2">₪{(Number(row.value) + Number(row.value_vat)).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Order</span>
                          <span className="text-sm font-bold text-gray-800 ml-2">{row.payment_order || '-'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs font-semibold text-gray-500">Invoice</span>
                          <span className="text-sm font-bold text-blue-600 ml-2">{proforma?.proformaName || 'N/A'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/30" onClick={handleCloseDrawer}></div>
          <div className="relative bg-white w-full max-w-md ml-auto h-full shadow-2xl p-8 flex flex-col">
            <h2 className="text-2xl font-bold mb-4">Collection Label & Comments</h2>
            <label className="font-semibold mb-1">Label</label>
            <div className="flex gap-2 mb-4">
              <select
                className="select select-bordered w-full"
                value={collectionLabelInput}
                onChange={e => setCollectionLabelInput(e.target.value)}
                disabled={savingCollection}
              >
                <option value="">Choose label...</option>
                {COLLECTION_LABEL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.value}</option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={handleSaveCollectionLabel} disabled={savingCollection}>Save</button>
            </div>
            <label className="font-semibold mb-1">Comments</label>
            <div className="mb-2 max-h-40 overflow-y-auto space-y-2">
              {collectionComments.length === 0 ? (
                <div className="text-base-content/40">No comments yet.</div>
              ) : (
                collectionComments.slice().reverse().map((c, idx) => (
                  <div key={idx} className="bg-base-200 rounded-lg p-3 flex flex-col">
                    <span className="text-base-content/90">{c.text}</span>
                    <span className="text-xs text-base-content/50 mt-1">{c.user} · {new Date(c.timestamp).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                className="input input-bordered flex-1"
                placeholder="Add a comment..."
                value={newCollectionComment}
                onChange={e => setNewCollectionComment(e.target.value)}
                disabled={savingCollection}
              />
              <button className="btn btn-primary" onClick={handleAddCollectionComment} disabled={savingCollection || !newCollectionComment.trim()}>Add</button>
            </div>
            <button
              className="btn btn-primary mb-4 mt-6"
              onClick={() => setShowContractModal(true)}
            >
              View Contract
            </button>
            <div className="flex gap-2 mt-auto">
              <button className="btn btn-outline flex-1" onClick={handleCloseDrawer}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showContractModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowContractModal(false)}></div>
          <div className="relative bg-white rounded-xl shadow-2xl p-8 max-w-lg w-full">
            <h3 className="text-xl font-bold mb-4">Contract Details</h3>
            <div className="prose max-w-none mb-6">
              {/* Replace with real contract content or PDF preview */}
              <p>This is a mock contract preview for lead/meeting <b>{selectedItem?.lead_number || selectedItem?.name}</b>.</p>
              <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer nec odio. Praesent libero. Sed cursus ante dapibus diam.</p>
            </div>
            <button className="btn btn-primary w-full" onClick={() => setShowContractModal(false)}>Close</button>
          </div>
        </div>
      )}
      {/* Proforma Modal */}
      {showProformaModal && selectedProforma && (
        <div className="fixed inset-0 z-60 bg-black/30 flex items-center justify-center p-4">
          <div id="proforma-print-area" className="bg-white rounded-xl shadow-2xl max-w-4xl w-full h-full flex flex-col overflow-hidden mt-24">
            {/* Header */}
            <div className="flex justify-between items-center p-6 border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-900">PROFORMA INVOICE</h2>
                <div className="text-sm text-gray-600">
                  <div>Created: <span className="font-semibold">{new Date(selectedProforma.createdAt).toLocaleString()}</span></div>
                  <div>By: <span className="font-semibold">{selectedProforma.createdBy}</span></div>
                </div>
              </div>
              <div className="flex items-center gap-2 proforma-action-buttons">
                <button 
                  className="btn btn-outline btn-sm gap-2"
                  onClick={handlePrintProforma}
                  title="Print Proforma"
                >
                  <PrinterIcon className="w-4 h-4" />
                  Print
                </button>
                <button 
                  className="btn btn-primary btn-sm gap-2"
                  onClick={handleSendToClient}
                  title="Send to Client"
                >
                  <EnvelopeIcon className="w-4 h-4" />
                  Send to Client
                </button>
                <button 
                  className="btn btn-circle btn-ghost btn-sm"
                  onClick={() => setShowProformaModal(false)}
                  title="Close"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8">
              {/* Header */}
              <div className="flex justify-between items-start mb-8 max-w-6xl mx-auto">
                <div>
                  <div className="text-sm text-gray-600">
                    <div>Proforma No: <span className="font-semibold">{selectedProforma.number}</span></div>
                    <div>Date: <span className="font-semibold">{new Date(selectedProforma.date).toLocaleDateString()}</span></div>
                    <div>Due Date: <span className="font-semibold">{new Date(selectedProforma.dueDate).toLocaleDateString()}</span></div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900 mb-2">{selectedProforma.company.name}</div>
                  <div className="text-sm text-gray-600">
                    <div>{selectedProforma.company.address}</div>
                    <div>Phone: {selectedProforma.company.phone}</div>
                    <div>Email: {selectedProforma.company.email}</div>
                    <div>VAT: {selectedProforma.company.vatNumber}</div>
                    <div>Company No: {selectedProforma.company.companyNumber}</div>
                  </div>
                </div>
              </div>

              {/* Client Info */}
              <div className="mb-8 p-4 bg-gray-50 rounded-lg max-w-6xl mx-auto">
                <h3 className="font-semibold text-gray-900 mb-2">Bill To:</h3>
                <div className="text-sm text-gray-700">
                  <div className="font-semibold">{selectedProforma.client.name}</div>
                  <div>{selectedProforma.client.address}</div>
                  <div>Phone: {selectedProforma.client.phone}</div>
                  <div>Email: {selectedProforma.client.email}</div>
                </div>
              </div>

              {/* Items Table */}
              <div className="mb-8 max-w-6xl mx-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="text-left p-3 border border-gray-300 font-semibold">Description</th>
                      <th className="text-center p-3 border border-gray-300 font-semibold">Qty</th>
                      <th className="text-right p-3 border border-gray-300 font-semibold">Unit Price</th>
                      <th className="text-center p-3 border border-gray-300 font-semibold">VAT %</th>
                      <th className="text-right p-3 border border-gray-300 font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProforma.items.map((item: any, index: number) => (
                      <tr key={index} className="border-b border-gray-200">
                        <td className="p-3 border border-gray-300">{item.description}</td>
                        <td className="p-3 border border-gray-300 text-center">{item.quantity}</td>
                        <td className="p-3 border border-gray-300 text-right">{getCurrencySymbol()} {item.unitPrice.toLocaleString()}</td>
                        <td className="p-3 border border-gray-300 text-center">{item.vatRate}%</td>
                        <td className="p-3 border border-gray-300 text-right font-semibold">{getCurrencySymbol()} {item.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end mb-8 max-w-6xl mx-auto">
                <div className="w-80">
                  {(() => {
                    const totals = calculateTotals(selectedProforma.items);
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>Subtotal:</span>
                          <span>{getCurrencySymbol()} {totals.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>VAT (17%):</span>
                          <span>{getCurrencySymbol()} {totals.vat.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold border-t pt-2">
                          <span>Total:</span>
                          <span>{getCurrencySymbol()} {totals.total.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Terms */}
              <div className="mb-8 p-4 bg-gray-50 rounded-lg max-w-6xl mx-auto">
                <h3 className="font-semibold text-gray-900 mb-2">Terms & Conditions:</h3>
                <div className="text-sm text-gray-700 space-y-1">
                  <div>• Payment is due within 14 days of invoice date</div>
                  <div>• Late payments may incur additional charges</div>
                  <div>• All amounts are subject to VAT as applicable</div>
                  <div>• This is a proforma invoice and does not constitute a tax invoice</div>
                </div>
              </div>

              {/* Footer */}
              <div className="text-center text-sm text-gray-600 border-t pt-4 max-w-6xl mx-auto">
                <div>Thank you for your business!</div>
                <div>For questions regarding this proforma, please contact our billing department</div>
              </div>
            </div>
            {/* Print-only CSS */}
            <style>{`
              @media print {
                body * {
                  visibility: hidden !important;
                }
                #proforma-print-area, #proforma-print-area * {
                  visibility: visible !important;
                }
                #proforma-print-area {
                  position: absolute !important;
                  left: 0; top: 0; width: 100vw; min-height: 100vh;
                  background: white !important;
                  box-shadow: none !important;
                  margin: 0 !important;
                  border-radius: 0 !important;
                  z-index: 9999 !important;
                }
                .proforma-action-buttons {
                  display: none !important;
                }
              }
            `}</style>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionPage; 