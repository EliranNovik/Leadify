import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ArchiveBoxIcon, UserIcon, PencilSquareIcon, ChatBubbleLeftRightIcon, PhoneIcon, EnvelopeIcon, BanknotesIcon, ArrowPathIcon, UserPlusIcon, NoSymbolIcon, CheckCircleIcon, CalendarDaysIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { Client } from '../types/client';
import { fetchStageNames, getStageName, getStageColour } from '../lib/stageUtils';

interface Employee {
  id: number;
  display_name: string;
  photo_url?: string;
  photo?: string;
}

interface HistoryEntry {
  id: string;
  type: 'lead_change' | 'meeting_change' | 'payment_change' | 'lead_created' | 'lead_deleted';
  change_type: 'insert' | 'update' | 'delete';
  changed_by: string;
  changed_at: string;
  employeeDisplayName?: string; // Cached display name for quick access
  description: string; // User-friendly description of what changed
  descriptionBold?: string; // Bold part of description
  descriptionText?: string; // Regular text part of description
  changeDetails?: string[]; // List of specific changes
}

const HistoryPage: React.FC = () => {
  const { lead_number } = useParams<{ lead_number: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [historyData, setHistoryData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'lead_changes' | 'meeting_changes' | 'payment_changes'>('all');
  const [employeeSearch, setEmployeeSearch] = useState<string>('');
  const [stageNamesMap, setStageNamesMap] = useState<{ [key: number]: string }>({});
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [contactMap, setContactMap] = useState<{ [key: number]: string }>({});
  const [allCategories, setAllCategories] = useState<any[]>([]);
  const [allCurrencies, setAllCurrencies] = useState<any[]>([]);
  const [isMasterLead, setIsMasterLead] = useState(false);

  useEffect(() => {
    const loadStageNames = async () => {
      const stages = await fetchStageNames();
      if (typeof stages === 'object' && !Array.isArray(stages)) {
        setStageNamesMap(stages as { [key: number]: string });
      } else if (Array.isArray(stages)) {
        const stageMap: { [key: number]: string } = {};
        stages.forEach((stage: any) => {
          stageMap[stage.id] = stage.name;
        });
        setStageNamesMap(stageMap);
      }
    };
    loadStageNames();
  }, []);

  // Fetch categories (same as ClientHeader.tsx)
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const { data, error } = await supabase
          .from('misc_category')
          .select(`
            id,
            name,
            misc_maincategory ( id, name )
          `)
          .order('name');

        if (error) throw error;
        setAllCategories(data || []);
      } catch (error) {
        console.error('Error fetching categories:', error);
      }
    };
    fetchCategories();
  }, []);

  // Fetch currencies
  useEffect(() => {
    const fetchCurrencies = async () => {
      try {
        const { data, error } = await supabase
          .from('accounting_currencies')
          .select('id, name, iso_code')
          .order('id');

        if (error) throw error;
        setAllCurrencies(data || []);
      } catch (error) {
        console.error('Error fetching currencies:', error);
      }
    };
    fetchCurrencies();
  }, []);

  useEffect(() => {
    if (lead_number) {
      fetchClientAndHistory();
    }
  }, [lead_number]);

  // Fetch all employees (exactly as RolesTab.tsx)
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data: employees, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .order('display_name', { ascending: true });

      if (!error && employees) {
        setAllEmployees(employees);
      }
    };
    fetchEmployees();
  }, []);

  // Helper function to get employee by ID or name (EXACT copy from RolesTab.tsx)
  const getEmployeeById = (employeeIdOrName: string | number | null | undefined) => {
    const employeesToUse = allEmployees;

    if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
      return null;
    }

    // First, try to match by ID
    const employeeById = employeesToUse.find((emp: any) => {
      const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
      const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

      if (isNaN(Number(searchId))) return false;

      if (empId.toString() === searchId.toString()) return true;
      if (Number(empId) === Number(searchId)) return true;

      return false;
    });

    if (employeeById) {
      return employeeById;
    }

    // If not found by ID, try to match by display name
    if (typeof employeeIdOrName === 'string') {
      const employeeByName = employeesToUse.find((emp: any) => {
        if (!emp.display_name) return false;
        return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
      });

      if (employeeByName) {
        return employeeByName;
      }
    }

    return null;
  };

  // Fetch contact names for payment plans
  const fetchContacts = async (contactIds: number[]) => {
    if (contactIds.length === 0) return {};

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, name')
      .in('id', contactIds);

    const contactNameMap: { [key: number]: string } = {};
    if (contacts) {
      contacts.forEach(contact => {
        contactNameMap[contact.id] = contact.name || `Contact #${contact.id}`;
      });
    }
    return contactNameMap;
  };

  // Helper to get employee initials (matching RolesTab.tsx)
  const getEmployeeInitials = (name: string | null | undefined): string => {
    if (!name || name === '---' || name === '--' || name === 'Not assigned') return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Component to render employee avatar (EXACT copy from RolesTab.tsx)
  const EmployeeAvatar: React.FC<{
    employeeId: string | number | null | undefined;
    size?: 'sm' | 'md' | 'lg';
  }> = ({ employeeId, size = 'md' }) => {
    const [imageError, setImageError] = useState(false);
    const employee = getEmployeeById(employeeId);
    const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : size === 'md' ? 'w-12 h-12 text-sm' : 'w-16 h-16 text-base';

    if (!employee) {
      return null;
    }

    const photoUrl = employee.photo_url || employee.photo;
    const initials = getEmployeeInitials(employee.display_name);

    // If we know there's no photo URL or we have an error, show initials immediately
    if (imageError || !photoUrl) {
      return (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center bg-green-100 text-green-700 font-semibold flex-shrink-0`}
          title={employee.display_name}
        >
          {initials}
        </div>
      );
    }

    // Try to render image
    return (
      <img
        src={photoUrl}
        alt={employee.display_name}
        className={`${sizeClasses} rounded-full object-cover flex-shrink-0`}
        onError={() => setImageError(true)}
        title={employee.display_name}
      />
    );
  };

  // Compare two history records to detect what actually changed - only fields that differ
  // Helper function to strip HTML tags from text
  const stripHtmlTags = (html: string): string => {
    if (!html || typeof html !== 'string') return '';
    // Remove HTML tags using regex
    return html.replace(/<[^>]*>/g, '').trim();
  };

  const detectChanges = (oldRecord: any, newRecord: any, tableType: 'lead' | 'meeting' | 'payment', employeesList: any[] = allEmployees): string[] => {
    const changes: string[] = [];

    if (!oldRecord || !newRecord) {
      // For insert/delete, we don't need to show field changes
      if (tableType === 'payment') {
        console.log('🔍 [detectChanges Payment] Missing records:', { hasOld: !!oldRecord, hasNew: !!newRecord });
      }
      return [];
    }

    if (tableType === 'payment') {
      console.log('🔍 [detectChanges Payment] Comparing records:', {
        oldOriginalId: oldRecord.original_id,
        newOriginalId: newRecord.original_id,
        oldChangeType: oldRecord.change_type,
        newChangeType: newRecord.change_type,
        oldChangedAt: oldRecord.changed_at,
        newChangedAt: newRecord.changed_at
      });
    }

    // Only compare fields that actually changed between the two records

    // Helper to get employee name from ID or display name (using local employees list)
    // This works for both new leads (text display names) and legacy leads (numeric IDs)
    const getEmployeeNameFromId = (empIdOrName: any): string => {
      if (!empIdOrName || empIdOrName === '---' || empIdOrName === '--' || empIdOrName === '' || empIdOrName === null || empIdOrName === undefined) {
        return 'Unassigned';
      }

      // Convert to string for comparison
      const empIdOrNameStr = String(empIdOrName).trim();
      if (!empIdOrNameStr || empIdOrNameStr === '---' || empIdOrNameStr === '--' || empIdOrNameStr === 'null' || empIdOrNameStr === 'undefined') {
        return 'Unassigned';
      }

      // First try to match by ID (for legacy leads - numeric IDs)
      const searchId = typeof empIdOrName === 'string' ? parseInt(empIdOrName, 10) : empIdOrName;
      if (!isNaN(Number(searchId)) && Number(searchId) > 0) {
        const emp = employeesList.find((e: any) => {
          if (!e || !e.id) return false;
          const empIdNum = typeof e.id === 'bigint' ? Number(e.id) : (typeof e.id === 'string' ? parseInt(e.id, 10) : e.id);
          if (isNaN(Number(empIdNum))) return false;
          return Number(empIdNum) === Number(searchId);
        });
        if (emp && emp.display_name) {
          return emp.display_name;
        }
      }

      // If not found by ID, try to match by display name (for new leads - text fields)
      if (typeof empIdOrName === 'string') {
        const emp = employeesList.find((e: any) => {
          if (!e || !e.display_name) return false;
          return e.display_name.trim().toLowerCase() === empIdOrName.trim().toLowerCase();
        });
        if (emp && emp.display_name) {
          return emp.display_name;
        }
        // If it's already a display name and not in our list, return it as-is (but clean it)
        const cleaned = empIdOrName.trim();
        if (cleaned && cleaned !== '---' && cleaned !== '--' && cleaned !== 'null' && cleaned !== 'undefined') {
          return cleaned;
        }
      }

      return 'Unassigned';
    };

    // Key fields to track for leads - only show fields that actually changed
    if (tableType === 'lead') {
      // Get all fields from both records to catch any changes
      const allFields = new Set([
        ...Object.keys(oldRecord || {}),
        ...Object.keys(newRecord || {})
      ]);

      // Filter out history-specific fields and system fields
      // Also exclude timestamp fields that track when fields changed (not the actual field changes)
      // Also exclude comment/array fields that are often empty and not meaningful
      const excludeFields = [
        'history_id', 'original_id', 'changed_by', 'changed_at', 'change_type', 'tableType', 'id',
        'probability', 'initial_probability', 'meeting_probability',
        'stage_changed_at', 'communication_started_at', 'created_at', 'updated_at',
        'last_edited_at', 'last_edited_by',
        'comments', 'highlighted_by', 'expert_comments', 'pipeline_comments',
        'expert_page_comments', 'expert_page_highlighted_by', 'additional_contacts'
      ];
      const keyFields = Array.from(allFields).filter(f =>
        !excludeFields.includes(f) &&
        !f.startsWith('_') &&
        !f.endsWith('_last_edited_by') &&
        !f.endsWith('_last_edited_at') &&
        !f.endsWith('_changed_at') &&
        !f.endsWith('_started_at')
      );

      // Debug: Log all fields being compared
      console.log('🔍 [detectChanges Lead] All fields:', {
        allFields: Array.from(allFields),
        excludedFields: excludeFields,
        keyFields: keyFields,
        oldRecordKeys: Object.keys(oldRecord || {}),
        newRecordKeys: Object.keys(newRecord || {})
      });

      const employeeFields = ['closer', 'expert', 'handler', 'scheduler', 'closer_id', 'expert_id', 'handler_id', 'case_handler_id', 'meeting_scheduler_id', 'manager', 'helper', 'manager_id', 'meeting_manager_id', 'meeting_lawyer_id'];
      const noteFields = ['special_notes', 'general_notes', 'notes', 'facts'];
      const numericFields = ['balance', 'proposal_total', 'total', 'total_base', 'vat_value', 'meeting_amount', 'stage', 'status'];

      // Helper to get category display name
      const getCategoryName = (categoryId: number | string | null | undefined): string => {
        if (!categoryId) return '(empty)';
        const category = allCategories.find((cat: any) => {
          const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
          const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
          return catId === searchId || Number(catId) === Number(searchId);
        });
        if (category) {
          if (category.misc_maincategory?.name) {
            return `${category.name} (${category.misc_maincategory.name})`;
          } else {
            return category.name;
          }
        }
        return '(empty)';
      };

      // Helper to get currency name
      const getCurrencyName = (currencyId: number | string | null | undefined): string => {
        if (!currencyId) return '(empty)';
        const currency = allCurrencies.find((curr: any) => {
          const currId = typeof curr.id === 'bigint' ? Number(curr.id) : curr.id;
          const searchId = typeof currencyId === 'string' ? parseInt(currencyId, 10) : currencyId;
          return currId === searchId || Number(currId) === Number(searchId);
        });
        return currency ? currency.name : '(empty)';
      };

      keyFields.forEach(field => {
        const oldVal = oldRecord[field];
        const newVal = newRecord[field];

        // Normalize values for comparison (handle type mismatches, null/undefined, empty strings, empty arrays)
        const normalizeValue = (val: any): any => {
          if (val === null || val === undefined || val === '') return null;

          // Handle arrays - empty arrays are considered null
          if (Array.isArray(val)) {
            if (val.length === 0) return null;
            // For non-empty arrays, return the array for comparison
            return val;
          }

          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed === '' || trimmed === '---' || trimmed === '--' || trimmed === 'null' || trimmed === 'undefined') return null;
            return trimmed;
          }
          return val;
        };

        const normalizedOld = normalizeValue(oldVal);
        const normalizedNew = normalizeValue(newVal);

        // For arrays, do deep comparison
        let hasChanged = false;
        if (Array.isArray(normalizedOld) && Array.isArray(normalizedNew)) {
          // Both are arrays - compare lengths and content
          if (normalizedOld.length !== normalizedNew.length) {
            hasChanged = true;
          } else {
            // Same length - check if content is different
            // For arrays, we'll let the specific field handlers (like manual_interactions) handle the comparison
            // For now, if both arrays have the same length and are non-empty, consider them potentially changed
            // But if both are empty (normalized to null), they're the same
            hasChanged = false; // Will be handled by specific field logic
          }
        } else {
          // Standard comparison for non-arrays
          hasChanged = normalizedOld !== normalizedNew ||
            String(normalizedOld) !== String(normalizedNew) ||
            (normalizedOld == null && normalizedNew != null) ||
            (normalizedOld != null && normalizedNew == null);
        }

        // Skip if both normalized values are null (empty arrays, null, undefined, etc.)
        if (normalizedOld === null && normalizedNew === null) {
          hasChanged = false;
        }

        // Debug: Log field comparison
        if (hasChanged) {
          console.log(`🔍 [detectChanges Lead] Field "${field}" changed:`, {
            oldVal,
            newVal,
            normalizedOld,
            normalizedNew,
            fieldName: getFieldDisplayName(field)
          });
        }

        if (hasChanged) {
          const fieldName = getFieldDisplayName(field);

          if (field === 'stage') {
            // Store stage IDs for badge rendering
            const oldStageId = oldVal !== null && oldVal !== undefined && oldVal !== '' ? String(oldVal) : null;
            const newStageId = newVal !== null && newVal !== undefined && newVal !== '' ? String(newVal) : null;
            // Return structured data for stage changes
            changes.push(JSON.stringify({
              type: 'stage',
              field: fieldName.toLowerCase(),
              oldStageId,
              newStageId,
              oldStageName: oldStageId ? getStageName(oldStageId) : 'No Stage',
              newStageName: newStageId ? getStageName(newStageId) : 'No Stage'
            }));
          } else if (field === 'category_id') {
            // Map category_id to category name
            const oldCategoryName = getCategoryName(oldVal);
            const newCategoryName = getCategoryName(newVal);
            if (oldCategoryName !== newCategoryName) {
              changes.push(`changed ${fieldName.toLowerCase()} from ${oldCategoryName} to ${newCategoryName}`);
            }
          } else if (field === 'currency_id') {
            // Map currency_id to currency name
            const oldCurrencyName = getCurrencyName(oldVal);
            const newCurrencyName = getCurrencyName(newVal);
            if (oldCurrencyName !== newCurrencyName) {
              changes.push(`changed ${fieldName.toLowerCase()} from ${oldCurrencyName} to ${newCurrencyName}`);
            }
          } else if (employeeFields.includes(field)) {
            const oldEmp = getEmployeeNameFromId(oldVal);
            const newEmp = getEmployeeNameFromId(newVal);
            // Only show if there's an actual change (not both "Unassigned")
            if (oldEmp !== newEmp) {
              changes.push(`changed ${fieldName.toLowerCase()} from "${oldEmp}" to "${newEmp}"`);
            }
          } else if (numericFields.includes(field) || field === 'balance' || field === 'proposal_total' || field === 'total' || field === 'total_base' || field === 'vat_value' || field === 'meeting_amount') {
            // Handle numeric fields - convert to numbers, but skip if both are NaN or invalid
            const oldNum = oldVal != null && oldVal !== '' && oldVal !== '---' && oldVal !== '--' ? Number(oldVal) : null;
            const newNum = newVal != null && newVal !== '' && newVal !== '---' && newVal !== '--' ? Number(newVal) : null;

            // Skip if both are null/undefined/invalid (no meaningful change)
            if (oldNum === null && newNum === null) {
              // Skip this change - both values are empty/invalid
            } else if (isNaN(Number(oldNum)) && isNaN(Number(newNum))) {
              // Skip this change - both values are NaN
            } else if (oldNum !== newNum) {
              // Only show if there's a meaningful change
              const oldDisplay = oldNum != null && !isNaN(Number(oldNum)) ? oldNum : '(empty)';
              const newDisplay = newNum != null && !isNaN(Number(newNum)) ? newNum : '(empty)';
              // Skip if both display as "(empty)" - not meaningful
              if (oldDisplay !== '(empty)' || newDisplay !== '(empty)') {
                changes.push(`changed ${fieldName.toLowerCase()} from ${oldDisplay} to ${newDisplay}`);
              }
            }
          } else if (field === 'special_notes') {
            // Handle special_notes separately - show the actual text
            const oldText = oldVal ? String(oldVal).trim() : '';
            const newText = newVal ? String(newVal).trim() : '';
            if (oldText !== newText) {
              if (newText && newText !== '' && newText !== '---' && newText !== '--') {
                const strippedText = stripHtmlTags(newText);
                const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
                changes.push(`updated special note: ${displayText}`);
              } else if (oldText && oldText !== '' && oldText !== '---' && oldText !== '--') {
                changes.push('removed special note');
              }
            }
          } else if (field === 'general_notes') {
            // Handle general_notes separately - show the actual text
            const oldText = oldVal ? String(oldVal).trim() : '';
            const newText = newVal ? String(newVal).trim() : '';
            if (oldText !== newText) {
              if (newText && newText !== '' && newText !== '---' && newText !== '--') {
                const strippedText = stripHtmlTags(newText);
                const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
                changes.push(`updated general note: ${displayText}`);
              } else if (oldText && oldText !== '' && oldText !== '---' && oldText !== '--') {
                changes.push('removed general note');
              }
            }
          } else if (field === 'tags') {
            // Handle tags separately - show the actual tags
            const oldTags = oldVal ? String(oldVal).trim() : '';
            const newTags = newVal ? String(newVal).trim() : '';
            if (oldTags !== newTags) {
              if (newTags && newTags !== '' && newTags !== '---' && newTags !== '--') {
                const displayText = newTags.length > 100 ? newTags.substring(0, 100) + '...' : newTags;
                if (oldTags && oldTags !== '' && oldTags !== '---' && oldTags !== '--') {
                  changes.push(`updated tags from "${oldTags.length > 50 ? oldTags.substring(0, 50) + '...' : oldTags}" to "${displayText}"`);
                } else {
                  changes.push(`updated tags: ${displayText}`);
                }
              } else if (oldTags && oldTags !== '' && oldTags !== '---' && oldTags !== '--') {
                changes.push('removed tags');
              }
            }
          } else if (field === 'eligibility_status') {
            // Handle eligibility_status separately
            const oldStatus = oldVal ? String(oldVal).trim() : '';
            const newStatus = newVal ? String(newVal).trim() : '';
            if (oldStatus !== newStatus) {
              if (newStatus && newStatus !== '' && newStatus !== '---' && newStatus !== '--') {
                if (oldStatus && oldStatus !== '' && oldStatus !== '---' && oldStatus !== '--') {
                  changes.push(`updated eligibility status from "${oldStatus}" to "${newStatus}"`);
                } else {
                  changes.push(`updated eligibility status: ${newStatus}`);
                }
              } else if (oldStatus && oldStatus !== '' && oldStatus !== '---' && oldStatus !== '--') {
                changes.push('removed eligibility status');
              }
            }
          } else if (field === 'section_eligibility') {
            // Handle section_eligibility separately
            const oldSection = oldVal ? String(oldVal).trim() : '';
            const newSection = newVal ? String(newVal).trim() : '';
            if (oldSection !== newSection) {
              if (newSection && newSection !== '' && newSection !== '---' && newSection !== '--') {
                if (oldSection && oldSection !== '' && oldSection !== '---' && oldSection !== '--') {
                  changes.push(`updated section eligibility from "${oldSection}" to "${newSection}"`);
                } else {
                  changes.push(`updated section eligibility: ${newSection}`);
                }
              } else if (oldSection && oldSection !== '' && oldSection !== '---' && oldSection !== '--') {
                changes.push('removed section eligibility');
              }
            }
          } else if (field === 'expert_notes') {
            // Handle expert_notes (JSONB) separately - show the actual content
            const formatExpertNotes = (notes: any): string => {
              if (!notes) return '';
              if (typeof notes === 'string') {
                try {
                  const parsed = JSON.parse(notes);
                  if (Array.isArray(parsed)) {
                    return parsed.map((item: any) => {
                      if (typeof item === 'object' && item !== null) {
                        if (item.content || item.text || item.note) {
                          return item.content || item.text || item.note;
                        }
                        return JSON.stringify(item);
                      }
                      return String(item);
                    }).join('; ');
                  } else if (typeof parsed === 'object' && parsed !== null) {
                    if (parsed.content || parsed.text || parsed.note) {
                      return parsed.content || parsed.text || parsed.note;
                    }
                    return JSON.stringify(parsed);
                  }
                  return String(parsed);
                } catch (e) {
                  return notes;
                }
              }
              if (Array.isArray(notes)) {
                return notes.map((item: any) => {
                  if (typeof item === 'object' && item !== null) {
                    if (item.content || item.text || item.note) {
                      return item.content || item.text || item.note;
                    }
                    return JSON.stringify(item);
                  }
                  return String(item);
                }).join('; ');
              }
              if (typeof notes === 'object' && notes !== null) {
                if (notes.content || notes.text || notes.note) {
                  return notes.content || notes.text || notes.note;
                }
                return JSON.stringify(notes);
              }
              return String(notes);
            };

            const oldNotesText = formatExpertNotes(oldVal);
            const newNotesText = formatExpertNotes(newVal);
            if (oldNotesText !== newNotesText) {
              if (newNotesText && newNotesText !== '') {
                const strippedText = stripHtmlTags(newNotesText);
                const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
                changes.push(`updated expert notes: ${displayText}`);
              } else if (oldNotesText && oldNotesText !== '') {
                changes.push('removed expert notes');
              }
            }
          } else if (field === 'handler_notes') {
            // Handle handler_notes (JSONB) separately - show the actual content
            const formatHandlerNotes = (notes: any): string => {
              if (!notes) return '';
              if (typeof notes === 'string') {
                try {
                  const parsed = JSON.parse(notes);
                  if (Array.isArray(parsed)) {
                    return parsed.map((item: any) => {
                      if (typeof item === 'object' && item !== null) {
                        if (item.content || item.text || item.note) {
                          return item.content || item.text || item.note;
                        }
                        return JSON.stringify(item);
                      }
                      return String(item);
                    }).join('; ');
                  } else if (typeof parsed === 'object' && parsed !== null) {
                    if (parsed.content || parsed.text || parsed.note) {
                      return parsed.content || parsed.text || parsed.note;
                    }
                    return JSON.stringify(parsed);
                  }
                  return String(parsed);
                } catch (e) {
                  return notes;
                }
              }
              if (Array.isArray(notes)) {
                return notes.map((item: any) => {
                  if (typeof item === 'object' && item !== null) {
                    if (item.content || item.text || item.note) {
                      return item.content || item.text || item.note;
                    }
                    return JSON.stringify(item);
                  }
                  return String(item);
                }).join('; ');
              }
              if (typeof notes === 'object' && notes !== null) {
                if (notes.content || notes.text || notes.note) {
                  return notes.content || notes.text || notes.note;
                }
                return JSON.stringify(notes);
              }
              return String(notes);
            };

            const oldNotesText = formatHandlerNotes(oldVal);
            const newNotesText = formatHandlerNotes(newVal);
            if (oldNotesText !== newNotesText) {
              if (newNotesText && newNotesText !== '') {
                const strippedText = stripHtmlTags(newNotesText);
                const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
                changes.push(`updated handler notes: ${displayText}`);
              } else if (oldNotesText && oldNotesText !== '') {
                changes.push('removed handler notes');
              }
            }
          } else if (field === 'notes' || field === 'facts') {
            // For other notes fields, show that notes were updated
            if (!changes.some(c => c.includes('notes') || c.includes('facts'))) {
              changes.push(`updated ${fieldName.toLowerCase()}`);
            }
          } else if (field === 'manual_interactions') {
            // Handle manual_interactions array - show what was actually added/removed
            const formatInteraction = (interaction: any): string => {
              if (!interaction || typeof interaction !== 'object') {
                return '';
              }

              const parts: string[] = [];

              // Show date and time if available
              if (interaction.date || interaction.time) {
                const dateTime = [interaction.date, interaction.time].filter(Boolean).join(' ');
                if (dateTime) parts.push(dateTime);
              } else if (interaction.raw_date) {
                try {
                  const date = new Date(interaction.raw_date);
                  if (!isNaN(date.getTime())) {
                    parts.push(date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    }));
                  }
                } catch (e) {
                  // Ignore date parsing errors
                }
              }

              // Show employee if available
              if (interaction.employee) {
                parts.push(`by ${interaction.employee}`);
              }

              // Show kind/method if available
              if (interaction.kind) {
                parts.push(`(${interaction.kind})`);
              }

              // Show content if available (most important) - always include if present
              if (interaction.content && interaction.content.trim() !== '') {
                const content = interaction.content.trim();
                // Show more content (up to 100 chars) since this is the most important part
                const displayContent = content.length > 100
                  ? content.substring(0, 100) + '...'
                  : content;
                parts.push(`"${displayContent}"`);
              } else if (interaction.observation && interaction.observation.trim() !== '') {
                // Fallback to observation if content is not available
                const observation = interaction.observation.trim();
                const displayObservation = observation.length > 100
                  ? observation.substring(0, 100) + '...'
                  : observation;
                parts.push(`"${displayObservation}"`);
              }

              return parts.join(' ');
            };

            const oldInteractions = Array.isArray(oldVal) ? oldVal : [];
            const newInteractions = Array.isArray(newVal) ? newVal : [];

            // Helper to normalize interaction for comparison
            const normalizeInteractionKey = (int: any): string | null => {
              if (!int || typeof int !== 'object') return null;

              // Use ID as primary identifier if available
              if (int.id) return `id:${String(int.id)}`;

              // Normalize content - remove extra whitespace, lowercase
              const content = (int.content || '').trim().toLowerCase().replace(/\s+/g, ' ');

              // Normalize date - try multiple date fields and normalize format
              let date = '';
              if (int.raw_date) {
                date = String(int.raw_date).trim();
              } else if (int.date) {
                date = String(int.date).trim();
              } else if (int.created_at) {
                date = String(int.created_at).trim();
              }

              // Normalize employee name
              const employee = (int.employee || '').trim().toLowerCase();

              // Normalize kind/type
              const kind = (int.kind || int.type || '').trim().toLowerCase();

              // If we have content and date, use them as identifier
              if (content && date) {
                return `composite:${content}|${date}|${employee}|${kind}`;
              }

              // If we have content and employee, use them (date might be missing)
              if (content && employee) {
                return `composite:${content}|${employee}|${kind}`;
              }

              // Fallback: use JSON string (normalized)
              try {
                // Create a normalized version of the object for comparison
                const normalized = {
                  content: content,
                  date: date,
                  employee: employee,
                  kind: kind,
                  ...(int.id ? { id: int.id } : {})
                };
                return `json:${JSON.stringify(normalized)}`;
              } catch {
                return null;
              }
            };

            // Find what was added (in new but not in old)
            const addedInteractions = newInteractions.filter((newInt: any) => {
              const newKey = normalizeInteractionKey(newInt);
              if (!newKey) return true; // If we can't normalize, treat as new

              // Check if this interaction exists in old array
              const existsInOld = oldInteractions.some((oldInt: any) => {
                const oldKey = normalizeInteractionKey(oldInt);
                if (!oldKey) return false;

                // Exact match
                if (oldKey === newKey) return true;

                // Also check if they're the same by ID (if both have IDs)
                if (newInt.id && oldInt.id && String(newInt.id) === String(oldInt.id)) {
                  return true;
                }

                return false;
              });

              return !existsInOld;
            });

            // Find what was removed (in old but not in new)
            const removedInteractions = oldInteractions.filter((oldInt: any) => {
              const oldKey = normalizeInteractionKey(oldInt);
              if (!oldKey) return false;

              const existsInNew = newInteractions.some((newInt: any) => {
                const newKey = normalizeInteractionKey(newInt);
                if (!newKey) return false;

                // Exact match
                if (oldKey === newKey) return true;

                // Also check if they're the same by ID (if both have IDs)
                if (oldInt.id && newInt.id && String(oldInt.id) === String(newInt.id)) {
                  return true;
                }

                return false;
              });

              return !existsInNew;
            });

            // Format texts for comparison to detect duplicates
            const addedTexts = addedInteractions.map(formatInteraction).filter(Boolean);
            const removedTexts = removedInteractions.map(formatInteraction).filter(Boolean);

            // Helper to normalize text for comparison
            const normalizeText = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

            // Filter out interactions that appear in both added and removed (same formatted text)
            // If an interaction appears in both, keep it in "added" and remove it from "removed"
            // This prevents showing the same interaction as both added and removed
            const removedTextsFiltered = removedTexts.filter(removedText => {
              // Check if this exact text appears in added texts
              const normalizedRemoved = normalizeText(removedText);
              return !addedTexts.some(addedText => {
                const normalizedAdded = normalizeText(addedText);
                return normalizedAdded === normalizedRemoved;
              });
            });

            // Keep all added texts (don't filter them out even if they match removed)
            // This ensures we still show interactions that were added, even if they were incorrectly detected as removed
            const addedTextsFiltered = addedTexts;

            if (addedTextsFiltered.length > 0) {
              if (addedTextsFiltered.length === 1) {
                changes.push(`added interaction: ${addedTextsFiltered[0]}`);
              } else {
                changes.push(`added ${addedTextsFiltered.length} interactions: ${addedTextsFiltered.join('; ')}`);
              }
            } else if (addedInteractions.length > 0 && addedTexts.length === 0) {
              // If we have added interactions but no formatted texts, show count
              changes.push(`added ${addedInteractions.length} interaction${addedInteractions.length !== 1 ? 's' : ''}`);
            }

            if (removedTextsFiltered.length > 0) {
              if (removedTextsFiltered.length === 1) {
                changes.push(`removed interaction: ${removedTextsFiltered[0]}`);
              } else {
                changes.push(`removed ${removedTextsFiltered.length} interactions: ${removedTextsFiltered.join('; ')}`);
              }
            } else if (removedInteractions.length > 0 && removedTexts.length === 0) {
              // If we have removed interactions but no formatted texts, show count
              changes.push(`removed ${removedInteractions.length} interaction${removedInteractions.length !== 1 ? 's' : ''}`);
            }

            // If no additions or removals detected, fall back to count comparison
            if (addedInteractions.length === 0 && removedInteractions.length === 0) {
              const oldCount = oldInteractions.length;
              const newCount = newInteractions.length;
              if (oldCount !== newCount) {
                changes.push(`changed ${fieldName.toLowerCase()} from ${oldCount} interaction${oldCount !== 1 ? 's' : ''} to ${newCount} interaction${newCount !== 1 ? 's' : ''}`);
              }
            }
          } else if (field === 'latest_interaction') {
            // Skip latest_interaction changes if manual_interactions also changed (interaction was added/removed)
            // This prevents showing redundant "changed latest interaction" when an interaction is added
            const oldInteractions = Array.isArray(oldRecord.manual_interactions) ? oldRecord.manual_interactions : [];
            const newInteractions = Array.isArray(newRecord.manual_interactions) ? newRecord.manual_interactions : [];

            // Check if interactions were added or removed
            const hasInteractionChanges = oldInteractions.length !== newInteractions.length ||
              oldInteractions.some((oldInt: any) => {
                if (!oldInt || !oldInt.id) return false;
                return !newInteractions.some((newInt: any) => newInt && newInt.id === oldInt.id);
              }) ||
              newInteractions.some((newInt: any) => {
                if (!newInt || !newInt.id) return false;
                return !oldInteractions.some((oldInt: any) => oldInt && oldInt.id === newInt.id);
              });

            // If interactions were added/removed, skip showing latest_interaction change
            if (!hasInteractionChanges) {
              // Handle latest_interaction - format as date (only if no interaction changes)
              const formatLatestInteraction = (val: any): string => {
                if (!val || val === null || val === undefined) {
                  return '(empty)';
                }

                if (typeof val === 'string') {
                  if (val.trim() === '' || val === '---' || val === '--') {
                    return '(empty)';
                  }
                  // Try to parse as date and format
                  try {
                    const date = new Date(val);
                    if (!isNaN(date.getTime())) {
                      return date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      });
                    }
                  } catch (e) {
                    // Not a valid date, return as-is
                  }
                  return val.length > 30 ? val.substring(0, 30) + '...' : val;
                }

                return String(val);
              };

              const oldDisplay = formatLatestInteraction(oldVal);
              const newDisplay = formatLatestInteraction(newVal);

              // Skip changes from (empty) to (empty) - not meaningful
              if (oldDisplay !== '(empty)' || newDisplay !== '(empty)') {
                changes.push(`changed ${fieldName.toLowerCase()} from "${oldDisplay}" to "${newDisplay}"`);
              }
            }
            // If hasInteractionChanges is true, we skip adding the latest_interaction change
          } else if (field === 'unactivated_at' || field === 'unactivated_by' || field === 'unactivation_reason' || field === 'deactivate_notes') {
            // Handle unactivation fields specially - don't add as individual changes
            // They will be consolidated in createDescription
            // But filter out micro-updates to unactivated_at (millisecond differences)
            if (field === 'unactivated_at') {
              // If both old and new are timestamps, check if the difference is just milliseconds
              if (oldVal && newVal && typeof oldVal === 'string' && typeof newVal === 'string') {
                try {
                  const oldDate = new Date(oldVal);
                  const newDate = new Date(newVal);
                  if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
                    // If the difference is less than 1 second (1000ms), ignore it
                    const diffMs = Math.abs(newDate.getTime() - oldDate.getTime());
                    if (diffMs < 1000) {
                      // This is just a micro-update, skip it
                      console.log('🔍 [detectChanges] Skipping micro-update to unactivated_at:', {
                        oldVal,
                        newVal,
                        diffMs
                      });
                      // Don't add this change
                    } else {
                      // This is a real change, but we'll handle it in createDescription
                      // Don't add it as an individual change here
                    }
                  }
                } catch (e) {
                  // If date parsing fails, treat as normal change (but still don't add individually)
                }
              } else if (!oldVal && newVal) {
                // This is a new unactivation (null to value) - will be handled in createDescription
                // Don't add as individual change
              }
            }
            // For all unactivation fields, don't add individual changes - they'll be consolidated
          } else {
            // Clean up values - remove "---", "#", etc.
            const cleanValue = (val: any): string => {
              if (!val || val === '---' || val === '--' || val === null || val === undefined) {
                return '(empty)';
              }

              // Handle arrays
              if (Array.isArray(val)) {
                if (val.length === 0) {
                  return '(empty)';
                }
                // Try to format array items
                try {
                  const items = val.map((item: any) => {
                    if (typeof item === 'object' && item !== null) {
                      // If it's an object, try to extract meaningful info
                      if (item.date || item.time || item.employee || item.content) {
                        const parts: string[] = [];
                        if (item.date) parts.push(item.date);
                        if (item.time) parts.push(item.time);
                        if (item.employee) parts.push(`by ${item.employee}`);
                        return parts.join(' ');
                      }
                      return JSON.stringify(item).substring(0, 30);
                    }
                    return String(item);
                  });
                  return `[${items.join(', ')}]`;
                } catch (e) {
                  return `${val.length} item${val.length !== 1 ? 's' : ''}`;
                }
              }

              // Handle objects
              if (typeof val === 'object' && val !== null) {
                try {
                  const str = JSON.stringify(val);
                  return str.length > 50 ? str.substring(0, 50) + '...' : str;
                } catch (e) {
                  return '(object)';
                }
              }

              let cleaned = String(val).trim();
              // Remove "#" if it's at the start
              if (cleaned.startsWith('#')) {
                cleaned = cleaned.substring(1).trim();
              }
              // Remove "---" or "--" if present
              cleaned = cleaned.replace(/^---+$/, '').replace(/^--+$/, '').trim();
              if (!cleaned || cleaned === '') {
                return '(empty)';
              }
              return cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
            };
            const oldDisplay = cleanValue(oldVal);
            const newDisplay = cleanValue(newVal);
            // Skip changes from (empty) to (empty) - not meaningful
            if (oldDisplay !== '(empty)' || newDisplay !== '(empty)') {
              changes.push(`changed ${fieldName.toLowerCase()} from "${oldDisplay}" to "${newDisplay}"`);
            }
          }
        }
      });
    }

    // Key fields for meetings - only show fields that actually changed
    if (tableType === 'meeting') {
      const keyFields = ['meeting_date', 'meeting_time', 'meeting_location', 'meeting_manager',
        'meeting_amount', 'status', 'attendance_probability', 'complexity'];
      keyFields.forEach(field => {
        const oldVal = oldRecord[field];
        const newVal = newRecord[field];
        if (oldVal !== newVal) {
          const fieldName = getFieldDisplayName(field);
          if (oldVal == null && newVal != null) {
            changes.push(`set ${fieldName.toLowerCase()} to "${newVal}"`);
          } else if (oldVal != null && newVal == null) {
            changes.push(`removed ${fieldName.toLowerCase()}`);
          } else {
            changes.push(`changed ${fieldName.toLowerCase()} from "${oldVal}" to "${newVal}"`);
          }
        }
      });
    }

    // Key fields for payments - only show fields that actually changed
    if (tableType === 'payment') {
      const keyFields = ['value', 'due_date', 'paid', 'ready_to_pay', 'payment_order', 'notes'];
      console.log('🔍 [detectChanges Payment] Checking keyFields:', keyFields);

      keyFields.forEach(field => {
        const oldVal = oldRecord[field];
        const newVal = newRecord[field];

        // Normalize values for comparison
        const normalizeValue = (val: any): any => {
          if (val === null || val === undefined || val === '') return null;
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed === '' || trimmed === '---' || trimmed === '--' || trimmed === 'null' || trimmed === 'undefined') return null;
            return trimmed;
          }
          return val;
        };

        const normalizedOld = normalizeValue(oldVal);
        const normalizedNew = normalizeValue(newVal);
        const hasChanged = normalizedOld !== normalizedNew ||
          String(normalizedOld) !== String(normalizedNew) ||
          (normalizedOld == null && normalizedNew != null) ||
          (normalizedOld != null && normalizedNew == null);

        if (tableType === 'payment') {
          console.log(`🔍 [detectChanges Payment] Field ${field}:`, {
            oldVal,
            newVal,
            normalizedOld,
            normalizedNew,
            hasChanged
          });
        }

        if (hasChanged) {
          const fieldName = getFieldDisplayName(field);
          if (field === 'paid' || field === 'ready_to_pay') {
            changes.push(`${newVal ? 'marked' : 'unmarked'} ${fieldName.toLowerCase()}`);
          } else if (normalizedOld == null && normalizedNew != null) {
            changes.push(`set ${fieldName.toLowerCase()} to "${newVal}"`);
          } else if (normalizedOld != null && normalizedNew == null) {
            changes.push(`removed ${fieldName.toLowerCase()}`);
          } else {
            changes.push(`changed ${fieldName.toLowerCase()} from "${oldVal || '(empty)'}" to "${newVal || '(empty)'}"`);
          }
        }
      });

      console.log('🔍 [detectChanges Payment] Total changes detected:', changes.length, changes);
    }

    // Filter out any changes that contain "NaN" (meaningless changes)
    const filteredChanges = changes.filter(change => {
      // Skip changes that contain "NaN" (e.g., "changed status from NaN to NaN")
      if (change.includes('NaN')) {
        return false;
      }
      // Skip changes that show "(empty) to (empty)" for numeric fields
      if (change.includes('(empty) to (empty)')) {
        return false;
      }
      return true;
    });

    // Debug: Log all detected changes
    console.log('🔍 [detectChanges] Final changes:', {
      tableType,
      totalChanges: filteredChanges.length,
      changes: filteredChanges,
      rawChanges: changes
    });

    return filteredChanges;
  };

  // Create user-friendly description for a history entry
  const createDescription = (entry: any, prevEntry: any | null, tableType: 'lead' | 'meeting' | 'payment', contactName?: string, employeesList: any[] = allEmployees): { description: string; descriptionBold: string; descriptionText: string; changeDetails: string[] } => {
    const changes = detectChanges(prevEntry, entry, tableType, employeesList);

    if (entry.change_type === 'insert') {
      if (tableType === 'lead') {
        return {
          description: 'Created this lead',
          descriptionBold: 'Created this lead',
          descriptionText: '',
          changeDetails: []
        };
      } else if (tableType === 'meeting') {
        // Build meeting details string
        const meetingDetails: string[] = [];

        if (entry.meeting_date) {
          try {
            const date = new Date(entry.meeting_date);
            const formattedDate = date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
            meetingDetails.push(formattedDate);
          } catch (e) {
            meetingDetails.push(entry.meeting_date);
          }
        }

        if (entry.meeting_time) {
          // Remove seconds from time format (HH:MM:SS -> HH:MM)
          let formattedTime = entry.meeting_time;
          if (typeof formattedTime === 'string' && formattedTime.includes(':')) {
            const timeParts = formattedTime.split(':');
            if (timeParts.length >= 2) {
              formattedTime = `${timeParts[0]}:${timeParts[1]}`;
            }
          }
          meetingDetails.push(formattedTime);
        }

        if (entry.meeting_location) {
          meetingDetails.push(`at ${entry.meeting_location}`);
        }

        const detailsText = meetingDetails.length > 0 ? ` (${meetingDetails.join(', ')})` : '';

        return {
          description: `Scheduled a new meeting${detailsText}`,
          descriptionBold: 'Scheduled a new meeting',
          descriptionText: detailsText,
          changeDetails: []
        };
      } else if (tableType === 'payment') {
        const contactText = contactName ? ` for contact ${contactName}` : '';
        return {
          description: `Created new payment plan${contactText}`,
          descriptionBold: 'Created new payment plan',
          descriptionText: contactText,
          changeDetails: []
        };
      }
    }

    if (entry.change_type === 'delete') {
      if (tableType === 'lead') {
        return {
          description: 'Deleted this lead',
          descriptionBold: 'Deleted this lead',
          descriptionText: '',
          changeDetails: []
        };
      } else if (tableType === 'meeting') {
        return {
          description: 'Cancelled a meeting',
          descriptionBold: 'Cancelled a meeting',
          descriptionText: '',
          changeDetails: []
        };
      } else if (tableType === 'payment') {
        const contactText = contactName ? ` for contact ${contactName}` : '';
        return {
          description: `Deleted payment plan${contactText}`,
          descriptionBold: 'Deleted payment plan',
          descriptionText: contactText,
          changeDetails: []
        };
      }
    }

    if (entry.change_type === 'update') {
      // Check if there's a stage change - if so, only show that and disregard other changes
      const stageChange = changes.find(c => {
        try {
          const parsed = JSON.parse(c);
          return parsed.type === 'stage';
        } catch (e) {
          return false;
        }
      });

      if (stageChange) {
        // Only show the stage change, disregard all other changes (including timestamp changes)
        try {
          const parsed = JSON.parse(stageChange);
          console.log('🔍 [createDescription] Stage change detected, prioritizing over other changes:', {
            oldStageId: parsed.oldStageId,
            newStageId: parsed.newStageId,
            oldStageName: parsed.oldStageName,
            newStageName: parsed.newStageName,
            totalChanges: changes.length,
            otherChanges: changes.filter(c => {
              try {
                const p = JSON.parse(c);
                return p.type !== 'stage';
              } catch {
                return true;
              }
            })
          });
          return {
            description: `changed stage from ${parsed.oldStageName} to ${parsed.newStageName}`,
            descriptionBold: '',
            descriptionText: `changed stage from ${parsed.oldStageName} to ${parsed.newStageName}`,
            changeDetails: [stageChange] // Store for badge rendering - only the stage change
          };
        } catch (e) {
          console.error('🔍 [createDescription] Error parsing stage change:', e);
          // Fallback if parsing fails
        }
      }

      // Check if special_notes or general_notes were updated
      const specialNotesUpdated = entry.special_notes !== prevEntry?.special_notes;
      const generalNotesUpdated = entry.general_notes !== prevEntry?.general_notes;
      const notesUpdated = specialNotesUpdated || generalNotesUpdated;

      // Check if unactivation fields changed
      // Filter out micro-updates to unactivated_at (millisecond differences)
      const unactivationFields = ['unactivated_at', 'unactivated_by', 'unactivation_reason', 'deactivate_notes'];
      const hasUnactivationChanges = unactivationFields.some(field => {
        const oldVal = prevEntry?.[field];
        const newVal = entry[field];

        // For unactivated_at, filter out micro-updates (millisecond differences)
        if (field === 'unactivated_at' && oldVal && newVal) {
          try {
            const oldDate = new Date(oldVal);
            const newDate = new Date(newVal);
            if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
              const diffMs = Math.abs(newDate.getTime() - oldDate.getTime());
              // If difference is less than 1 second, ignore it (micro-update)
              if (diffMs < 1000) {
                return false;
              }
            }
          } catch (e) {
            // If date parsing fails, treat as normal change
          }
        }

        return oldVal !== newVal;
      });

      // Format unactivation message if unactivation fields changed
      let unactivationMessage = '';
      if (hasUnactivationChanges && tableType === 'lead') {
        const unactivationParts: string[] = [];

        if (entry.unactivated_at) {
          try {
            const date = new Date(entry.unactivated_at);
            const formattedDate = date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            unactivationParts.push(`at ${formattedDate}`);
          } catch (e) {
            unactivationParts.push(`at ${entry.unactivated_at}`);
          }
        }

        if (entry.unactivation_reason) {
          const reason = entry.unactivation_reason.trim();
          if (reason && reason !== '' && reason !== '---' && reason !== '--') {
            unactivationParts.push(`reason ${reason}`);
          }
        }

        // Include deactivate_notes if present
        if (entry.deactivate_notes) {
          const notes = String(entry.deactivate_notes).trim();
          if (notes && notes !== '' && notes !== '---' && notes !== '--') {
            const strippedNotes = stripHtmlTags(notes);
            const displayNotes = strippedNotes.length > 100 ? strippedNotes.substring(0, 100) + '...' : strippedNotes;
            unactivationParts.push(`notes: ${displayNotes}`);
          }
        }

        if (unactivationParts.length > 0) {
          unactivationMessage = `unactivated ${unactivationParts.join(' and ')}`;
        }
      }

      // Check for individual field updates - handle each separately
      const tagsUpdated = entry.tags !== prevEntry?.tags;
      const eligibilityStatusUpdated = entry.eligibility_status !== prevEntry?.eligibility_status;
      const sectionEligibilityUpdated = entry.section_eligibility !== prevEntry?.section_eligibility;
      const expertNotesUpdated = entry.expert_notes !== prevEntry?.expert_notes;
      const handlerNotesUpdated = entry.handler_notes !== prevEntry?.handler_notes;

      // Helper to format JSONB notes
      const formatNotesContent = (notes: any): string => {
        if (!notes) return '';
        if (typeof notes === 'string') {
          try {
            const parsed = JSON.parse(notes);
            if (Array.isArray(parsed)) {
              return parsed.map((item: any) => {
                if (typeof item === 'object' && item !== null) {
                  const content = item.content || item.text || item.note || '';
                  return content ? stripHtmlTags(String(content)) : JSON.stringify(item);
                }
                return stripHtmlTags(String(item));
              }).join('; ');
            } else if (typeof parsed === 'object' && parsed !== null) {
              const content = parsed.content || parsed.text || parsed.note || '';
              return content ? stripHtmlTags(String(content)) : JSON.stringify(parsed);
            }
            return stripHtmlTags(String(parsed));
          } catch (e) {
            return stripHtmlTags(notes);
          }
        }
        if (Array.isArray(notes)) {
          return notes.map((item: any) => {
            if (typeof item === 'object' && item !== null) {
              const content = item.content || item.text || item.note || '';
              return content ? stripHtmlTags(String(content)) : JSON.stringify(item);
            }
            return stripHtmlTags(String(item));
          }).join('; ');
        }
        if (typeof notes === 'object' && notes !== null) {
          const content = notes.content || notes.text || notes.note || '';
          return content ? stripHtmlTags(String(content)) : JSON.stringify(notes);
        }
        return stripHtmlTags(String(notes));
      };

      // Handle special_notes separately
      if (specialNotesUpdated && tableType === 'lead') {
        const notesText = entry.special_notes ? String(entry.special_notes).trim() : '';
        if (notesText && notesText !== '' && notesText !== '---' && notesText !== '--') {
          const strippedText = stripHtmlTags(notesText);
          const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
          const filteredChanges = changes.filter(c =>
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('eligibility status') &&
            !c.includes('section eligibility') &&
            !c.includes('expert notes') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          return {
            description: `updated special note: ${displayText}`,
            descriptionBold: 'updated special note:',
            descriptionText: displayText,
            changeDetails: filteredChanges
          };
        }
      }

      // Handle general_notes separately
      if (generalNotesUpdated && tableType === 'lead') {
        const notesText = entry.general_notes ? String(entry.general_notes).trim() : '';
        if (notesText && notesText !== '' && notesText !== '---' && notesText !== '--') {
          const strippedText = stripHtmlTags(notesText);
          const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
          const filteredChanges = changes.filter(c =>
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('eligibility status') &&
            !c.includes('section eligibility') &&
            !c.includes('expert notes') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          return {
            description: `updated general note: ${displayText}`,
            descriptionBold: 'updated general note:',
            descriptionText: displayText,
            changeDetails: filteredChanges
          };
        }
      }

      // Handle tags separately
      if (tagsUpdated && tableType === 'lead') {
        const tagsText = entry.tags ? String(entry.tags).trim() : '';
        if (tagsText && tagsText !== '' && tagsText !== '---' && tagsText !== '--') {
          const displayText = tagsText.length > 100 ? tagsText.substring(0, 100) + '...' : tagsText;
          const oldTags = prevEntry?.tags ? String(prevEntry.tags).trim() : '';
          const filteredChanges = changes.filter(c =>
            !c.includes('tags') &&
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('eligibility status') &&
            !c.includes('section eligibility') &&
            !c.includes('expert notes') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          if (oldTags && oldTags !== '' && oldTags !== '---' && oldTags !== '--') {
            const oldDisplay = oldTags.length > 50 ? oldTags.substring(0, 50) + '...' : oldTags;
            return {
              description: `updated tags from "${oldDisplay}" to "${displayText}"`,
              descriptionBold: 'updated tags',
              descriptionText: `from "${oldDisplay}" to "${displayText}"`,
              changeDetails: filteredChanges
            };
          } else {
            return {
              description: `updated tags: ${displayText}`,
              descriptionBold: 'updated tags:',
              descriptionText: displayText,
              changeDetails: filteredChanges
            };
          }
        }
      }

      // Handle eligibility_status separately
      if (eligibilityStatusUpdated && tableType === 'lead') {
        const statusText = entry.eligibility_status ? String(entry.eligibility_status).trim() : '';
        if (statusText && statusText !== '' && statusText !== '---' && statusText !== '--') {
          const oldStatus = prevEntry?.eligibility_status ? String(prevEntry.eligibility_status).trim() : '';
          const filteredChanges = changes.filter(c =>
            !c.includes('eligibility status') &&
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('section eligibility') &&
            !c.includes('expert notes') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          if (oldStatus && oldStatus !== '' && oldStatus !== '---' && oldStatus !== '--') {
            return {
              description: `updated eligibility status from "${oldStatus}" to "${statusText}"`,
              descriptionBold: 'updated eligibility status',
              descriptionText: `from "${oldStatus}" to "${statusText}"`,
              changeDetails: filteredChanges
            };
          } else {
            return {
              description: `updated eligibility status: ${statusText}`,
              descriptionBold: 'updated eligibility status:',
              descriptionText: statusText,
              changeDetails: filteredChanges
            };
          }
        }
      }

      // Handle section_eligibility separately
      if (sectionEligibilityUpdated && tableType === 'lead') {
        const sectionText = entry.section_eligibility ? String(entry.section_eligibility).trim() : '';
        if (sectionText && sectionText !== '' && sectionText !== '---' && sectionText !== '--') {
          const oldSection = prevEntry?.section_eligibility ? String(prevEntry.section_eligibility).trim() : '';
          const filteredChanges = changes.filter(c =>
            !c.includes('section eligibility') &&
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('eligibility status') &&
            !c.includes('expert notes') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          if (oldSection && oldSection !== '' && oldSection !== '---' && oldSection !== '--') {
            return {
              description: `updated section eligibility from "${oldSection}" to "${sectionText}"`,
              descriptionBold: 'updated section eligibility',
              descriptionText: `from "${oldSection}" to "${sectionText}"`,
              changeDetails: filteredChanges
            };
          } else {
            return {
              description: `updated section eligibility: ${sectionText}`,
              descriptionBold: 'updated section eligibility:',
              descriptionText: sectionText,
              changeDetails: filteredChanges
            };
          }
        }
      }

      // Handle expert_notes separately
      if (expertNotesUpdated && tableType === 'lead') {
        const notesContent = formatNotesContent(entry.expert_notes);
        if (notesContent && notesContent !== '') {
          const strippedText = stripHtmlTags(notesContent);
          const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
          const filteredChanges = changes.filter(c =>
            !c.includes('expert notes') &&
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('eligibility status') &&
            !c.includes('section eligibility') &&
            !c.includes('handler notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          return {
            description: `updated expert notes: ${displayText}`,
            descriptionBold: 'updated expert notes:',
            descriptionText: displayText,
            changeDetails: filteredChanges
          };
        }
      }

      // Handle handler_notes separately
      if (handlerNotesUpdated && tableType === 'lead') {
        const notesContent = formatNotesContent(entry.handler_notes);
        if (notesContent && notesContent !== '') {
          const strippedText = stripHtmlTags(notesContent);
          const displayText = strippedText.length > 200 ? strippedText.substring(0, 200) + '...' : strippedText;
          const filteredChanges = changes.filter(c =>
            !c.includes('handler notes') &&
            !c.includes('special note') &&
            !c.includes('general note') &&
            !c.includes('tags') &&
            !c.includes('eligibility status') &&
            !c.includes('section eligibility') &&
            !c.includes('expert notes') &&
            !c.includes('interaction') &&
            !c.toLowerCase().includes('unactivated') &&
            !c.toLowerCase().includes('unactivation')
          );

          return {
            description: `updated handler notes: ${displayText}`,
            descriptionBold: 'updated handler notes:',
            descriptionText: displayText,
            changeDetails: filteredChanges
          };
        }
      }

      // If unactivation fields changed (with or without other changes), show unactivation message
      if (hasUnactivationChanges && tableType === 'lead') {
        // Filter out unactivation-related changes from the changes array
        const otherChanges = changes.filter(c =>
          !c.toLowerCase().includes('unactivated') &&
          !c.toLowerCase().includes('unactivation')
        );

        if (unactivationMessage) {
          // If there are other changes, show unactivation message in changeDetails
          if (otherChanges.length > 0) {
            return {
              description: `Updated ${otherChanges.length + 1} field${otherChanges.length > 0 ? 's' : ''}`,
              descriptionBold: `Updated ${otherChanges.length + 1} field${otherChanges.length > 0 ? 's' : ''}`,
              descriptionText: '',
              changeDetails: [unactivationMessage, ...otherChanges]
            };
          } else {
            // If only unactivation changed, show it as the main description
            return {
              description: unactivationMessage,
              descriptionBold: '',
              descriptionText: unactivationMessage,
              changeDetails: []
            };
          }
        }
      }

      // For payment updates without prevEntry, show current payment plan details
      if (tableType === 'payment' && !prevEntry && changes.length === 0) {
        const paymentDetails: string[] = [];

        if (entry.value != null && entry.value !== '') {
          paymentDetails.push(`Amount: ${entry.value}`);
        }
        if (entry.due_date) {
          try {
            const date = new Date(entry.due_date);
            const formattedDate = date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
            paymentDetails.push(`Due: ${formattedDate}`);
          } catch (e) {
            paymentDetails.push(`Due: ${entry.due_date}`);
          }
        }
        if (entry.paid !== null && entry.paid !== undefined) {
          paymentDetails.push(`Paid: ${entry.paid ? 'Yes' : 'No'}`);
        }
        if (entry.ready_to_pay !== null && entry.ready_to_pay !== undefined) {
          paymentDetails.push(`Ready to Pay: ${entry.ready_to_pay ? 'Yes' : 'No'}`);
        }
        if (entry.payment_order != null && entry.payment_order !== '') {
          paymentDetails.push(`Order: ${entry.payment_order}`);
        }
        if (entry.notes && entry.notes.trim() !== '') {
          const notesPreview = entry.notes.length > 50 ? entry.notes.substring(0, 50) + '...' : entry.notes;
          paymentDetails.push(`Notes: ${notesPreview}`);
        }

        const detailsText = paymentDetails.length > 0 ? ` (${paymentDetails.join(', ')})` : '';
        const contactText = contactName ? ` for contact ${contactName}` : '';

        return {
          description: `Updated payment plan${contactText}${detailsText}`,
          descriptionBold: 'Updated payment plan',
          descriptionText: contactText + detailsText,
          changeDetails: []
        };
      }

      // For other updates, show the changes
      // Filter out unactivation-related changes and replace with consolidated message
      const otherChanges = changes.filter(c => {
        // Filter out individual unactivation field changes
        const lowerC = c.toLowerCase();
        return !lowerC.includes('unactivated') &&
          !lowerC.includes('unactivation') &&
          !lowerC.includes('deactivate notes') &&
          !lowerC.includes('deactivate_notes');
      });

      // Combine unactivation message with other changes if present
      const allChanges = [];
      if (unactivationMessage) {
        allChanges.push(unactivationMessage);
      }
      allChanges.push(...otherChanges);

      if (allChanges.length === 0) {
        return {
          description: 'Updated this record',
          descriptionBold: 'Updated this record',
          descriptionText: '',
          changeDetails: []
        };
      } else if (allChanges.length === 1) {
        return {
          description: allChanges[0],
          descriptionBold: '',
          descriptionText: allChanges[0],
          changeDetails: []
        };
      } else {
        return {
          description: `Updated ${allChanges.length} fields`,
          descriptionBold: `Updated ${allChanges.length} fields`,
          descriptionText: '',
          changeDetails: allChanges
        };
      }
    }

    return {
      description: 'Made a change',
      descriptionBold: 'Made a change',
      descriptionText: '',
      changeDetails: []
    };
  };

  const fetchClientAndHistory = async () => {
    try {
      setLoading(true);

      // Fetch client to determine if it's legacy or new
      let clientData: any = null;
      let isLegacy = false;
      let clientId: string | number | null = null;

      const { data: newLeadData } = await supabase
        .from('leads')
        .select('*')
        .eq('lead_number', lead_number)
        .maybeSingle();

      if (newLeadData) {
        clientData = newLeadData;
        clientId = newLeadData.id;
        isLegacy = false;
      } else {
        const { data: legacyByManualId } = await supabase
          .from('leads_lead')
          .select('*')
          .eq('manual_id', lead_number)
          .maybeSingle();

        if (legacyByManualId) {
          clientData = legacyByManualId;
          clientId = legacyByManualId.id;
          isLegacy = true;
        } else {
          const { data: legacyById } = await supabase
            .from('leads_lead')
            .select('*')
            .eq('id', lead_number ? parseInt(lead_number) : 0)
            .maybeSingle();

          if (legacyById) {
            clientData = legacyById;
            clientId = legacyById.id;
            isLegacy = true;
          }
        }

        if (!clientData) {
          throw new Error(`Lead #${lead_number} not found`);
        }
      }

      setClient(clientData);

      // Check if this is a master lead (has sub-leads)
      let isMaster = false;
      if (isLegacy) {
        const legacyId = typeof clientId === 'number' ? clientId : parseInt(String(clientId), 10);
        if (!isNaN(legacyId)) {
          const { count } = await supabase
            .from('leads_lead')
            .select('id', { count: 'exact', head: true })
            .eq('master_id', legacyId);
          isMaster = (count || 0) > 0;
        }
      } else {
        const { count } = await supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('master_id', clientId);
        isMaster = (count || 0) > 0;
      }
      setIsMasterLead(isMaster);

      // Fetch all history entries
      const historyEntries: HistoryEntry[] = [];
      const employeeIds = new Set<number>();
      const rawHistoryEntries: any[] = [];

      // Fetch lead history
      if (isLegacy) {
        const { data: leadHistory } = await supabase
          .from('history_leads_lead')
          .select('*')
          .eq('original_id', clientId)
          .order('changed_at', { ascending: false });

        if (leadHistory) {
          leadHistory.forEach(entry => {
            if (entry.changed_by) {
              employeeIds.add(Number(entry.changed_by));
            }
            rawHistoryEntries.push({ ...entry, tableType: 'lead' });
          });
        }
      } else {
        const { data: leadHistory } = await supabase
          .from('history_leads')
          .select('*')
          .eq('original_id', clientId)
          .order('changed_at', { ascending: false });

        if (leadHistory) {
          leadHistory.forEach(entry => {
            if (entry.changed_by) {
              employeeIds.add(Number(entry.changed_by));
            }
            rawHistoryEntries.push({ ...entry, tableType: 'lead' });
          });
        }
      }

      // Fetch meeting history
      let meetingHistory: any[] = [];
      if (isLegacy) {
        const { data } = await supabase
          .from('history_meetings')
          .select('*')
          .eq('legacy_lead_id', clientId)
          .order('changed_at', { ascending: false });
        meetingHistory = data || [];
      } else {
        const { data } = await supabase
          .from('history_meetings')
          .select('*')
          .eq('client_id', clientId)
          .order('changed_at', { ascending: false });
        meetingHistory = data || [];
      }

      if (meetingHistory) {
        meetingHistory.forEach(entry => {
          if (entry.changed_by) {
            employeeIds.add(Number(entry.changed_by));
          }
          rawHistoryEntries.push({ ...entry, tableType: 'meeting' });
        });
      }

      // Fetch payment history
      console.log('🔍 [Payment History] Starting fetch:', { isLegacy, clientId, clientIdType: typeof clientId });

      if (isLegacy) {
        // For legacy payments, lead_id is TEXT, so convert clientId to string
        // Also check client_id as a fallback
        const clientIdStr = String(clientId);
        const clientIdNum = typeof clientId === 'number' ? clientId : parseInt(String(clientId), 10);

        console.log('🔍 [Payment History Legacy] Querying with:', { clientIdStr, clientIdNum });

        const { data: paymentHistoryByLeadId, error: error1 } = await supabase
          .from('history_finances_paymentplanrow')
          .select('*')
          .eq('lead_id', clientIdStr)
          .order('changed_at', { ascending: false });

        const { data: paymentHistoryByClientId, error: error2 } = await supabase
          .from('history_finances_paymentplanrow')
          .select('*')
          .eq('client_id', clientIdNum)
          .order('changed_at', { ascending: false });

        if (error1) {
          console.error('❌ [Payment History Legacy] Error fetching by lead_id:', error1);
        }
        if (error2) {
          console.error('❌ [Payment History Legacy] Error fetching by client_id:', error2);
        }

        console.log('🔍 [Payment History Legacy] Results:', {
          clientId,
          clientIdStr,
          clientIdNum,
          byLeadId: paymentHistoryByLeadId?.length || 0,
          byClientId: paymentHistoryByClientId?.length || 0,
          byLeadIdSample: paymentHistoryByLeadId?.[0] ? {
            history_id: paymentHistoryByLeadId[0].history_id,
            original_id: paymentHistoryByLeadId[0].original_id,
            lead_id: paymentHistoryByLeadId[0].lead_id,
            client_id: paymentHistoryByLeadId[0].client_id,
            change_type: paymentHistoryByLeadId[0].change_type
          } : null,
          byClientIdSample: paymentHistoryByClientId?.[0] ? {
            history_id: paymentHistoryByClientId[0].history_id,
            original_id: paymentHistoryByClientId[0].original_id,
            lead_id: paymentHistoryByClientId[0].lead_id,
            client_id: paymentHistoryByClientId[0].client_id,
            change_type: paymentHistoryByClientId[0].change_type
          } : null
        });

        const allPaymentHistory = [
          ...(paymentHistoryByLeadId || []),
          ...(paymentHistoryByClientId || [])
        ];

        console.log('🔍 [Payment History Legacy] Combined:', allPaymentHistory.length);

        // Remove duplicates based on history_id
        const uniquePayments = Array.from(
          new Map(allPaymentHistory.map(p => [p.history_id, p])).values()
        );

        console.log('🔍 [Payment History Legacy] Unique:', uniquePayments.length, uniquePayments.map(p => ({
          history_id: p.history_id,
          change_type: p.change_type,
          changed_at: p.changed_at
        })));

        uniquePayments.forEach(entry => {
          if (entry.changed_by) {
            employeeIds.add(Number(entry.changed_by));
          }
          rawHistoryEntries.push({ ...entry, tableType: 'payment' });
        });

        console.log('🔍 [Payment History Legacy] Added to rawHistoryEntries:', uniquePayments.length);
      } else {
        // For new leads, check both lead_id and lead_ids columns
        // clientId is UUID string for new leads
        console.log('🔍 [Payment History New] Querying with clientId:', clientId);

        const { data: paymentHistoryById, error: error1 } = await supabase
          .from('history_payment_plans')
          .select('*')
          .eq('lead_id', clientId)
          .order('changed_at', { ascending: false });

        const { data: paymentHistoryByIds, error: error2 } = await supabase
          .from('history_payment_plans')
          .select('*')
          .eq('lead_ids', clientId)
          .order('changed_at', { ascending: false });

        if (error1) {
          console.error('❌ [Payment History New] Error fetching by lead_id:', error1);
        }
        if (error2) {
          console.error('❌ [Payment History New] Error fetching by lead_ids:', error2);
        }

        console.log('🔍 [Payment History New] Results:', {
          clientId,
          byLeadId: paymentHistoryById?.length || 0,
          byLeadIds: paymentHistoryByIds?.length || 0,
          byLeadIdSample: paymentHistoryById?.[0] ? {
            history_id: paymentHistoryById[0].history_id,
            original_id: paymentHistoryById[0].original_id,
            lead_id: paymentHistoryById[0].lead_id,
            lead_ids: paymentHistoryById[0].lead_ids,
            change_type: paymentHistoryById[0].change_type
          } : null,
          byLeadIdsSample: paymentHistoryByIds?.[0] ? {
            history_id: paymentHistoryByIds[0].history_id,
            original_id: paymentHistoryByIds[0].original_id,
            lead_id: paymentHistoryByIds[0].lead_id,
            lead_ids: paymentHistoryByIds[0].lead_ids,
            change_type: paymentHistoryByIds[0].change_type
          } : null
        });

        const allPaymentHistory = [
          ...(paymentHistoryById || []),
          ...(paymentHistoryByIds || [])
        ];

        console.log('🔍 [Payment History New] Combined:', allPaymentHistory.length);

        // Remove duplicates based on history_id
        const uniquePayments = Array.from(
          new Map(allPaymentHistory.map(p => [p.history_id, p])).values()
        );

        console.log('🔍 [Payment History New] Unique:', uniquePayments.length, uniquePayments.map(p => ({
          history_id: p.history_id,
          change_type: p.change_type,
          changed_at: p.changed_at
        })));

        uniquePayments.forEach(entry => {
          if (entry.changed_by) {
            employeeIds.add(Number(entry.changed_by));
          }
          rawHistoryEntries.push({ ...entry, tableType: 'payment' });
        });

        console.log('🔍 [Payment History New] Added to rawHistoryEntries:', uniquePayments.length);
      }

      console.log('🔍 [Payment History] Total rawHistoryEntries after payment fetch:', rawHistoryEntries.length);

      // Fetch employees if not already loaded (use local variable to avoid async state issues)
      let employeesToUse = allEmployees;
      if (employeesToUse.length === 0) {
        const { data: employees, error: empError } = await supabase
          .from('tenants_employee')
          .select('id, display_name, photo_url, photo')
          .order('display_name', { ascending: true });

        if (!empError && employees) {
          employeesToUse = employees;
          setAllEmployees(employees);
        }
      }

      // Fetch contact IDs from payment history entries
      // For legacy payments (finances_paymentplanrow), use client_id
      // For new payments (payment_plans), use client_name directly
      const contactIds = new Set<number>();
      rawHistoryEntries.forEach(entry => {
        if (entry.tableType === 'payment') {
          // Legacy payments have client_id
          if (entry.client_id) {
            const contactId = typeof entry.client_id === 'string' ? parseInt(entry.client_id) : entry.client_id;
            if (!isNaN(contactId)) {
              contactIds.add(contactId);
            }
          }
        }
      });

      // Fetch contact names
      const contactNameMap = await fetchContacts(Array.from(contactIds));
      setContactMap(contactNameMap);

      // Helper function to get employee by ID (using local employeesToUse)
      const getEmployeeByIdLocal = (employeeIdOrName: string | number | null | undefined) => {
        if (!employeeIdOrName || employeeIdOrName === '---' || employeeIdOrName === '--' || employeeIdOrName === '') {
          return null;
        }

        // First, try to match by ID
        const employeeById = employeesToUse.find((emp: any) => {
          const empId = typeof emp.id === 'bigint' ? Number(emp.id) : emp.id;
          const searchId = typeof employeeIdOrName === 'string' ? parseInt(employeeIdOrName, 10) : employeeIdOrName;

          if (isNaN(Number(searchId))) return false;

          if (empId.toString() === searchId.toString()) return true;
          if (Number(empId) === Number(searchId)) return true;

          return false;
        });

        if (employeeById) {
          return employeeById;
        }

        // If not found by ID, try to match by display name
        if (typeof employeeIdOrName === 'string') {
          const employeeByName = employeesToUse.find((emp: any) => {
            if (!emp.display_name) return false;
            return emp.display_name.trim().toLowerCase() === employeeIdOrName.trim().toLowerCase();
          });

          if (employeeByName) {
            return employeeByName;
          }
        }

        return null;
      };

      // Process history entries with employee data
      rawHistoryEntries.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());

      // First pass: Process all entries to detect changes
      const processedEntries: Array<{ entry: any; descData: any; employeeDisplayName: string; contactName?: string }> = [];

      for (let i = 0; i < rawHistoryEntries.length; i++) {
        const entry = rawHistoryEntries[i];
        const tableType = entry.tableType;

        // Find previous entry for same record (for detecting changes)
        let prevEntry = null;
        if (entry.change_type === 'update' || entry.change_type === 'delete') {
          // Look for previous entry with same original_id and tableType
          // Search in all remaining entries (after current index)
          prevEntry = rawHistoryEntries.slice(i + 1).find(e =>
            e.original_id === entry.original_id && e.tableType === tableType
          );

          if (tableType === 'payment') {
            console.log('🔍 [Processing Payment] Looking for prevEntry:', {
              currentOriginalId: entry.original_id,
              currentChangeType: entry.change_type,
              currentChangedAt: entry.changed_at,
              foundPrevEntry: !!prevEntry,
              prevEntryOriginalId: prevEntry?.original_id,
              prevEntryChangeType: prevEntry?.change_type,
              prevEntryChangedAt: prevEntry?.changed_at,
              searchRange: `entries ${i + 1} to ${rawHistoryEntries.length}`,
              totalEntries: rawHistoryEntries.length,
              entriesWithSameOriginalId: rawHistoryEntries.filter(e => e.original_id === entry.original_id && e.tableType === tableType).length
            });
          }
        }

        const empId = entry.changed_by ? Number(entry.changed_by) : null;
        const employeeData = getEmployeeByIdLocal(empId);
        const employeeDisplayName = employeeData ? employeeData.display_name : 'System';

        // Get contact name for payments
        let contactName: string | undefined;
        if (tableType === 'payment') {
          if (entry.client_id) {
            const contactId = typeof entry.client_id === 'string' ? parseInt(entry.client_id) : entry.client_id;
            if (!isNaN(contactId)) {
              contactName = contactNameMap[contactId];
            }
          }
          if (!contactName && entry.client_name) {
            contactName = entry.client_name;
          }
        }

        // First, detect all changes to see if there are interactions
        const allChanges = detectChanges(prevEntry, entry, tableType, employeesToUse);
        const interactionChanges = allChanges.filter((c: string) =>
          c.includes('interaction') || c.includes('added interaction') || c.includes('removed interaction')
        );
        const hasInteractionChanges = interactionChanges.length > 0;

        // Check if unactivation fields changed (these are handled specially and not added to changes array)
        // This check needs to work even when prevEntry is null (first update to a record)
        const unactivationFields = ['unactivated_at', 'unactivated_by', 'unactivation_reason', 'deactivate_notes', 'status'];
        let hasUnactivationChanges = false;

        if (prevEntry) {
          // Compare with previous entry
          hasUnactivationChanges = unactivationFields.some(field => {
            const oldVal = prevEntry[field];
            const newVal = entry[field];

            // For unactivated_at, filter out micro-updates (millisecond differences)
            if (field === 'unactivated_at' && oldVal && newVal) {
              try {
                const oldDate = new Date(oldVal);
                const newDate = new Date(newVal);
                if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
                  const diffMs = Math.abs(newDate.getTime() - oldDate.getTime());
                  // If difference is less than 1 second, ignore it (micro-update)
                  if (diffMs < 1000) {
                    return false;
                  }
                }
              } catch (e) {
                // If date parsing fails, treat as normal change
              }
            }

            return oldVal !== newVal;
          });
        } else {
          // No prevEntry - check if entry has unactivation fields set (first update)
          // This means the record was just unactivated
          hasUnactivationChanges = unactivationFields.some(field => {
            const newVal = entry[field];
            // If status changed to inactive, or unactivation fields are set, it's an unactivation
            if (field === 'status' && newVal === 'inactive') {
              return true;
            }
            if ((field === 'unactivated_at' || field === 'unactivated_by' || field === 'unactivation_reason' || field === 'deactivate_notes') && newVal) {
              return true;
            }
            return false;
          });
        }

        // If no changes detected and this is an update, skip this entry entirely
        // UNLESS it has unactivation changes (which are handled specially) or interaction changes
        // This prevents "Updated this record" entries with no actual changes
        if (entry.change_type === 'update' &&
          allChanges.length === 0 &&
          !hasInteractionChanges &&
          !hasUnactivationChanges &&
          tableType !== 'payment') {
          console.log('⏭️ [Processing] Skipping entry with 0 detected changes (non-payment, non-interaction, non-unactivation):', {
            history_id: entry.history_id,
            change_type: entry.change_type,
            tableType,
            hasPrevEntry: !!prevEntry
          });
          continue; // Skip this entry entirely
        }

        const descData = createDescription(entry, prevEntry, tableType, contactName, employeesToUse);

        // Debug: Log entries that result in "Updated this record" to understand what's happening
        if (descData.description === 'Updated this record' || descData.description.includes('Updated this record')) {
          console.log('⚠️ [Processing] Entry with "Updated this record":', {
            history_id: entry.history_id,
            change_type: entry.change_type,
            tableType,
            description: descData.description,
            descriptionBold: descData.descriptionBold,
            descriptionText: descData.descriptionText,
            changeDetails: descData.changeDetails.length,
            changeDetailsContent: descData.changeDetails,
            hasPrevEntry: !!prevEntry,
            detectedChanges: allChanges.length,
            detectedChangesContent: allChanges
          });
        }

        if (tableType === 'payment') {
          console.log('🔍 [Processing Payment] Description data:', {
            history_id: entry.history_id,
            description: descData.description,
            descriptionBold: descData.descriptionBold,
            descriptionText: descData.descriptionText,
            changeDetails: descData.changeDetails.length,
            contactName
          });
        }

        // Check if this is a notes update that also has interactions
        const isNotesUpdate = descData.descriptionBold && (
          descData.descriptionBold.includes('special note') ||
          descData.descriptionBold.includes('general note') ||
          descData.descriptionBold.includes('expert notes') ||
          descData.descriptionBold.includes('handler notes')
        );

        if (isNotesUpdate && hasInteractionChanges && tableType === 'lead') {
          // Split into two entries: one for notes, one for interactions

          // First entry: notes only (already filtered in createDescription, but ensure no interactions)
          const notesOnlyChangeDetails = descData.changeDetails.filter((c: string) =>
            !c.includes('interaction') && !c.includes('added interaction') && !c.includes('removed interaction')
          );

          processedEntries.push({
            entry,
            descData: {
              ...descData,
              changeDetails: notesOnlyChangeDetails
            },
            employeeDisplayName,
            contactName
          });

          // Second entry: interactions only
          const interactionDescData = {
            description: interactionChanges.length === 1
              ? interactionChanges[0]
              : `Updated interactions: ${interactionChanges.length} change${interactionChanges.length !== 1 ? 's' : ''}`,
            descriptionBold: interactionChanges.length === 1 ? '' : 'Updated interactions:',
            descriptionText: interactionChanges.length === 1 ? interactionChanges[0] : `${interactionChanges.length} change${interactionChanges.length !== 1 ? 's' : ''}`,
            changeDetails: interactionChanges
          };

          processedEntries.push({
            entry: {
              ...entry,
              // Create a unique ID for the interaction entry
              history_id: `${entry.history_id}_interactions`,
              _isInteractionEntry: true
            },
            descData: interactionDescData,
            employeeDisplayName,
            contactName
          });
        } else if (hasInteractionChanges && !isNotesUpdate && tableType === 'lead') {
          // If only interactions changed (no notes), create a single interaction entry
          const interactionDescData = {
            description: interactionChanges.length === 1
              ? interactionChanges[0]
              : `Updated interactions: ${interactionChanges.length} change${interactionChanges.length !== 1 ? 's' : ''}`,
            descriptionBold: interactionChanges.length === 1 ? '' : 'Updated interactions:',
            descriptionText: interactionChanges.length === 1 ? interactionChanges[0] : `${interactionChanges.length} change${interactionChanges.length !== 1 ? 's' : ''}`,
            changeDetails: interactionChanges
          };

          console.log('🔍 [Interactions] Creating interaction-only entry:', {
            history_id: entry.history_id,
            interactionChanges: interactionChanges.length,
            description: interactionDescData.description,
            descriptionBold: interactionDescData.descriptionBold,
            descriptionText: interactionDescData.descriptionText
          });

          processedEntries.push({
            entry: {
              ...entry,
              _isInteractionEntry: true
            },
            descData: interactionDescData,
            employeeDisplayName,
            contactName
          });
        } else {
          // Normal entry - no splitting needed
          processedEntries.push({
            entry,
            descData,
            employeeDisplayName,
            contactName
          });
        }
      }

      console.log('🔍 [Processing] Total processedEntries:', processedEntries.length);
      console.log('🔍 [Processing] Breakdown by tableType:', {
        lead: processedEntries.filter(e => e.entry.tableType === 'lead').length,
        meeting: processedEntries.filter(e => e.entry.tableType === 'meeting').length,
        payment: processedEntries.filter(e => e.entry.tableType === 'payment').length
      });

      // Second pass: Group payment plan insertions together
      // Group payment plan insertions that have the same timestamp, employee, and contact
      const paymentInsertGroups = new Map<string, typeof processedEntries>();
      const nonPaymentEntries: typeof processedEntries = [];

      for (const processed of processedEntries) {
        const { entry, descData } = processed;

        // Check if this is a payment plan insertion
        if (entry.tableType === 'payment' && entry.change_type === 'insert') {
          // Create a group key based on timestamp (rounded to nearest second), employee, and contact
          const timestamp = new Date(entry.changed_at).getTime();
          const roundedTimestamp = Math.floor(timestamp / 1000) * 1000; // Round to nearest second
          const employeeId = entry.changed_by || 'System';

          // Get contact identifier (client_id for legacy, client_name for new)
          let contactId = '';
          if (entry.client_id) {
            contactId = String(entry.client_id);
          } else if (entry.client_name) {
            contactId = entry.client_name;
          }

          const groupKey = `payment_insert_${roundedTimestamp}_${employeeId}_${contactId}`;

          if (!paymentInsertGroups.has(groupKey)) {
            paymentInsertGroups.set(groupKey, []);
          }
          paymentInsertGroups.get(groupKey)!.push(processed);
        } else {
          // Keep non-payment-insert entries separate
          nonPaymentEntries.push(processed);
        }
      }

      console.log('🔍 [Payment Grouping] Found payment insert groups:', paymentInsertGroups.size);
      paymentInsertGroups.forEach((group, key) => {
        console.log(`🔍 [Payment Grouping] Group ${key}: ${group.length} entries`);
      });

      // Consolidate payment plan insertions
      const consolidatedPaymentEntries: typeof processedEntries = [];

      paymentInsertGroups.forEach((group, groupKey) => {
        if (group.length === 0) return;

        // Sort by original_id to maintain order
        group.sort((a, b) => {
          const aId = a.entry.original_id?.toString() || '';
          const bId = b.entry.original_id?.toString() || '';
          return aId.localeCompare(bId);
        });

        // Use the first entry as the base
        const baseEntry = group[0];
        const contactName = baseEntry.contactName;
        const contactText = contactName ? ` for contact ${contactName}` : '';

        // Collect all payment row details
        const paymentRows: string[] = [];
        group.forEach((processed) => {
          const entry = processed.entry;
          const rowDetails: string[] = [];

          if (entry.value != null && entry.value !== '') {
            rowDetails.push(`Amount: ${entry.value}`);
          }
          if (entry.due_date) {
            try {
              const date = new Date(entry.due_date);
              const formattedDate = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              });
              rowDetails.push(`Due: ${formattedDate}`);
            } catch (e) {
              rowDetails.push(`Due: ${entry.due_date}`);
            }
          }
          if (entry.paid !== null && entry.paid !== undefined) {
            rowDetails.push(`Paid: ${entry.paid ? 'Yes' : 'No'}`);
          }
          if (entry.ready_to_pay !== null && entry.ready_to_pay !== undefined) {
            rowDetails.push(`Ready: ${entry.ready_to_pay ? 'Yes' : 'No'}`);
          }
          if (entry.payment_order != null && entry.payment_order !== '') {
            rowDetails.push(`Order: ${entry.payment_order}`);
          }

          if (rowDetails.length > 0) {
            paymentRows.push(`Row ${paymentRows.length + 1}: ${rowDetails.join(', ')}`);
          }
        });

        // Create consolidated description
        const consolidatedDesc = {
          description: `Created new payment plan${contactText} with ${group.length} payment row${group.length !== 1 ? 's' : ''}`,
          descriptionBold: 'Created new payment plan',
          descriptionText: contactText,
          changeDetails: paymentRows
        };

        // Create consolidated entry using the first entry's metadata
        consolidatedPaymentEntries.push({
          entry: {
            ...baseEntry.entry,
            // Store all original_ids for reference
            _groupedOriginalIds: group.map(g => g.entry.original_id),
            _groupedHistoryIds: group.map(g => g.entry.history_id)
          },
          descData: consolidatedDesc,
          employeeDisplayName: baseEntry.employeeDisplayName,
          contactName: baseEntry.contactName
        });
      });

      console.log('🔍 [Payment Grouping] Consolidated to:', consolidatedPaymentEntries.length, 'entries');
      console.log('🔍 [Payment Grouping] Non-payment entries:', nonPaymentEntries.length);

      // Combine consolidated payment entries with other entries
      const entriesToDeduplicate = [...consolidatedPaymentEntries, ...nonPaymentEntries];

      // Third pass: Deduplicate and filter
      // Group by timestamp, employee, and tableType - if multiple entries have same timestamp and employee with no changes, keep only one
      const seenKeys = new Set<string>();
      const deduplicatedProcessed: typeof processedEntries = [];

      for (const processed of entriesToDeduplicate) {
        const { entry, descData } = processed;
        const tableType = entry.tableType;

        // NEVER filter out interaction entries - they should always be shown
        const isInteractionEntry = entry._isInteractionEntry ||
          (descData.descriptionBold === 'Updated interactions:' ||
            descData.descriptionText?.includes('added interaction') ||
            descData.descriptionText?.includes('removed interaction') ||
            descData.changeDetails.some((c: string) => c.includes('interaction')));

        // Skip entries with no meaningful changes (updates with no detected changes)
        // BUT: For payment updates without a prevEntry, we should still show them
        // because they represent a change that was made (even if we can't detect what changed)
        // BUT: NEVER skip interaction entries
        const isEmptyUpdate = !isInteractionEntry &&
          entry.change_type === 'update' &&
          descData.changeDetails.length === 0 &&
          !descData.descriptionBold &&
          !descData.descriptionText &&
          (descData.description === 'Updated this record' || descData.description === 'Made a change' || descData.description.includes('Updated this record'));

        // Debug: Log entries that might be filtered out
        if (isEmptyUpdate) {
          console.log('🔍 [Processing] Filtering out empty update:', {
            history_id: entry.history_id,
            change_type: entry.change_type,
            description: descData.description,
            descriptionBold: descData.descriptionBold,
            descriptionText: descData.descriptionText,
            changeDetails: descData.changeDetails.length,
            tableType,
            hadPrevEntry: processedEntries.find(p =>
              p.entry.original_id === entry.original_id &&
              p.entry.tableType === tableType &&
              new Date(p.entry.changed_at) < new Date(entry.changed_at)
            ) !== undefined
          });
        }

        // Skip "Updated facts of case" entries with no content
        const isEmptyFactsUpdate = descData.descriptionBold === 'Updated facts of case with the following:' &&
          (!descData.descriptionText || descData.descriptionText.trim() === '') &&
          descData.changeDetails.length === 0;

        // For payment updates without prevEntry, we should still show them
        // Find if there was a prevEntry for this entry
        const hadPrevEntry = processedEntries.find(p =>
          p.entry.original_id === entry.original_id &&
          p.entry.tableType === tableType &&
          new Date(p.entry.changed_at) < new Date(entry.changed_at)
        ) !== undefined;

        if (isEmptyFactsUpdate) {
          // Skip "Updated facts of case" entries with no content
          continue;
        }

        // ALWAYS skip entries with "Updated this record" and no changes, regardless of prevEntry
        // The only exception is payment updates without prevEntry (handled below)
        if (isEmptyUpdate) {
          // For non-payment entries, always skip if empty
          if (tableType !== 'payment') {
            console.log('⏭️ [Filtering] Skipping empty update (non-payment):', {
              history_id: entry.history_id,
              description: descData.description,
              hadPrevEntry
            });
            continue;
          }

          // For payment entries, only skip if we had a prevEntry to compare with
          if (hadPrevEntry) {
            console.log('⏭️ [Filtering] Skipping empty payment update (had prevEntry):', {
              history_id: entry.history_id,
              description: descData.description
            });
            continue;
          }
        }

        // Also skip if description is just "Updated this record" even if there are some fields
        // BUT only if we had a prevEntry to compare with
        // BUT: NEVER skip interaction entries
        if (!isInteractionEntry &&
          entry.change_type === 'update' &&
          descData.changeDetails.length === 0 &&
          descData.description === 'Updated this record' &&
          hadPrevEntry) {
          if (tableType === 'payment') {
            console.log('⏭️ [Filtering] Skipping payment update with no details (had prevEntry):', {
              history_id: entry.history_id
            });
          }
          continue;
        }

        // For payment updates without prevEntry, update the description to be more informative
        if (tableType === 'payment' && entry.change_type === 'update' && !hadPrevEntry && isEmptyUpdate) {
          descData.description = 'Updated payment plan';
          descData.descriptionBold = 'Updated payment plan';
          descData.descriptionText = '';
          if (tableType === 'payment') {
            console.log('✅ [Filtering] Keeping payment update without prevEntry:', {
              history_id: entry.history_id,
              updatedDescription: descData.description
            });
          }
        }

        if (tableType === 'payment') {
          console.log('✅ [Filtering] Keeping payment entry:', {
            history_id: entry.history_id,
            change_type: entry.change_type,
            description: descData.description
          });
        }

        // For entries with actual changes, use a more specific key
        // For consolidated payment entries, use a special key that includes the grouped IDs
        // For interaction entries, use a unique key to prevent deduplication with notes entries
        let key: string;
        if (entry._groupedHistoryIds && entry._groupedHistoryIds.length > 0) {
          // Use a key based on the group (timestamp, employee, contact)
          const timestamp = new Date(entry.changed_at).getTime();
          const roundedTimestamp = Math.floor(timestamp / 1000) * 1000;
          const employeeId = entry.changed_by || 'System';
          const contactId = entry.client_id ? String(entry.client_id) : (entry.client_name || '');
          key = `payment_insert_group_${roundedTimestamp}_${employeeId}_${contactId}`;
        } else if (entry._isInteractionEntry || isInteractionEntry) {
          // Interaction entries need unique keys to prevent deduplication with notes entries
          key = `${entry.original_id}_${tableType}_${entry.change_type}_${entry.changed_at}_${entry.changed_by}_interactions`;
        } else {
          key = `${entry.original_id}_${tableType}_${entry.change_type}_${entry.changed_at}_${entry.changed_by}`;
        }

        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          deduplicatedProcessed.push(processed);
        }
      }

      console.log('🔍 [Deduplication] Total deduplicatedProcessed:', deduplicatedProcessed.length);
      console.log('🔍 [Deduplication] Breakdown by tableType:', {
        lead: deduplicatedProcessed.filter(e => e.entry.tableType === 'lead').length,
        meeting: deduplicatedProcessed.filter(e => e.entry.tableType === 'meeting').length,
        payment: deduplicatedProcessed.filter(e => e.entry.tableType === 'payment').length
      });

      // Third pass: Build final history entries
      for (const processed of deduplicatedProcessed) {
        const { entry, descData, employeeDisplayName } = processed;
        const tableType = entry.tableType;

        let entryType: HistoryEntry['type'] = 'lead_change';
        if (tableType === 'lead') {
          entryType = entry.change_type === 'insert' ? 'lead_created' :
            entry.change_type === 'delete' ? 'lead_deleted' : 'lead_change';
        } else if (tableType === 'meeting') {
          entryType = 'meeting_change';
        } else if (tableType === 'payment') {
          entryType = 'payment_change';
          console.log('✅ [Final] Adding payment entry to historyEntries:', {
            id: `${tableType}_${entry.history_id}`,
            change_type: entry.change_type,
            description: descData.description
          });
        }

        // For consolidated payment entries, use a combined ID
        // For interaction entries, use a unique ID
        let entryId: string;
        if (entry._groupedHistoryIds && entry._groupedHistoryIds.length > 0) {
          entryId = `${tableType}_grouped_${entry._groupedHistoryIds.join('_')}`;
        } else if (entry._isInteractionEntry) {
          entryId = `${tableType}_${entry.history_id}_interactions`;
        } else {
          entryId = `${tableType}_${entry.history_id}`;
        }

        historyEntries.push({
          id: entryId,
          type: entryType,
          change_type: entry.change_type,
          changed_by: String(entry.changed_by || 'System'),
          changed_at: entry.changed_at,
          employeeDisplayName: employeeDisplayName,
          description: descData.description,
          descriptionBold: descData.descriptionBold,
          descriptionText: descData.descriptionText,
          changeDetails: descData.changeDetails
        });
      }

      console.log('🔍 [Final] Total historyEntries:', historyEntries.length);
      console.log('🔍 [Final] Breakdown by type:', {
        lead_change: historyEntries.filter(e => e.type === 'lead_change' || e.type === 'lead_created' || e.type === 'lead_deleted').length,
        meeting_change: historyEntries.filter(e => e.type === 'meeting_change').length,
        payment_change: historyEntries.filter(e => e.type === 'payment_change').length
      });

      // Sort by date (newest first)
      historyEntries.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());

      setHistoryData(historyEntries);
      setError(null);
    } catch (error: any) {
      console.error('Error fetching history:', error);
      setError(error?.message || 'Failed to load history data');
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get category display name (same as ClientHeader.tsx)
  const getCategoryDisplayName = (categoryId: number | string | null | undefined, fallbackCategory?: string): string => {
    if (!categoryId) {
      return fallbackCategory || 'No Category';
    }

    const category = allCategories.find((cat: any) => {
      const catId = typeof cat.id === 'bigint' ? Number(cat.id) : cat.id;
      const searchId = typeof categoryId === 'string' ? parseInt(categoryId, 10) : categoryId;
      return catId === searchId || Number(catId) === Number(searchId);
    });

    if (category) {
      if (category.misc_maincategory?.name) {
        return `${category.name} (${category.misc_maincategory.name})`;
      } else {
        return category.name;
      }
    }

    return fallbackCategory || 'No Category';
  };

  // Helper to get contrasting text color (same as ClientHeader.tsx)
  const getContrastingTextColor = (hexColor?: string | null) => {
    if (!hexColor) return '#111827';
    let sanitized = hexColor.trim();
    if (sanitized.startsWith('#')) sanitized = sanitized.slice(1);
    if (sanitized.length === 3) {
      sanitized = sanitized.split('').map(char => char + char).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(sanitized)) {
      return '#111827';
    }
    const r = parseInt(sanitized.slice(0, 2), 16) / 255;
    const g = parseInt(sanitized.slice(2, 4), 16) / 255;
    const b = parseInt(sanitized.slice(4, 6), 16) / 255;

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance > 0.55 ? '#111827' : '#ffffff';
  };

  // Render lead number (same logic as ClientHeader.tsx)
  const renderLeadNumber = (selectedClient: any, isMasterLead?: boolean) => {
    if (!selectedClient) return '---';
    let displayNumber = selectedClient.lead_number || selectedClient.manual_id || selectedClient.id || '---';
    const displayStr = displayNumber.toString();
    const hasExistingSuffix = displayStr.includes('/');
    let baseNumber = hasExistingSuffix ? displayStr.split('/')[0] : displayStr;
    const existingSuffix = hasExistingSuffix ? displayStr.split('/').slice(1).join('/') : null;

    const isSuccessStage = selectedClient.stage === '100' || selectedClient.stage === 100;
    if (isSuccessStage && baseNumber && !baseNumber.toString().startsWith('C')) {
      baseNumber = baseNumber.toString().replace(/^L/, 'C');
    }

    const hasNoMasterId = !selectedClient.master_id || String(selectedClient.master_id).trim() === '';
    const isMasterWithSubLeads = hasNoMasterId && isMasterLead;

    if (isMasterWithSubLeads && !hasExistingSuffix) {
      return `${baseNumber}/1`;
    } else if (hasExistingSuffix) {
      return `${baseNumber}/${existingSuffix}`;
    }
    return baseNumber;
  };

  const getFieldDisplayName = (field: string) => {
    const fieldMap: { [key: string]: string } = {
      'name': 'Client Name',
      'email': 'Email',
      'phone': 'Phone',
      'stage': 'Stage',
      'status': 'Status',
      'balance': 'Balance',
      'proposal_total': 'Proposal Total',
      'special_notes': 'Special Notes',
      'general_notes': 'General Notes',
      'tags': 'Tags',
      'anchor': 'Anchor',
      'category': 'Category',
      'closer': 'Closer',
      'closer_id': 'Closer',
      'expert': 'Expert',
      'expert_id': 'Expert',
      'handler': 'Handler',
      'handler_id': 'Handler',
      'case_handler_id': 'Case Handler',
      'scheduler': 'Scheduler',
      'meeting_scheduler_id': 'Scheduler',
      'manager': 'Manager',
      'manager_id': 'Manager',
      'meeting_manager_id': 'Meeting Manager',
      'helper': 'Helper',
      'meeting_lawyer_id': 'Helper',
      'meeting_date': 'Meeting Date',
      'meeting_time': 'Meeting Time',
      'meeting_location': 'Meeting Location',
      'meeting_manager': 'Meeting Manager',
      'meeting_amount': 'Meeting Amount',
      'attendance_probability': 'Attendance Probability',
      'complexity': 'Complexity',
      'value': 'Payment Amount',
      'due_date': 'Due Date',
      'paid': 'Payment Status',
      'ready_to_pay': 'Ready to Pay',
      'payment_order': 'Payment Order',
      'notes': 'Notes'
    };
    return fieldMap[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getEntryIcon = (entry: HistoryEntry) => {
    if (entry.type === 'lead_created') {
      return <UserPlusIcon className="w-5 h-5 text-green-500" />;
    }
    if (entry.type === 'lead_deleted') {
      return <NoSymbolIcon className="w-5 h-5 text-red-500" />;
    }
    if (entry.type === 'meeting_change') {
      return <CalendarDaysIcon className="w-5 h-5 text-blue-500" />;
    }
    if (entry.type === 'payment_change') {
      return <BanknotesIcon className="w-5 h-5 text-purple-500" />;
    }
    return <PencilSquareIcon className="w-5 h-5 text-orange-500" />;
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  const formatDateOnly = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const isSameDay = (date1: string, date2: string) => {
    try {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
    } catch {
      return false;
    }
  };

  // Group history entries by date
  const groupHistoryByDate = (entries: HistoryEntry[]) => {
    const grouped: { [key: string]: HistoryEntry[] } = {};
    entries.forEach(entry => {
      const dateKey = formatDateOnly(entry.changed_at);
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(entry);
    });
    return grouped;
  };

  const getChangeTypeBadge = (changeType: string) => {
    const badges = {
      'insert': <span className="badge badge-sm text-white" style={{ backgroundColor: '#2563eb' }}>Created</span>,
      'update': <span className="badge badge-sm text-white" style={{ backgroundColor: '#15803d' }}>Updated</span>,
      'delete': <span className="badge badge-error badge-sm">Deleted</span>
    };
    return badges[changeType as keyof typeof badges] || <span className="badge badge-sm">Changed</span>;
  };

  const filteredHistory = historyData.filter(entry => {
    // Filter by change type
    let matchesType = false;
    if (filterType === 'all') {
      matchesType = true;
    } else if (filterType === 'lead_changes' && (entry.type === 'lead_change' || entry.type === 'lead_created' || entry.type === 'lead_deleted')) {
      matchesType = true;
    } else if (filterType === 'meeting_changes' && entry.type === 'meeting_change') {
      matchesType = true;
    } else if (filterType === 'payment_changes' && entry.type === 'payment_change') {
      matchesType = true;
    }

    if (!matchesType) return false;

    // Filter by employee search
    if (employeeSearch.trim() === '') return true;

    const searchTerm = employeeSearch.trim().toLowerCase();
    const employeeName = entry.employeeDisplayName || 'System';

    return employeeName.toLowerCase().includes(searchTerm);
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
    <div className="p-8 w-full">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate(`/clients/${lead_number}`)}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>Back to Client</span>
        </button>
        <h1 className="text-3xl font-bold">Change History</h1>
      </div>

      {client && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h2 className="text-xl font-semibold">
              {client.name} <span className="text-gray-600 font-normal">#{renderLeadNumber(client, isMasterLead)}</span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Stage Badge (same as ClientHeader.tsx) */}
              {client.stage && (() => {
                const stageId = String(client.stage);
                const stageName = getStageName(stageId);
                const stageColour = getStageColour(stageId);
                const textColor = getContrastingTextColor(stageColour);

                return (
                  <span
                    className="badge badge-lg font-semibold"
                    style={{
                      backgroundColor: stageColour || undefined,
                      color: stageColour ? textColor : undefined,
                      borderColor: stageColour || undefined,
                    }}
                  >
                    {stageName}
                  </span>
                );
              })()}

              {/* Category and Topic (same format as ClientHeader.tsx) */}
              {(() => {
                const categoryId = (client as any).category_id || null;
                const displayCategory = getCategoryDisplayName(categoryId, client.category);
                const hasCategory = displayCategory && displayCategory !== 'No Category';
                const hasTopic = client.topic;

                if (hasCategory || hasTopic) {
                  return (
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {hasCategory && displayCategory}
                      {hasCategory && hasTopic && ' • '}
                      {hasTopic && client.topic}
                    </span>
                  );
                }
                return null;
              })()}
            </div>
          </div>
          {filteredHistory.length > 0 && (
            <p className="text-sm text-gray-500">
              <span className="font-medium">Total changes:</span> {filteredHistory.length} entries
            </p>
          )}
        </div>
      )}

      <div className="mb-6 flex gap-4 items-center flex-wrap">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as any)}
          className="select select-bordered w-full max-w-xs"
        >
          <option value="all">All Changes</option>
          <option value="lead_changes">Lead Changes</option>
          <option value="meeting_changes">Meeting Changes</option>
          <option value="payment_changes">Payment Changes</option>
        </select>

        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by employee..."
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            className="input input-bordered w-full pl-10"
          />
        </div>
      </div>

      <div className="space-y-6">
        {filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-base-100 rounded-lg">
            <ArchiveBoxIcon className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-lg font-medium">No history entries found</p>
            <p className="text-sm mt-2">Changes will appear here once they are made.</p>
          </div>
        ) : (
          (() => {
            const groupedHistory = groupHistoryByDate(filteredHistory);
            const sortedDates = Object.keys(groupedHistory).sort((a, b) =>
              new Date(b).getTime() - new Date(a).getTime()
            );

            return sortedDates.map((dateKey) => (
              <div key={dateKey} className="space-y-3">
                <div className="sticky top-0 py-2 z-10 mb-4">
                  <span className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white/70 dark:bg-gray-800/70 backdrop-blur-md border border-white/20 dark:border-gray-700/20 shadow-sm">
                    {dateKey}
                  </span>
                </div>
                {groupedHistory[dateKey].map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 p-4 border border-gray-200 dark:border-gray-700 ml-4"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-1 flex-shrink-0">
                        {getEntryIcon(entry)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4 mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              {getChangeTypeBadge(entry.change_type)}
                              <div className="text-base text-gray-900 dark:text-white">
                                {entry.descriptionBold && (
                                  <span className="font-semibold">{entry.descriptionBold} </span>
                                )}
                                {entry.descriptionText && (() => {
                                  // Check if this is a stage change that should show badges
                                  if (entry.changeDetails && entry.changeDetails.length === 1) {
                                    try {
                                      const parsed = JSON.parse(entry.changeDetails[0]);
                                      if (parsed.type === 'stage') {
                                        const renderStageBadge = (stageId: string | null, stageName: string) => {
                                          if (!stageId) {
                                            return <span className="text-gray-500 italic">No Stage</span>;
                                          }
                                          const stageColour = getStageColour(stageId);
                                          const textColor = getContrastingTextColor(stageColour);
                                          const backgroundColor = stageColour || '#3b28c7';

                                          return (
                                            <span
                                              className="badge badge-sm text-xs px-2 py-1 inline-flex items-center"
                                              style={{
                                                backgroundColor: backgroundColor,
                                                color: textColor,
                                                borderColor: backgroundColor,
                                              }}
                                            >
                                              {stageName}
                                            </span>
                                          );
                                        };

                                        return (
                                          <span className="flex items-center gap-2 flex-wrap">
                                            <span>changed {parsed.field} from </span>
                                            {renderStageBadge(parsed.oldStageId, parsed.oldStageName)}
                                            <span> to </span>
                                            {renderStageBadge(parsed.newStageId, parsed.newStageName)}
                                          </span>
                                        );
                                      }
                                    } catch (e) {
                                      // Not a stage change, check if it's an employee change
                                    }
                                  }

                                  // Check if descriptionText contains an employee change
                                  // Updated regex to match multi-word field names like "case handler"
                                  const employeeChangeMatch = entry.descriptionText.match(/changed\s+([a-z\s]+?)\s+from\s+"([^"]+)"\s+to\s+"([^"]+)"/i);
                                  if (employeeChangeMatch) {
                                    const [, field, oldName, newName] = employeeChangeMatch;
                                    const fieldLower = field.trim().toLowerCase();
                                    const employeeFields = ['closer', 'expert', 'handler', 'scheduler', 'manager', 'helper', 'meeting_manager', 'meeting_lawyer', 'closer_id', 'expert_id', 'handler_id', 'case_handler_id', 'meeting_scheduler_id', 'meeting_manager_id', 'meeting_lawyer_id', 'case handler', 'case handler id'];

                                    if (employeeFields.includes(fieldLower) || fieldLower.includes('handler') || fieldLower.includes('closer') || fieldLower.includes('expert') || fieldLower.includes('scheduler') || fieldLower.includes('manager')) {
                                      // Helper to find employee ID by name (works for both new and legacy leads)
                                      const findEmployeeIdByName = (name: string): number | null => {
                                        if (!name || name === 'Unassigned' || name === '(empty)' || name === '---' || name === '--') return null;

                                        // Try to find by display name (case-insensitive)
                                        const emp = allEmployees.find((e: any) => {
                                          if (!e || !e.display_name) return false;
                                          return e.display_name.trim().toLowerCase() === name.trim().toLowerCase();
                                        });

                                        if (emp) {
                                          return typeof emp.id === 'bigint' ? Number(emp.id) : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : emp.id);
                                        }

                                        return null;
                                      };

                                      const oldEmpId = findEmployeeIdByName(oldName);
                                      const newEmpId = findEmployeeIdByName(newName);

                                      return (
                                        <span className="flex items-center gap-2 flex-wrap">
                                          <span>changed {field.toLowerCase()} from </span>
                                          <span className="flex items-center gap-1">
                                            {oldEmpId && <EmployeeAvatar employeeId={oldEmpId} size="sm" />}
                                            <span>{oldName}</span>
                                          </span>
                                          <span> to </span>
                                          <span className="flex items-center gap-1">
                                            {newEmpId && <EmployeeAvatar employeeId={newEmpId} size="sm" />}
                                            <span>{newName}</span>
                                          </span>
                                        </span>
                                      );
                                    }
                                  }

                                  return <span>{entry.descriptionText}</span>;
                                })()}
                                {!entry.descriptionBold && !entry.descriptionText && (
                                  <span>{entry.description}</span>
                                )}
                              </div>
                            </div>

                            {/* Show specific change details if available */}
                            {entry.changeDetails && entry.changeDetails.length > 0 && (
                              <div className="ml-2 mb-2 pl-4 border-l-2 border-gray-300 dark:border-gray-600">
                                <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                                  {entry.changeDetails.map((change, idx) => {
                                    // Check if this is a stage change (JSON string)
                                    try {
                                      const parsed = JSON.parse(change);
                                      if (parsed.type === 'stage') {
                                        // Skip stage changes in the list if they're already shown in descriptionText
                                        // (when changeDetails.length === 1, it's shown in descriptionText with badges)
                                        if (entry.changeDetails && entry.changeDetails.length === 1 && entry.descriptionText) {
                                          return null;
                                        }

                                        const renderStageBadge = (stageId: string | null, stageName: string) => {
                                          if (!stageId) {
                                            return <span className="text-gray-500 italic">No Stage</span>;
                                          }
                                          const stageColour = getStageColour(stageId);
                                          const textColor = getContrastingTextColor(stageColour);
                                          const backgroundColor = stageColour || '#3b28c7';

                                          return (
                                            <span
                                              className="badge badge-sm text-xs px-2 py-1 inline-flex items-center"
                                              style={{
                                                backgroundColor: backgroundColor,
                                                color: textColor,
                                                borderColor: backgroundColor,
                                              }}
                                            >
                                              {stageName}
                                            </span>
                                          );
                                        };

                                        return (
                                          <li key={idx} className="flex items-center gap-2 flex-wrap">
                                            <span>changed {parsed.field} from </span>
                                            {renderStageBadge(parsed.oldStageId, parsed.oldStageName)}
                                            <span> to </span>
                                            {renderStageBadge(parsed.newStageId, parsed.newStageName)}
                                          </li>
                                        );
                                      }
                                    } catch (e) {
                                      // Not JSON, render as regular text
                                    }

                                    // Check if this is an employee change (format: "changed [field] from "Name1" to "Name2"")
                                    // Updated regex to match multi-word field names like "case handler"
                                    const employeeChangeMatch = change.match(/changed\s+([a-z\s]+?)\s+from\s+"([^"]+)"\s+to\s+"([^"]+)"/i);
                                    if (employeeChangeMatch) {
                                      const [, field, oldName, newName] = employeeChangeMatch;
                                      const fieldLower = field.trim().toLowerCase();
                                      const employeeFields = ['closer', 'expert', 'handler', 'scheduler', 'manager', 'helper', 'meeting_manager', 'meeting_lawyer', 'closer_id', 'expert_id', 'handler_id', 'case_handler_id', 'meeting_scheduler_id', 'meeting_manager_id', 'meeting_lawyer_id', 'case handler', 'case handler id'];

                                      if (employeeFields.includes(fieldLower) || fieldLower.includes('handler') || fieldLower.includes('closer') || fieldLower.includes('expert') || fieldLower.includes('scheduler') || fieldLower.includes('manager')) {
                                        // Helper to find employee ID by name (works for both new and legacy leads)
                                        const findEmployeeIdByName = (name: string): number | null => {
                                          if (!name || name === 'Unassigned' || name === '(empty)' || name === '---' || name === '--') return null;

                                          // Try to find by display name (case-insensitive)
                                          const emp = allEmployees.find((e: any) => {
                                            if (!e || !e.display_name) return false;
                                            return e.display_name.trim().toLowerCase() === name.trim().toLowerCase();
                                          });

                                          if (emp) {
                                            return typeof emp.id === 'bigint' ? Number(emp.id) : (typeof emp.id === 'string' ? parseInt(emp.id, 10) : emp.id);
                                          }

                                          return null;
                                        };

                                        const oldEmpId = findEmployeeIdByName(oldName);
                                        const newEmpId = findEmployeeIdByName(newName);

                                        return (
                                          <li key={idx} className="flex items-center gap-2 flex-wrap">
                                            <span>changed {field.toLowerCase()} from </span>
                                            <span className="flex items-center gap-1">
                                              {oldEmpId && <EmployeeAvatar employeeId={oldEmpId} size="sm" />}
                                              <span>{oldName}</span>
                                            </span>
                                            <span> to </span>
                                            <span className="flex items-center gap-1">
                                              {newEmpId && <EmployeeAvatar employeeId={newEmpId} size="sm" />}
                                              <span>{newName}</span>
                                            </span>
                                          </li>
                                        );
                                      }
                                    }

                                    return <li key={idx}>{change}</li>;
                                  }).filter(Boolean)}
                                </ul>
                              </div>
                            )}

                            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 flex-wrap mt-2">
                              <span className="flex items-center gap-2">
                                <EmployeeAvatar employeeId={entry.changed_by !== 'System' ? Number(entry.changed_by) : null} size="md" />
                                <span className="font-medium">
                                  {entry.employeeDisplayName || 'System'}
                                </span>
                              </span>
                              <span className="flex items-center gap-1">
                                <ArchiveBoxIcon className="w-4 h-4" />
                                {formatDate(entry.changed_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()
        )}
      </div>
    </div>
  );
};

export default HistoryPage;
