import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'react-hot-toast';
import { XMarkIcon, StarIcon, MagnifyingGlassIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { getStageName, getStageColour } from '../lib/stageUtils';

interface Highlight {
  id: number;
  user_id: string;
  lead_id: number | null;
  new_lead_id: string | null;
  lead_number: string | null;
  created_at: string;
  comment: string | null;
  comment_updated_at: string | null;
}

interface HighlightLead {
  id: string;
  lead_number: string;
  name: string;
  created_at: string;
  category: string | null;
  source: string | null;
  language: string | null;
  topic: string | null;
  stage: string | number | null;
  lead_type: 'new' | 'legacy';
  display_lead_number?: string;
  status?: number;
  comment?: string | null;
  comment_updated_at?: string | null;
  misc_category?: {
    name: string;
    misc_maincategory?: Array<{ name: string }>;
  };
}

interface HighlightsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const HighlightsPanel: React.FC<HighlightsPanelProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightLeads, setHighlightLeads] = useState<HighlightLead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('');
  const [currentUserEmployeeName, setCurrentUserEmployeeName] = useState<string>('');
  const [currentUserEmployeePhoto, setCurrentUserEmployeePhoto] = useState<string | null>(null);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [selectedHighlightId, setSelectedHighlightId] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);

  // Get current user ID and employee data
  useEffect(() => {
    const fetchUserId = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: userData, error } = await supabase
          .from('users')
          .select(`
            id,
            employee_id,
            tenants_employee!employee_id(
              display_name,
              photo_url
            )
          `)
          .eq('auth_id', user.id)
          .single();
        if (userData) {
          setCurrentUserId(userData.id);
          
          // Get employee name and photo
          const empData = Array.isArray(userData.tenants_employee) 
            ? userData.tenants_employee[0] 
            : userData.tenants_employee;
          
          if (empData?.display_name) {
            setCurrentUserEmployeeName(empData.display_name);
          }
          if (empData?.photo_url) {
            setCurrentUserEmployeePhoto(empData.photo_url);
          }
        } else if (error) {
          console.error('Error fetching user ID:', error);
        }
      }
    };
    fetchUserId();
  }, []);

  // Fetch highlights
  const fetchHighlights = useCallback(async () => {
    if (!currentUserId) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_highlights')
        .select('*')
        .eq('user_id', currentUserId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHighlights(data || []);

      // Fetch lead details for each highlight
      if (data && data.length > 0) {
        const leadsPromises = data.map(async (highlight) => {
          if (highlight.new_lead_id) {
            // New lead
            const { data: leadData, error: leadError } = await supabase
              .from('leads')
              .select(`
                id,
                lead_number,
                name,
                created_at,
                topic,
                stage,
                misc_category (
                  name,
                  misc_maincategory (
                    name
                  )
                )
              `)
              .eq('id', highlight.new_lead_id)
              .single();

            if (leadError) {
              console.error('Error fetching new lead:', leadError);
              return null;
            }

            const categoryData = Array.isArray(leadData.misc_category) 
              ? leadData.misc_category[0] 
              : leadData.misc_category;

            return {
              id: leadData.id,
              lead_number: leadData.lead_number || '',
              name: leadData.name || '',
              created_at: leadData.created_at || '',
              category: (categoryData as any)?.name || null,
              source: null,
              language: null,
              topic: leadData.topic || null,
              stage: leadData.stage || null,
              lead_type: 'new' as const,
              display_lead_number: leadData.lead_number || '',
              misc_category: categoryData || undefined,
              comment: highlight.comment || null,
              comment_updated_at: highlight.comment_updated_at || null,
            };
          } else if (highlight.lead_id) {
            // Legacy lead
            const { data: leadData, error: leadError } = await supabase
              .from('leads_lead')
              .select(`
                id,
                lead_number,
                name,
                cdate,
                topic,
                stage,
                status,
                category_id,
                source_id,
                language_id,
                misc_category:category_id (
                  name,
                  misc_maincategory (
                    name
                  )
                ),
                misc_leadsource:source_id (
                  name
                ),
                misc_language!fk_leads_lead_language_id (
                  name
                )
              `)
              .eq('id', highlight.lead_id)
              .single();

            if (leadError) {
              console.error('Error fetching legacy lead:', leadError);
              return null;
            }

            const legacyCategoryData = Array.isArray(leadData.misc_category)
              ? leadData.misc_category[0]
              : leadData.misc_category;

            return {
              id: `legacy_${leadData.id}`,
              lead_number: leadData.lead_number ? String(leadData.lead_number) : String(leadData.id),
              name: leadData.name || '',
              created_at: leadData.cdate || '',
              category: (legacyCategoryData as any)?.name || null,
              source: (leadData.misc_leadsource as any)?.name || null,
              language: (leadData.misc_language as any)?.name || null,
              topic: leadData.topic || null,
              stage: leadData.stage || null,
              lead_type: 'legacy' as const,
              display_lead_number: leadData.lead_number ? String(leadData.lead_number) : String(leadData.id),
              status: leadData.status || undefined,
              misc_category: legacyCategoryData || undefined,
              comment: highlight.comment || null,
              comment_updated_at: highlight.comment_updated_at || null,
            };
          }
          return null;
        });

        const leads = await Promise.all(leadsPromises);
        setHighlightLeads(leads.filter((lead) => lead !== null) as HighlightLead[]);
      } else {
        setHighlightLeads([]);
      }
    } catch (error: any) {
      console.error('Error fetching highlights:', error);
      toast.error('Failed to load highlights');
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (isOpen && currentUserId) {
      fetchHighlights();
    }
  }, [isOpen, currentUserId, fetchHighlights]);

  // Listen for highlight events to refresh
  useEffect(() => {
    const handleHighlightChange = () => {
      if (isOpen && currentUserId) {
        fetchHighlights();
      }
    };

    window.addEventListener('highlights:added', handleHighlightChange);
    window.addEventListener('highlights:removed', handleHighlightChange);

    return () => {
      window.removeEventListener('highlights:added', handleHighlightChange);
      window.removeEventListener('highlights:removed', handleHighlightChange);
    };
  }, [isOpen, currentUserId, fetchHighlights]);

  // Remove highlight
  const handleRemoveHighlight = async (highlightId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { error } = await supabase
        .from('user_highlights')
        .delete()
        .eq('id', highlightId);

      if (error) throw error;

      toast.success('Removed from highlights');
      fetchHighlights();
    } catch (error: any) {
      console.error('Error removing highlight:', error);
      toast.error('Failed to remove highlight');
    }
  };

  // Open comment modal
  const handleOpenCommentModal = (highlightId: number, currentComment: string | null, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedHighlightId(highlightId);
    setCommentText(currentComment || '');
    setCommentModalOpen(true);
  };

  // Save comment
  const handleSaveComment = async () => {
    if (selectedHighlightId === null) return;

    setIsSavingComment(true);
    try {
      const commentValue = commentText.trim() || null;
      const updateData: any = {
        comment: commentValue,
      };
      
      if (commentValue) {
        updateData.comment_updated_at = new Date().toISOString();
      } else {
        updateData.comment_updated_at = null;
      }

      console.log('Saving comment:', { highlightId: selectedHighlightId, updateData });

      const { data, error } = await supabase
        .from('user_highlights')
        .update(updateData)
        .eq('id', selectedHighlightId)
        .select();

      if (error) {
        console.error('Error saving comment to database:', error);
        throw error;
      }

      console.log('Comment saved successfully:', data);

      toast.success('Comment saved');
      setCommentModalOpen(false);
      setSelectedHighlightId(null);
      setCommentText('');
      
      // Refetch to ensure data is in sync
      await fetchHighlights();
    } catch (error: any) {
      console.error('Error saving comment:', error);
      toast.error(`Failed to save comment: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSavingComment(false);
    }
  };

  // Format comment timestamp
  const formatCommentTimestamp = (timestamp: string | null | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Helper function to calculate contrasting text color based on background
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
    return luminance > 0.6 ? '#111827' : '#ffffff';
  };

  // Get stage badge
  const getStageBadge = (stage: string | number | null | undefined) => {
    if (!stage && stage !== 0) return null;
    
    // Convert stage to string for getStageName/getStageColour (handles both numeric IDs and stage names)
    const stageStr = String(stage);
    
    // Get stage name and color from stageUtils
    const stageName = getStageName(stageStr);
    const stageColour = getStageColour(stageStr);
    const badgeTextColour = getContrastingTextColor(stageColour);
    
    // Use dynamic color if available, otherwise fallback to default purple
    const backgroundColor = stageColour || '#3f28cd';
    const textColor = stageColour ? badgeTextColour : '#ffffff';
    
    return (
      <span 
        className="badge hover:opacity-90 transition-opacity duration-200 text-xs px-3 py-1 max-w-full"
        style={{
          backgroundColor: backgroundColor,
          borderColor: backgroundColor,
          color: textColor,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block'
        }}
        title={stageName}
      >
        {stageName}
      </span>
    );
  };

  // Render lead card
  const renderLeadCard = (lead: HighlightLead) => {
    const isLegacyInactive = lead.lead_type === 'legacy' && lead.status && Number(lead.status) === 10;

    const cardClasses = [
      'card',
      'shadow-lg',
      'hover:shadow-2xl',
      'transition-all',
      'duration-300',
      'ease-in-out',
      'transform',
      'hover:-translate-y-1',
      'cursor-pointer',
      'group',
      'border',
      'relative',
      isLegacyInactive ? 'bg-red-50 border-red-200' : 'bg-base-100 border-base-200',
    ].join(' ');

    // Format category display with main and subcategory together
    let displayCategory: string | null = null;
    if (typeof lead.category === 'string' && lead.category.includes('(')) {
      displayCategory = lead.category;
    } else if (lead.misc_category) {
      const categoryObj = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
      const categoryName = (categoryObj as any)?.name;
      const mainCategory = (categoryObj as any)?.misc_maincategory;
      const mainName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
      
      if (categoryName) {
        displayCategory = mainName
          ? `${categoryName} (${mainName})`
          : categoryName;
      } else {
        displayCategory = lead.category || null;
      }
    } else {
      displayCategory = lead.category || null;
    }

    // Find highlight ID for this lead
    const highlight = highlights.find(
      h => (lead.lead_type === 'new' && h.new_lead_id === lead.id) ||
           (lead.lead_type === 'legacy' && h.lead_id === parseInt(lead.id.replace('legacy_', '')))
    );

    return (
      <div
        key={lead.id}
        className={cardClasses}
        onClick={() => navigate(`/clients/${lead.lead_number || lead.id}`)}
      >
        <div className="card-body p-5 relative">
          {/* Remove button */}
          {highlight && (
            <button
              onClick={(e) => handleRemoveHighlight(highlight.id, e)}
              className="absolute top-3 right-3 btn btn-ghost btn-sm btn-circle z-10"
              title="Remove from highlights"
            >
              <XMarkIcon className="w-5 h-5 text-gray-500 hover:text-red-500" />
            </button>
          )}

          {isLegacyInactive && (
            <span className="badge badge-xs absolute top-1 left-3 bg-white border-red-400 text-red-500 shadow-sm">
              Not active
            </span>
          )}

          {/* Badge on top alone */}
          <div className="mb-3">
            {getStageBadge(lead.stage)}
          </div>

          {/* Client name below badge */}
          <h2 className="card-title text-xl font-bold group-hover:text-primary transition-colors mb-2">
            {lead.name}
          </h2>

          <p className="text-sm text-base-content/60 font-mono mb-4">
            #{lead.display_lead_number || lead.lead_number || lead.id}
          </p>

          <div className="divider my-0"></div>

          <div className="text-sm mt-4 space-y-3">
            {/* Category - alone in first row */}
            <div className="flex items-center gap-2" title="Category">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="truncate" title={displayCategory || 'N/A'}>{displayCategory || 'N/A'}</span>
            </div>
            
            {/* Source and Language - second row */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="flex items-center gap-2" title="Source">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>{lead.source || 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2" title="Language">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                <span>{lead.language || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-base-200/50">
            <p className="text-sm font-semibold text-base-content/80">{lead.topic || 'No topic specified'}</p>
          </div>

          {/* Comment section */}
          <div className="mt-4 pt-4 border-t border-base-200/50 pb-12 min-h-[60px] relative">
            {lead.comment && lead.comment.trim() ? (
              <div className="mb-3">
                <p className="text-sm text-base-content/80 whitespace-pre-wrap break-words">{lead.comment}</p>
                {lead.comment_updated_at && (
                  <p className="text-xs text-base-content/50 mt-2">
                    {formatCommentTimestamp(lead.comment_updated_at)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-base-content/40 italic">No comment yet</p>
            )}
            
            {/* Comment button - always visible if highlight exists */}
            {highlight && (
              <button
                onClick={(e) => handleOpenCommentModal(highlight.id, lead.comment || null, e)}
                className="btn btn-circle btn-sm btn-ghost absolute bottom-3 right-3 z-10"
                title={lead.comment ? 'Edit comment' : 'Add comment'}
              >
                <ChatBubbleLeftRightIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Get unique categories (with main and subcategory combined)
  const getUniqueCategories = () => {
    const categories = new Set<string>();
    highlightLeads.forEach(lead => {
      if (lead.category && typeof lead.category === 'string' && lead.category.includes('(')) {
        categories.add(lead.category);
      } else if (lead.misc_category) {
        const categoryObj = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
        const categoryName = (categoryObj as any)?.name;
        const mainCategory = (categoryObj as any)?.misc_maincategory;
        const mainName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
        
        if (categoryName) {
          const displayCategory = mainName
            ? `${categoryName} (${mainName})`
            : categoryName;
          categories.add(displayCategory);
        }
      } else if (lead.category) {
        categories.add(lead.category);
      }
    });
    return Array.from(categories).sort();
  };
  
  // Helper function to get initials from name
  const getInitials = (name: string) => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getUniqueLanguages = () => {
    const languages = new Set<string>();
    highlightLeads.forEach(lead => {
      if (lead.language) {
        languages.add(lead.language);
      }
    });
    return Array.from(languages).sort();
  };

  // Filter leads based on search query, category, and language
  const filteredLeads = highlightLeads.filter(lead => {
    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = (
        lead.name?.toLowerCase().includes(query) ||
        lead.lead_number?.toLowerCase().includes(query) ||
        lead.topic?.toLowerCase().includes(query) ||
        lead.category?.toLowerCase().includes(query)
      );
      if (!matchesSearch) return false;
    }

    // Category filter (main and subcategory combined)
    if (categoryFilter) {
      let leadCategory = '';
      
      if (lead.category && typeof lead.category === 'string' && lead.category.includes('(')) {
        leadCategory = lead.category;
      } else if (lead.misc_category) {
        const categoryObj = Array.isArray(lead.misc_category) ? lead.misc_category[0] : lead.misc_category;
        const categoryName = (categoryObj as any)?.name;
        const mainCategory = (categoryObj as any)?.misc_maincategory;
        const mainName = Array.isArray(mainCategory) ? mainCategory[0]?.name : mainCategory?.name;
        
        if (categoryName) {
          leadCategory = mainName
            ? `${categoryName} (${mainName})`
            : categoryName;
        }
      } else if (lead.category) {
        leadCategory = lead.category;
      }
      
      if (leadCategory !== categoryFilter) return false;
    }

    // Language filter
    if (languageFilter) {
      if (lead.language !== languageFilter) return false;
    }

    return true;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div className="fixed right-0 top-0 h-full w-full md:w-[600px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <StarIconSolid className="w-6 h-6" style={{ color: '#3E28CD' }} />
              <h2 className="text-2xl font-bold text-gray-900">My Highlights</h2>
              {currentUserEmployeeName && (
                <div className="flex items-center gap-2 md:gap-4 ml-2">
                  {currentUserEmployeePhoto ? (
                    <img
                      src={currentUserEmployeePhoto}
                      alt={currentUserEmployeeName}
                      className="w-10 h-10 md:w-16 md:h-16 rounded-full object-cover border-2 border-gray-200"
                    />
                  ) : (
                    <div className="w-10 h-10 md:w-16 md:h-16 rounded-full bg-primary text-primary-content flex items-center justify-center text-sm md:text-lg font-semibold border-2 border-gray-200">
                      {getInitials(currentUserEmployeeName)}
                    </div>
                  )}
                  <span className="text-sm md:text-lg font-semibold text-gray-700">{currentUserEmployeeName}</span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-circle"
              title="Close"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search highlights..."
              className="input input-bordered w-full pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label py-1">
                <span className="label-text text-xs font-semibold">Category</span>
              </label>
              <select
                className="select select-bordered w-full text-sm"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {getUniqueCategories().map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label py-1">
                <span className="label-text text-xs font-semibold">Language</span>
              </label>
              <select
                className="select select-bordered w-full text-sm"
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value)}
              >
                <option value="">All Languages</option>
                {getUniqueLanguages().map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Clear filters button */}
          {(categoryFilter || languageFilter) && (
            <button
              onClick={() => {
                setCategoryFilter('');
                setLanguageFilter('');
              }}
              className="btn btn-ghost btn-sm mt-2 w-full"
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : filteredLeads.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <StarIcon className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium mb-2">
                {searchQuery ? 'No highlights match your search' : 'No highlights yet'}
              </p>
              <p className="text-sm">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Add leads to your highlights to see them here'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredLeads.map(renderLeadCard)}
            </div>
          )}
        </div>
      </div>

      {/* Comment Modal */}
      {commentModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => {
              setCommentModalOpen(false);
              setSelectedHighlightId(null);
              setCommentText('');
            }}
          />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-semibold mb-4">Add Comment</h3>
            <textarea
              className="textarea textarea-bordered w-full h-32 mb-4"
              placeholder="Enter your comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setCommentModalOpen(false);
                  setSelectedHighlightId(null);
                  setCommentText('');
                }}
                disabled={isSavingComment}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveComment}
                disabled={isSavingComment}
              >
                {isSavingComment ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HighlightsPanel;

