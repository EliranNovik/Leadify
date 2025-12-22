import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, DocumentTextIcon, UserIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, PhoneIcon, EnvelopeIcon, BanknotesIcon, ArrowPathIcon, UserPlusIcon, NoSymbolIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';
import { fetchStageNames } from '../lib/stageUtils';

interface HistoryEntry {
  id: string;
  type: 'edit' | 'interaction' | 'stage_change' | 'lead_created' | 'finance_change' | 'unactivation' | 'activation';
  field?: string;
  old_value?: string;
  new_value?: string;
  changed_by: string;
  changed_at: string;
  user_full_name?: string;
  interaction_type?: 'email' | 'whatsapp' | 'phone' | 'sms' | 'meeting';
  interaction_content?: string;
  interaction_direction?: 'incoming' | 'outgoing';
  // Finance change specific fields
  finance_change_type?: string;
  finance_notes?: string;
  // Unactivation specific fields
  unactivation_reason?: string;
}

const HistoryPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'edits' | 'interactions' | 'stage_changes' | 'lead_created' | 'finance_changes' | 'unactivation'>('all');
  const [stageNamesMap, setStageNamesMap] = useState<{ [key: number]: string }>({});

  useEffect(() => {
    const loadStageNames = async () => {
      const stages = await fetchStageNames();
      // fetchStageNames returns an object, not an array
      if (typeof stages === 'object' && !Array.isArray(stages)) {
        setStageNamesMap(stages as { [key: number]: string });
      } else if (Array.isArray(stages)) {
        // If it's an array, convert it
        const stageMap: { [key: number]: string } = {};
        stages.forEach((stage: any) => {
          stageMap[stage.id] = stage.name;
        });
        setStageNamesMap(stageMap);
      }
    };
    
    loadStageNames();
  }, []);

  useEffect(() => {
    if (lead_number) {
      fetchClientAndHistory();
    }
  }, [lead_number]);

  const fetchClientAndHistory = async () => {
    try {
      setLoading(true);
      
      // Try to fetch from new leads table first
      let clientData: any = null;
      let isLegacy = false;

      const { data: newLeadData, error: newLeadError } = await supabase
        .from('leads')
        .select(`
          *,
          emails (*),
          whatsapp_messages (*)
        `)
        .eq('lead_number', lead_number)
        .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows gracefully

      if (newLeadData) {
        clientData = newLeadData;
        isLegacy = false;
      } else {
        // Try legacy leads table by manual_id first
        let legacyLeadData: any = null;
        
        const { data: legacyByManualId } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('manual_id', lead_number)
          .maybeSingle();
        
        if (legacyByManualId) {
          legacyLeadData = legacyByManualId;
        } else {
          // Try searching by id (for numeric lead numbers that might be the database ID)
          const { data: legacyById } = await supabase
            .from('leads_lead')
            .select('*')
            .eq('id', parseInt(lead_number) || 0)
            .maybeSingle();
          
          legacyLeadData = legacyById;
        }

        if (!legacyLeadData) {
          // Lead not found in either table
          throw new Error(`Lead #${lead_number} not found`);
        }
        
        clientData = legacyLeadData;
        isLegacy = true;
        
        // Fetch emails separately for legacy leads
        const { data: legacyEmails } = await supabase
          .from('emails')
          .select('*')
          .eq('legacy_id', clientData.id);
        
        // Fetch WhatsApp messages separately for legacy leads
        const { data: legacyWhatsApp } = await supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('legacy_lead_id', clientData.id);
        
        // Map legacy fields to new lead structure for consistency
        clientData.lead_number = clientData.manual_id;
        clientData.emails = legacyEmails || [];
        clientData.whatsapp_messages = legacyWhatsApp || [];
      }

      setClient(clientData);

      // Build history from available data
      const historyEntries: HistoryEntry[] = [];

      // Add lead creation event
      // For legacy leads, use cdate; for new leads, use created_at
      const creationDate = isLegacy 
        ? (clientData.cdate || clientData.created_at)
        : (clientData.created_at || clientData.cdate);
      
      // Determine who created the lead
      let createdBy = 'System';
      let createdByFullName = 'System';
      
      // Check if created by employee (manual creation)
      if (clientData.creator_id) {
        // Will be looked up later in the user lookup section
        createdBy = `Employee #${clientData.creator_id}`;
        createdByFullName = createdBy;
      } 
      // Check if created by webhook (autolead)
      else if (clientData.source || clientData.lead_source) {
        const source = clientData.source || clientData.lead_source || 'Unknown';
        createdBy = 'Autolead';
        createdByFullName = `Autolead - ${source}`;
      }
      // Fallback to created_by if available
      else if (clientData.created_by) {
        createdBy = clientData.created_by;
        createdByFullName = clientData.created_by_full_name || clientData.created_by;
      }
      
      historyEntries.push({
        id: 'lead_created',
        type: 'lead_created',
        changed_by: createdBy,
        changed_at: creationDate,
        user_full_name: createdByFullName
      });

      // Add field edit history
      const fieldEditHistory = [
        {
          field: 'special_notes',
          changed_by: clientData.special_notes_last_edited_by,
          changed_at: clientData.special_notes_last_edited_at,
          current_value: clientData.special_notes
        },
        {
          field: 'general_notes',
          changed_by: clientData.general_notes_last_edited_by,
          changed_at: clientData.general_notes_last_edited_at,
          current_value: clientData.general_notes
        },
        {
          field: 'tags',
          changed_by: clientData.tags_last_edited_by,
          changed_at: clientData.tags_last_edited_at,
          current_value: clientData.tags
        },
        {
          field: 'anchor',
          changed_by: clientData.anchor_last_edited_by,
          changed_at: clientData.anchor_last_edited_at,
          current_value: clientData.anchor
        },
        {
          field: 'facts',
          changed_by: clientData.facts_last_edited_by,
          changed_at: clientData.facts_last_edited_at,
          current_value: clientData.facts
        }
      ];

      fieldEditHistory.forEach((field, index) => {
        if (field.changed_by && field.changed_at) {
          historyEntries.push({
            id: `edit_${index}`,
            type: 'edit',
            field: field.field,
            new_value: field.current_value,
            changed_by: field.changed_by,
            changed_at: field.changed_at
          });
        }
      });

      // Add stage change history
      if (clientData.stage_changed_by && clientData.stage_changed_at) {
        historyEntries.push({
          id: 'stage_change',
          type: 'stage_change',
          field: 'stage',
          new_value: clientData.stage,
          changed_by: clientData.stage_changed_by,
          changed_at: clientData.stage_changed_at
        });
      }

      // Add unactivation history
      if (clientData.unactivated_by && clientData.unactivated_at) {
        historyEntries.push({
          id: 'unactivation',
          type: 'unactivation',
          changed_by: clientData.unactivated_by,
          changed_at: clientData.unactivated_at,
          unactivation_reason: clientData.unactivation_reason || 'No reason provided'
        });
      }

      // Note: Activation events would need to be tracked separately since they clear the unactivation data
      // For now, we'll only show unactivation events. Activation events could be added to a separate table
      // or tracked in the lead_changes table in the future.

      // Add manual interactions from the interactions field
      // For both new and legacy leads, manual_interactions is stored as JSON
      const manualInteractions = clientData.manual_interactions || clientData.interactions;
      if (manualInteractions && Array.isArray(manualInteractions)) {
        manualInteractions.forEach((interaction: any, index: number) => {
          // Handle both date formats: combined "YYYY-MM-DD HH:mm" or separate date/time fields
          let interactionDate = interaction.changed_at || interaction.created_at;
          if (!interactionDate && interaction.date && interaction.time) {
            interactionDate = `${interaction.date} ${interaction.time}`;
          } else if (!interactionDate && interaction.date) {
            interactionDate = interaction.date;
          }
          
          historyEntries.push({
            id: `interaction_${index}`,
            type: 'interaction',
            changed_by: interaction.employee || interaction.user || 'Unknown',
            changed_at: interactionDate || new Date().toISOString(),
            interaction_type: interaction.kind?.toLowerCase() || interaction.type?.toLowerCase() || 'unknown',
            interaction_content: interaction.content || interaction.observation || interaction.notes || 'No content',
            interaction_direction: interaction.direction || 'outgoing',
            user_full_name: interaction.employee || interaction.user || 'Unknown'
          });
        });
      }

      // Add email interactions
      if (clientData.emails && Array.isArray(clientData.emails)) {
        clientData.emails.forEach((email: any, index: number) => {
          const emailDate = new Date(email.sent_at);
          historyEntries.push({
            id: `email_${index}`,
            type: 'interaction',
            changed_by: email.direction === 'outgoing' ? 'You' : clientData.name,
            changed_at: email.sent_at,
            interaction_type: 'email',
            interaction_content: email.subject || email.body_preview || 'No content',
            interaction_direction: email.direction || 'outgoing',
            user_full_name: email.direction === 'outgoing' ? 'You' : clientData.name
          });
        });
      }

      // Add WhatsApp interactions
      if (clientData.whatsapp_messages && Array.isArray(clientData.whatsapp_messages)) {
        clientData.whatsapp_messages.forEach((msg: any, index: number) => {
          historyEntries.push({
            id: `whatsapp_${index}`,
            type: 'interaction',
            changed_by: msg.direction === 'out' ? msg.sender_name || 'You' : clientData.name,
            changed_at: msg.sent_at,
            interaction_type: 'whatsapp',
            interaction_content: msg.message || 'No content',
            interaction_direction: msg.direction === 'out' ? 'outgoing' : 'incoming',
            user_full_name: msg.direction === 'out' ? msg.sender_name || 'You' : clientData.name
          });
        });
      }

      // Add finance changes from payment_plan_changes table
      console.log('Fetching payment changes for lead_id:', clientData.id, 'isLegacy:', isLegacy);
      
      // Fetch changes for both new and legacy leads
      const paymentChangesQuery = supabase
        .from('payment_plan_changes')
        .select('*')
        .order('changed_at', { ascending: false });
      
      if (isLegacy) {
        paymentChangesQuery.eq('legacy_lead_id', clientData.id);
      } else {
        paymentChangesQuery.eq('lead_id', clientData.id);
      }
      
      const { data: paymentChanges, error: paymentChangesError } = await paymentChangesQuery;
      console.log('Payment changes fetch result:', { paymentChanges, paymentChangesError });

      // Add finance changes from finance_changes_history table (for ready_to_pay and other finance events)
      const financeHistoryQuery = supabase
        .from('finance_changes_history')
        .select('*')
        .order('changed_at', { ascending: false });
      
      if (isLegacy) {
        financeHistoryQuery.eq('legacy_lead_id', clientData.id);
      } else {
        financeHistoryQuery.eq('lead_id', clientData.id);
      }
      
      const { data: financeHistory, error: financeHistoryError } = await financeHistoryQuery;
      console.log('Finance history fetch result:', { financeHistory, financeHistoryError });

      // Add lead changes from lead_changes table
      console.log('Fetching lead changes for lead_id:', clientData.id, 'isLegacy:', isLegacy);
      
      const leadChangesQuery = supabase
        .from('lead_changes')
        .select('*')
        .order('changed_at', { ascending: false });
      
      if (isLegacy) {
        leadChangesQuery.eq('legacy_lead_id', clientData.id);
      } else {
        leadChangesQuery.eq('lead_id', clientData.id);
      }
      
      const { data: leadChanges, error: leadChangesError } = await leadChangesQuery;
      console.log('Lead changes fetch result:', { leadChanges, leadChangesError });

      // Add stage changes from leads_leadstage table
      console.log('Fetching stage changes from leads_leadstage for lead_id:', clientData.id, 'isLegacy:', isLegacy);
      
      // Fetch ALL stage changes without any limits
      // Use left join for employee so we don't lose records with null creator_id
      let stageChanges: any[] = [];
      let stageChangesError = null;
      
      try {
        const stageChangesQuery = supabase
          .from('leads_leadstage')
          .select(`
            *,
            tenants_employee:creator_id (
              display_name,
              email,
              first_name,
              last_name
            )
          `)
          .order('cdate', { ascending: false, nullsFirst: false })
          .order('date', { ascending: false, nullsFirst: false });
        
        if (isLegacy) {
          stageChangesQuery.eq('lead_id', clientData.id);
        } else {
          stageChangesQuery.eq('newlead_id', clientData.id);
        }
        
        const result = await stageChangesQuery;
        stageChanges = result.data || [];
        stageChangesError = result.error;
        
        console.log('Stage changes fetch result:', { 
          count: stageChanges?.length, 
          stageChanges: stageChanges?.slice(0, 5), // Log first 5 for inspection
          stageChangesError,
          errorDetails: stageChangesError ? {
            code: stageChangesError.code,
            message: stageChangesError.message,
            details: stageChangesError.details,
            hint: stageChangesError.hint
          } : null
        });
      } catch (error) {
        console.error('Error fetching stage changes:', error);
        stageChangesError = error;
      }

      if (!paymentChangesError && paymentChanges) {
        paymentChanges.forEach((change: any) => {
          const fieldDisplayName = getFieldDisplayName(change.field_name);
          
          if (change.field_name === 'payment_deleted') {
            // Handle deletion entries
            try {
              const deletedPayment = JSON.parse(change.old_value);
              historyEntries.push({
                id: `payment_change_${change.id}`,
                type: 'finance_change',
                changed_by: change.changed_by,
                changed_at: change.changed_at,
                finance_change_type: 'payment_deleted',
                finance_notes: `Payment deleted: ${deletedPayment.payment_order || 'Unknown payment'} (${deletedPayment.value || 0})`,
                user_full_name: change.changed_by // Will be updated later with actual user name
              });
            } catch (e) {
              console.error('Error parsing deleted payment data:', e);
            }
          } else if (change.field_name === 'payment_plan_created' || change.field_name === 'auto_plan_created') {
            // Handle payment plan creation entries
            try {
              const paymentData = JSON.parse(change.new_value);
              historyEntries.push({
                id: `payment_change_${change.id}`,
                type: 'finance_change',
                changed_by: change.changed_by,
                changed_at: change.changed_at,
                finance_change_type: change.field_name,
                finance_notes: `Payment plan created: ${paymentData.payment_order} (${paymentData.value})`,
                user_full_name: change.changed_by // Will be updated later with actual user name
              });
            } catch (e) {
              console.error('Error parsing payment plan creation data:', e);
            }
          } else {
            // Handle regular field changes
            const oldValue = change.old_value || 'empty';
            const newValue = change.new_value || 'empty';
            
            historyEntries.push({
              id: `payment_change_${change.id}`,
              type: 'finance_change',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              finance_change_type: 'payment_field_updated',
              finance_notes: `${fieldDisplayName} changed from "${oldValue}" to "${newValue}"`,
              user_full_name: change.changed_by // Will be updated later with actual user name
            });
          }
        });
      }

      // Add finance history entries (ready_to_pay, payment_marked_paid, etc.)
      if (!financeHistoryError && financeHistory) {
        financeHistory.forEach((change: any) => {
          if (change.change_type === 'payment_marked_ready_to_pay') {
            historyEntries.push({
              id: `finance_history_${change.id}`,
              type: 'finance_change',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              finance_change_type: 'payment_marked_ready_to_pay',
              finance_notes: `Payment marked as ready to pay${change.notes ? ` - ${change.notes}` : ''}`,
              user_full_name: change.changed_by
            });
          } else if (change.change_type === 'payment_reverted_from_ready_to_pay') {
            historyEntries.push({
              id: `finance_history_${change.id}`,
              type: 'finance_change',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              finance_change_type: 'payment_reverted_from_ready_to_pay',
              finance_notes: `Payment reverted from ready to pay${change.notes ? ` - ${change.notes}` : ''}`,
              user_full_name: change.changed_by
            });
          } else if (change.change_type === 'payment_marked_paid') {
            historyEntries.push({
              id: `finance_history_${change.id}`,
              type: 'finance_change',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              finance_change_type: 'payment_marked_paid',
              finance_notes: `Payment marked as paid${change.notes ? ` - ${change.notes}` : ''}`,
              user_full_name: change.changed_by
            });
          }
        });
      }

      // Add lead changes to history entries
      if (!leadChangesError && leadChanges) {
        leadChanges.forEach((change: any) => {
          // Handle activation events specially
          if (change.field_name === 'lead_activated') {
            historyEntries.push({
              id: `lead_change_${change.id}`,
              type: 'activation',
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              user_full_name: change.changed_by
            });
          } else {
            // Handle regular field changes
            const fieldDisplayName = getFieldDisplayName(change.field_name);
            
            historyEntries.push({
              id: `lead_change_${change.id}`,
              type: 'edit',
              field: change.field_name,
              old_value: change.old_value,
              new_value: change.new_value,
              changed_by: change.changed_by,
              changed_at: change.changed_at,
              user_full_name: change.changed_by
            });
          }
        });
      }

      // Add stage changes from leads_leadstage table
      if (!stageChangesError && stageChanges && stageChanges.length > 0) {
        console.log(`Processing ${stageChanges.length} stage changes from leads_leadstage`);
        
        stageChanges.forEach((stageChange: any) => {
          // Get employee name from join or fallback to creator_id
          let employeeName = 'Unknown';
          
          if (stageChange.tenants_employee) {
            employeeName = stageChange.tenants_employee.display_name || 
                          `${stageChange.tenants_employee.first_name || ''} ${stageChange.tenants_employee.last_name || ''}`.trim() ||
                          stageChange.tenants_employee.email ||
                          'Unknown';
          } else if (stageChange.creator_id) {
            // If join failed but we have creator_id, we'll look it up later
            employeeName = `Employee #${stageChange.creator_id}`;
          }
          
          // Use date if available, otherwise cdate
          const changeDate = stageChange.date || stageChange.cdate || new Date().toISOString();
          
          historyEntries.push({
            id: `stage_change_leadstage_${stageChange.id}`,
            type: 'stage_change',
            field: 'stage',
            new_value: String(stageChange.stage),
            changed_by: employeeName,
            changed_at: changeDate,
            user_full_name: employeeName
          });
        });
        
        console.log(`Added ${stageChanges.length} stage changes to history`);
      } else {
        console.log('No stage changes found in leads_leadstage table');
      }

      // Fetch user full names for all changed_by values
      const allChangedBy = [...new Set(historyEntries.map(entry => entry.changed_by).filter(name => name && name !== 'System' && name !== 'Autolead'))];
      
      // Extract employee IDs from entries like "Employee #123"
      const employeeIds: number[] = [];
      allChangedBy.forEach(name => {
        const match = name.match(/^Employee #(\d+)$/);
        if (match) {
          employeeIds.push(parseInt(match[1]));
        }
      });
      
      // Also check user_full_name field for employee references
      historyEntries.forEach(entry => {
        const match = entry.user_full_name?.match(/^Employee #(\d+)$/);
        if (match) {
          const id = parseInt(match[1]);
          if (!employeeIds.includes(id)) {
            employeeIds.push(id);
          }
        }
      });
      
      // Fetch employee names from tenants_employee table
      let employeeMap: { [key: number]: string } = {};
      if (employeeIds.length > 0) {
        console.log('Looking up employees by ID:', employeeIds, 'Type check:', employeeIds.map(id => ({ id, type: typeof id })));
        
        const { data: employees, error: employeesError } = await supabase
          .from('tenants_employee')
          .select('id, display_name, email, first_name, last_name')
          .in('id', employeeIds);
        
        console.log('Employees fetch result:', { 
          employees, 
          employeesError,
          errorDetails: employeesError ? {
            code: employeesError.code,
            message: employeesError.message,
            details: employeesError.details,
            hint: employeesError.hint
          } : null
        });
        
        if (employees && employees.length > 0) {
          employees.forEach(emp => {
            const displayName = emp.display_name || 
                              `${emp.first_name || ''} ${emp.last_name || ''}`.trim() ||
                              emp.email ||
                              `Employee #${emp.id}`;
            employeeMap[emp.id] = displayName;
          });
          console.log('Employee map:', employeeMap);
        }
      }
      
      if (allChangedBy.length > 0) {
        console.log('Looking up users for:', allChangedBy);
        console.log('All history entries:', historyEntries.map(e => ({ changed_by: e.changed_by, type: e.type })));
        
        // Try to find users by email first
        const { data: usersByEmail } = await supabase
          .from('users')
          .select('email, full_name, first_name, last_name')
          .in('email', allChangedBy);

        // Try to find users by name (full_name, first_name + last_name)
        const { data: usersByName } = await supabase
          .from('users')
          .select('email, full_name, first_name, last_name')
          .or(`full_name.in.(${allChangedBy.join(',')}),first_name.in.(${allChangedBy.join(',')}),last_name.in.(${allChangedBy.join(',')})`);

        console.log('Users found by email:', usersByEmail);
        console.log('Users found by name:', usersByName);

        // Combine both results
        const allUsers = [...(usersByEmail || []), ...(usersByName || [])];
        
        // Apply employee mapping first (highest priority)
        historyEntries.forEach(entry => {
          // Check if changed_by is an employee ID reference
          const employeeMatch = entry.changed_by.match(/^Employee #(\d+)$/);
          if (employeeMatch) {
            const empId = parseInt(employeeMatch[1]);
            if (employeeMap[empId]) {
              entry.user_full_name = employeeMap[empId];
              console.log(`✅ Mapped employee ${entry.changed_by} to:`, entry.user_full_name);
              entry.changed_by = employeeMap[empId]; // Also update changed_by for display
            } else {
              console.log(`❌ No mapping found for ${entry.changed_by}`);
            }
          }
          
          // Also check user_full_name field
          const fullNameMatch = entry.user_full_name?.match(/^Employee #(\d+)$/);
          if (fullNameMatch) {
            const empId = parseInt(fullNameMatch[1]);
            if (employeeMap[empId]) {
              entry.user_full_name = employeeMap[empId];
              console.log(`✅ Mapped user_full_name ${fullNameMatch[0]} to:`, entry.user_full_name);
            }
          }
        });
        
        // Then apply user mapping for non-employee entries
        if (allUsers.length > 0) {
          historyEntries.forEach(entry => {
            // Skip if already mapped (employee or autolead)
            if (entry.user_full_name && !entry.user_full_name.includes('Employee #')) {
              return;
            }
            
            console.log(`Processing entry with changed_by: "${entry.changed_by}"`);
            
            // Try to find by email first
            let user = allUsers.find(u => u.email === entry.changed_by);
            
            // If not found by email, try by name (case-insensitive)
            if (!user) {
              user = allUsers.find(u => 
                u.full_name?.toLowerCase() === entry.changed_by?.toLowerCase() || 
                `${u.first_name} ${u.last_name}`.toLowerCase() === entry.changed_by?.toLowerCase() ||
                u.first_name?.toLowerCase() === entry.changed_by?.toLowerCase() ||
                u.last_name?.toLowerCase() === entry.changed_by?.toLowerCase()
              );
            }
            
            if (user) {
              entry.user_full_name = user.full_name || `${user.first_name} ${user.last_name}` || user.email;
              console.log(`Found user for ${entry.changed_by}:`, entry.user_full_name);
            }
          });
        }
      }

      // Sort by date (newest first)
      historyEntries.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
      
      setHistoryData(historyEntries);
      setError(null); // Clear any previous errors
    } catch (error: any) {
      console.error('Error fetching history:', error);
      setError(error?.message || 'Failed to load history data');
    } finally {
      setLoading(false);
    }
  };

  const getStageName = (stageId: string | number): string => {
    const id = typeof stageId === 'string' ? parseInt(stageId) : stageId;
    return stageNamesMap[id] || `Stage ${stageId}`;
  };

  const getFieldDisplayName = (field: string) => {
    const fieldMap: { [key: string]: string } = {
      'special_notes': 'Special Notes',
      'general_notes': 'General Notes',
      'tags': 'Tags',
      'anchor': 'Anchor',
      'facts': 'Facts',
      'stage': 'Stage',
      'due_date': 'Due Date',
      'due_percent': 'Due Percentage',
      'value': 'Amount',
      'value_vat': 'VAT Amount',
      'client_name': 'Client Name',
      'payment_order': 'Payment Order',
      'notes': 'Notes',
      'payment_deleted': 'Payment Deleted',
      'payment_plan_created': 'Payment Plan Created',
      'auto_plan_created': 'Auto Finance Plan Created',
      // Additional lead field names
      'name': 'Client Name',
      'source': 'Source',
      'language': 'Language',
      'category': 'Category',
      'topic': 'Topic',
      'probability': 'Probability',
      'number_of_applicants_meeting': 'Number of Applicants Meeting',
      'potential_applicants_meeting': 'Potential Applicants Meeting',
      'balance': 'Balance',
      'next_followup': 'Next Follow-up',
      'balance_currency': 'Balance Currency',
    };
    return fieldMap[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getFinanceChangeDisplayName = (changeType: string) => {
    const changeTypeMap: { [key: string]: string } = {
      'payment_created': 'Payment Created',
      'payment_updated': 'Payment Updated',
      'payment_deleted': 'Payment Deleted',
      'payment_marked_paid': 'Payment Marked as Paid',
      'payment_marked_ready_to_pay': 'Payment Marked as Ready to Pay',
      'payment_reverted_from_ready_to_pay': 'Payment Reverted from Ready to Pay',
      'payment_plan_created': 'Payment Plan Created',
      'auto_plan_created': 'Auto Finance Plan Created',
      'contract_created': 'Contract Created',
      'contract_updated': 'Contract Updated',
      'payment_field_updated': 'Payment Field Updated'
    };
    return changeTypeMap[changeType] || changeType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getInteractionIcon = (type: string) => {
    switch (type) {
      case 'email':
        return <EnvelopeIcon className="w-4 h-4 text-blue-500" />;
      case 'whatsapp':
        return <ChatBubbleLeftRightIcon className="w-4 h-4 text-green-500" />;
      case 'phone':
      case 'call':
        return <PhoneIcon className="w-4 h-4 text-purple-500" />;
      case 'sms':
        return <ChatBubbleLeftRightIcon className="w-4 h-4 text-orange-500" />;
      default:
        return <DocumentTextIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  const getEntryIcon = (entry: HistoryEntry) => {
    switch (entry.type) {
      case 'edit':
        return <PencilSquareIcon className="w-4 h-4 text-blue-500" />;
      case 'interaction':
        return getInteractionIcon(entry.interaction_type || 'unknown');
      case 'stage_change':
        return <ArrowPathIcon className="w-4 h-4 text-orange-500" />;
      case 'lead_created':
        return <UserPlusIcon className="w-4 h-4 text-green-500" />;
      case 'finance_change':
        return <BanknotesIcon className="w-4 h-4 text-purple-500" />;
      case 'unactivation':
        return <NoSymbolIcon className="w-4 h-4 text-red-500" />;
      case 'activation':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />;
      default:
        return <DocumentTextIcon className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const filteredHistory = historyData.filter(entry => {
    if (filterType === 'all') return true;
    if (filterType === 'edits' && entry.type === 'edit') return true;
    if (filterType === 'interactions' && entry.type === 'interaction') return true;
    if (filterType === 'stage_changes' && entry.type === 'stage_change') return true;
    if (filterType === 'lead_created' && entry.type === 'lead_created') return true;
    if (filterType === 'finance_changes' && entry.type === 'finance_change') return true;
    if (filterType === 'unactivation' && (entry.type === 'unactivation' || entry.type === 'activation')) return true;
    return false;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loading loading-spinner loading-lg"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => navigate(-1)}
            className="btn btn-outline btn-sm"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Go Back
          </button>
          <h1 className="text-3xl font-bold">Change History</h1>
        </div>
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate(`/clients/${lead_number}`)}
          className="btn btn-outline btn-sm"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-2" />
          Back to Client
        </button>
        <h1 className="text-3xl font-bold">Change History</h1>
      </div>

      {client && (
        <div className="mb-6 p-4 bg-base-100 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-2">{client.name}</h2>
          <p className="text-gray-600">Lead #{client.lead_number}</p>
          {filteredHistory.length > 0 && (
            <div className="mt-2 pt-2 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                <span className="font-medium">Last interaction:</span> {filteredHistory[0].user_full_name || filteredHistory[0].changed_by}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mb-6">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="select select-bordered"
        >
          <option value="all">All Changes</option>
          <option value="edits">Field Edits</option>
          <option value="interactions">Interactions</option>
          <option value="stage_changes">Stage Changes</option>
          <option value="lead_created">Lead Created</option>
          <option value="finance_changes">Finance Changes</option>
          <option value="unactivation">Unactivation Events</option>
        </select>
      </div>

      <div className="space-y-4">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No history entries found.
          </div>
        ) : (
          filteredHistory.map((entry) => (
            <div key={entry.id} className="bg-white rounded-lg shadow-lg hover:shadow-2xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 p-4 border border-gray-100">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {getEntryIcon(entry)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">
                        {entry.type === 'finance_change' 
                          ? getFinanceChangeDisplayName(entry.finance_change_type || '')
                          : entry.type === 'interaction'
                          ? `${entry.interaction_type?.toUpperCase()} ${entry.interaction_direction}`
                          : entry.type === 'unactivation'
                          ? 'Lead Unactivated'
                          : entry.type === 'activation'
                          ? 'Lead Activated'
                          : entry.field 
                          ? `${getFieldDisplayName(entry.field)} Updated`
                          : entry.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                        }
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatDate(entry.changed_at)}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">By:</span> {entry.user_full_name || entry.changed_by}
                  </div>
                  
                  {entry.type === 'finance_change' && entry.finance_notes && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      {entry.finance_notes}
                    </div>
                  )}
                  
                  {entry.type === 'interaction' && entry.interaction_content && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      {entry.interaction_content}
                    </div>
                  )}
                  
                  {entry.type === 'edit' && entry.new_value && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      <span className="font-medium">New value:</span> {entry.new_value}
                    </div>
                  )}
                  
                  {entry.type === 'stage_change' && entry.new_value && (
                    <div className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                      <span className="font-medium">New stage:</span> {getStageName(entry.new_value)}
                    </div>
                  )}
                  
                  {entry.type === 'unactivation' && entry.unactivation_reason && (
                    <div className="text-sm text-gray-700 bg-red-50 p-2 rounded border border-red-200">
                      <span className="font-medium text-red-700">Reason:</span> {entry.unactivation_reason.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </div>
                  )}
                  
                  {entry.type === 'activation' && (
                    <div className="text-sm text-gray-700 bg-green-50 p-2 rounded border border-green-200">
                      <span className="font-medium text-green-700">Lead reactivated</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default HistoryPage;