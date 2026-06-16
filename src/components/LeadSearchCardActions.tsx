import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  DocumentTextIcon,
  EllipsisVerticalIcon,
  LinkIcon,
  StarIcon,
  UserGroupIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import type { Lead } from '../lib/supabase';
import { addToHighlights } from '../lib/highlightsUtils';
import {
  buildLeadClientAbsoluteUrl,
  buildLeadClientPath,
  getLeadHighlightMeta,
} from '../lib/leadClientRoute';

type LeadSearchCardActionsProps = {
  lead: Lead;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onViewFacts: (lead: Lead) => void;
  onViewRoles: (lead: Lead) => void;
};

const MOBILE_MENU_OPTIONS = [
  { value: '', label: 'Choose action…' },
  { value: 'share', label: 'Share' },
  { value: 'client', label: 'Client page' },
  { value: 'facts', label: 'Facts' },
  { value: 'roles', label: 'Roles' },
  { value: 'highlight', label: 'Highlight' },
] as const;

const LeadSearchCardActions: React.FC<LeadSearchCardActionsProps> = ({
  lead,
  isOpen,
  onOpenChange,
  onViewFacts,
  onViewRoles,
}) => {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const nativeSelectRef = useRef<HTMLSelectElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, isMobile, onOpenChange]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const runShare = useCallback(async () => {
    const url = buildLeadClientAbsoluteUrl(lead);
    if (!url) {
      toast.error('Could not build client link');
      return;
    }
    close();
    try {
      if (isMobile && typeof navigator.share === 'function') {
        await navigator.share({ title: lead.name || 'Client', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Client link copied to clipboard');
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error(err);
      toast.error('Failed to copy link');
    }
  }, [close, isMobile, lead]);

  const runClientPage = useCallback(() => {
    const path = buildLeadClientPath(lead);
    if (!path) {
      toast.error('Could not open client page');
      return;
    }
    close();
    navigate(path);
  }, [close, lead, navigate]);

  const runHighlight = useCallback(async () => {
    const { isLegacy, highlightId, leadNumber } = getLeadHighlightMeta(lead);
    if (!highlightId) {
      toast.error('Could not add to highlights');
      return;
    }
    close();
    await addToHighlights(highlightId, leadNumber, isLegacy);
  }, [close, lead]);

  const runFacts = useCallback(() => {
    close();
    onViewFacts(lead);
  }, [close, lead, onViewFacts]);

  const runRoles = useCallback(() => {
    close();
    onViewRoles(lead);
  }, [close, lead, onViewRoles]);

  const handleMobileMenuPick = useCallback(
    (value: string) => {
      switch (value) {
        case 'share':
          void runShare();
          break;
        case 'client':
          runClientPage();
          break;
        case 'facts':
          runFacts();
          break;
        case 'roles':
          runRoles();
          break;
        case 'highlight':
          void runHighlight();
          break;
        default:
          break;
      }
    },
    [runClientPage, runFacts, runHighlight, runRoles, runShare],
  );

  const menuSections = (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          void runShare();
        }}
      >
        <LinkIcon className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
        Share
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          runClientPage();
        }}
      >
        <UserIcon className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
        Client page
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          runFacts();
        }}
      >
        <DocumentTextIcon className="h-5 w-5 shrink-0 text-violet-600" aria-hidden />
        Facts
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          runRoles();
        }}
      >
        <UserGroupIcon className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
        Roles
      </button>
      <div className="my-1 border-t border-gray-100" role="separator" />
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50 active:bg-gray-100"
        onClick={(e) => {
          e.stopPropagation();
          void runHighlight();
        }}
      >
        <StarIcon className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
        Highlight
      </button>
    </>
  );

  return (
    <div ref={menuRef} className="relative z-20 shrink-0">
      {isMobile ? (
        <>
          <label className="sr-only" htmlFor={`lead-card-actions-${lead.id}`}>
            Actions for {lead.name}
          </label>
          <div className="relative inline-flex h-10 w-10 items-center justify-center text-gray-500">
            <EllipsisVerticalIcon className="h-6 w-6 pointer-events-none" aria-hidden />
            <select
              ref={nativeSelectRef}
              id={`lead-card-actions-${lead.id}`}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value=""
              onChange={(e) => {
                e.stopPropagation();
                const value = e.target.value;
                handleMobileMenuPick(value);
                e.target.value = '';
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {MOBILE_MENU_OPTIONS.map((opt) => (
                <option key={opt.value || 'placeholder'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center text-gray-500 transition-colors hover:text-gray-800"
          aria-label={`Actions for ${lead.name}`}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(!isOpen);
          }}
        >
          <EllipsisVerticalIcon className="h-6 w-6" aria-hidden />
        </button>
      )}

      {isOpen && !isMobile && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {menuSections}
        </div>
      )}

    </div>
  );
};

export default LeadSearchCardActions;
