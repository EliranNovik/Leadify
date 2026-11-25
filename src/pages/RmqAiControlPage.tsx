import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { HandThumbDownIcon, HandThumbUpIcon } from '@heroicons/react/24/solid';
import { toast } from 'react-hot-toast';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { resolveEmployeePhotoUrl, toEmployeeAvatarSrc } from '../lib/employeePhotoUrl';
import { supabase } from '../lib/supabase';
import { parseChatSummary } from '../lib/rmqAiV1/chatSummary';
import { reviewMemoryUse, type MemoryUseReview } from '../lib/rmqAiV1/memoryCheck';
import { GradientSummaryCard, REPORT_SUMMARY_GRADIENTS } from '../components/reports/GradientSummaryCard';
import {
  currentRmqAiVersions,
  deleteChatGuide,
  deleteKnowledgeFile,
  getKnowledgePreview,
  getKnowledgeText,
  ingestKnowledgeText,
  replaceKnowledgeText,
  knowledgeNeedsReview,
  listChatGuides,
  listFirmLessonCandidates,
  loadLessonChatEvidence,
  listKnowledgeFiles,
  promoteKnowledgeToFirm,
  reviewFirmLesson,
  RMQ_AI_EVAL_CASES,
  saveChatGuide,
  setChatGuideActive,
  runDeterministicEvalSuite,
  setKnowledgeStatus,
  type ChatGuideCategory,
  type ChatGuideRow,
  type KnowledgeFileRow,
  type LessonChatEvidence,
} from '../lib/rmqAiV1';

type FeedbackPerson = {
  userId: string;
  name: string;
  photo: string | null;
  count: number;
  lastAt: string | null;
  reasons: string[];
};

type ControlTab = 'overview' | 'quality' | 'observe' | 'model' | 'knowledge' | 'guides' | 'lessons';

const CONTROL_TABS: { id: ControlTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'quality', label: 'Quality' },
  { id: 'observe', label: 'Observe' },
  { id: 'model', label: 'Model' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'guides', label: 'Rules' },
  { id: 'lessons', label: 'Lessons' },
];

const GUIDE_TABS: { id: ChatGuideCategory; label: string; hint: string }[] = [
  { id: 'rule', label: 'Rules', hint: 'Hard limits the assistant follows on every reply.' },
  { id: 'behavior', label: 'Behaviour', hint: 'How it should talk, decide, and ask before acting.' },
  { id: 'service', label: 'Service', hint: 'What this assistant is for, and what it should offer.' },
];

const PURPOSE_LABELS = [
  'meeting',
  'contract',
  'follow-up',
  'draft',
  'presence',
  'signed',
  'payment',
  'expenses',
  'calendar',
] as const;

type UsageChat = {
  user_id: string | null;
  message_count: number | null;
  lead_id: string | null;
  tags: string[] | null;
  summary: string | null;
  updated_at: string | null;
};

const QUALITY_EVENT_LABEL: Record<string, string> = {
  unexpected_tool: 'Wrong tool',
  resolver_mismatch: 'Wrong client',
  conflicting_tool_results: 'Conflicting answers',
  answer_without_required_tool: 'Answer without a lookup',
  write_without_clear_target: 'Write without a clear client',
  tool_error: 'Tool error',
  high_latency: 'Slow reply',
  empty_result: 'Empty answer',
  user_correction: 'User correction',
  possible_user_correction: 'Possible correction',
  memory_missed: 'Forgot a saved preference',
  memory_not_loaded: 'Preferences were not loaded',
};

function memoryStatusLabel(status: MemoryUseReview['status']): string {
  if (status === 'used') return 'Used';
  if (status === 'missed') return 'Missed';
  if (status === 'not_sent') return 'Not sent';
  if (status === 'not_checked') return 'Not checked';
  return 'Not tested';
}

function memoryStatusClass(status: MemoryUseReview['status']): string {
  if (status === 'used') return 'text-emerald-600';
  if (status === 'missed' || status === 'not_sent') return 'text-red-600';
  if (status === 'not_checked') return 'text-amber-600';
  return 'text-gray-400';
}

const FEEDBACK_REASON_LABEL: Record<string, string> = {
  wrong_data: 'Wrong data',
  wrong_client: 'Wrong client',
  wrong_tool: 'Wrong tool',
  bad_draft: 'Bad draft',
  too_long: 'Too long',
  too_short: 'Too short',
  other: 'Other',
};

type EmployeeUser = {
  auth_id?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  tenants_employee?:
    | { display_name?: string | null; official_name?: string | null; photo_url?: string | null; photo?: string | null }
    | { display_name?: string | null; official_name?: string | null; photo_url?: string | null; photo?: string | null }[]
    | null;
};

const EMPLOYEE_PROFILE_SELECT =
  'auth_id, full_name, first_name, last_name, tenants_employee!employee_id(display_name, official_name, photo_url, photo)';

function employeeRecord(user: EmployeeUser) {
  return Array.isArray(user.tenants_employee) ? user.tenants_employee[0] : user.tenants_employee;
}

function employeeName(user: EmployeeUser): string {
  const employee = employeeRecord(user);
  return (
    employee?.display_name?.trim() ||
    employee?.official_name?.trim() ||
    user.full_name?.trim() ||
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
    'Unknown employee'
  );
}

function employeePhoto(user: EmployeeUser): string | null {
  const employee = employeeRecord(user);
  return resolveEmployeePhotoUrl(employee?.photo_url, employee?.photo);
}

function formatFeedbackWhen(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function purposeOfChat(row: UsageChat): string[] {
  const summary = parseChatSummary(row.summary);
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const topics = new Set([...(summary?.topics || []), ...tags.map(String)]);
  const matched = PURPOSE_LABELS.filter((topic) => topics.has(topic));
  return matched.length > 0 ? [...matched] : ['other'];
}

function usageByEmployee(rows: UsageChat[], names: Record<string, string>, photos: Record<string, string | null>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = row.user_id || 'unknown';
    totals.set(id, (totals.get(id) || 0) + Math.max(0, Number(row.message_count) || 0));
  }
  return [...totals.entries()]
    .map(([id, messages]) => ({
      name: id === 'unknown' ? 'Unknown' : names[id] || 'Unknown',
      photo: id === 'unknown' ? null : photos[id] || null,
      messages,
    }))
    .filter((row) => row.messages > 0)
    .sort((a, b) => b.messages - a.messages);
}

function usageWhere(rows: UsageChat[]) {
  let client = 0;
  let general = 0;
  for (const row of rows) {
    if (row.lead_id) client += 1;
    else general += 1;
  }
  return [
    { name: 'Client', chats: client },
    { name: 'General', chats: general },
  ].filter((row) => row.chats > 0);
}

function usagePurpose(rows: UsageChat[], onlyTopic = '') {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const topic of purposeOfChat(row)) {
      if (onlyTopic && topic !== onlyTopic) continue;
      totals.set(topic, (totals.get(topic) || 0) + 1);
    }
  }
  return [...totals.entries()]
    .map(([topic, chats]) => ({
      name: topic === 'other' ? 'Other' : topic.charAt(0).toUpperCase() + topic.slice(1),
      chats,
    }))
    .sort((a, b) => b.chats - a.chats);
}

async function loadFeedbackPeople(rating: 'up' | 'down'): Promise<FeedbackPerson[]> {
  const { data, error } = await supabase
    .from('ai_feedback')
    .select('user_id, created_at, reason')
    .eq('rating', rating)
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  const grouped = new Map<string, { count: number; lastAt: string | null; reasons: Set<string> }>();
  for (const row of data) {
    const id = typeof row.user_id === 'string' && row.user_id ? row.user_id : 'unknown';
    const current = grouped.get(id) || { count: 0, lastAt: null, reasons: new Set<string>() };
    current.count += 1;
    if (!current.lastAt && typeof row.created_at === 'string') current.lastAt = row.created_at;
    if (typeof row.reason === 'string' && row.reason) {
      current.reasons.add(FEEDBACK_REASON_LABEL[row.reason] || row.reason);
    }
    grouped.set(id, current);
  }

  const ids = [...grouped.keys()].filter((id) => id !== 'unknown');
  const names: Record<string, string> = {};
  const photos: Record<string, string | null> = {};
  if (ids.length > 0) {
    const { data: users } = await supabase.from('users').select(EMPLOYEE_PROFILE_SELECT).in('auth_id', ids);
    for (const user of (users || []) as EmployeeUser[]) {
      const authId = typeof user.auth_id === 'string' ? user.auth_id : '';
      if (authId) {
        names[authId] = employeeName(user);
        photos[authId] = employeePhoto(user);
      }
    }
  }

  return [...grouped.entries()]
    .map(([userId, row]) => ({
      userId,
      name: userId === 'unknown' ? 'Unknown employee' : names[userId] || 'Unknown employee',
      photo: userId === 'unknown' ? null : photos[userId] || null,
      count: row.count,
      lastAt: row.lastAt,
      reasons: [...row.reasons],
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export default function RmqAiControlPage() {
  const evalSuite = useMemo(() => runDeterministicEvalSuite(), []);
  const versions = useMemo(() => currentRmqAiVersions(), []);
  const [feedback, setFeedback] = useState({ up: 0, down: 0 });
  const [memories, setMemories] = useState(0);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRow[]>([]);
  const [lessons, setLessons] = useState(0);
  const [candidates, setCandidates] = useState<
    Array<{ id: string; fact: string; evidence_count: number; created_at?: string }>
  >([]);
  const [lessonEvidence, setLessonEvidence] = useState<Record<string, LessonChatEvidence[]>>({});
  const [lessonEvidenceLoading, setLessonEvidenceLoading] = useState(false);
  const [previewById, setPreviewById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedbackModal, setFeedbackModal] = useState<'up' | 'down' | null>(null);
  const [feedbackPeople, setFeedbackPeople] = useState<FeedbackPerson[]>([]);
  const [feedbackPeopleLoading, setFeedbackPeopleLoading] = useState(false);
  const [tab, setTab] = useState<ControlTab>('overview');
  const [knowledgeDraft, setKnowledgeDraft] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [usageChats, setUsageChats] = useState<UsageChat[]>([]);
  const [usageNames, setUsageNames] = useState<Record<string, string>>({});
  const [usagePhotos, setUsagePhotos] = useState<Record<string, string | null>>({});
  const [qualityProblems, setQualityProblems] = useState<Array<{ name: string; count: number }>>([]);
  const [qualityRecent, setQualityRecent] = useState<Array<{ name: string; at: string }>>([]);
  const [remembered, setRemembered] = useState<
    Array<{
      id: string;
      userId: string;
      fact: string;
      category: string;
      at: string | null;
      name: string;
      photo: string | null;
      review: MemoryUseReview;
    }>
  >([]);
  const [guides, setGuides] = useState<ChatGuideRow[]>([]);
  const [guideCategory, setGuideCategory] = useState<ChatGuideCategory>('rule');
  const [guideDraft, setGuideDraft] = useState<{ id: string | null; title: string; body: string } | null>(null);
  const [guideSaving, setGuideSaving] = useState(false);
  const [usageBlocked, setUsageBlocked] = useState(false);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOnClickAway = (event: PointerEvent) => {
      const target = event.target;
      pageRef.current?.querySelectorAll('details[open]').forEach((menu) => {
        if (target instanceof Node && menu.contains(target)) return;
        menu.removeAttribute('open');
      });
    };
    document.addEventListener('pointerdown', closeOnClickAway);
    return () => document.removeEventListener('pointerdown', closeOnClickAway);
  }, []);

  const refresh = useCallback(async () => {
    const [up, down, mem, files, pending] = await Promise.all([
      supabase.from('ai_feedback').select('id', { count: 'exact', head: true }).eq('rating', 'up'),
      supabase.from('ai_feedback').select('id', { count: 'exact', head: true }).eq('rating', 'down'),
      supabase.from('ai_user_memory').select('id', { count: 'exact', head: true }).eq('active', true),
      listKnowledgeFiles(),
      supabase.from('ai_firm_lesson_candidates').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    setFeedback({ up: up.count || 0, down: down.count || 0 });
    setMemories(mem.count || 0);
    setKnowledgeFiles(files);
    setLessons(pending.count || 0);
    setCandidates(await listFirmLessonCandidates());
    setGuides(await listChatGuides());

    const [events, downs] = await Promise.all([
      supabase.from('ai_quality_events').select('event_name, created_at').order('created_at', { ascending: false }).limit(500),
      supabase.from('ai_feedback').select('reason, created_at').eq('rating', 'down').order('created_at', { ascending: false }).limit(200),
    ]);
    const problemTotals = new Map<string, number>();
    const recent: Array<{ name: string; at: string }> = [];
    for (const row of events.data || []) {
      const label = QUALITY_EVENT_LABEL[String(row.event_name)] || String(row.event_name || 'Problem');
      problemTotals.set(label, (problemTotals.get(label) || 0) + 1);
      if (recent.length < 8 && typeof row.created_at === 'string') recent.push({ name: label, at: row.created_at });
    }
    for (const row of downs.data || []) {
      const reason = typeof row.reason === 'string' && row.reason ? FEEDBACK_REASON_LABEL[row.reason] || row.reason : 'No reason';
      const label = `Thumbs down · ${reason}`;
      problemTotals.set(label, (problemTotals.get(label) || 0) + 1);
    }
    setQualityProblems(
      [...problemTotals.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    );
    setQualityRecent(recent);

    const memoryRows = await supabase
      .from('ai_user_memory')
      .select('id, user_id, fact, category, durability, expires_at, updated_at, created_at')
      .eq('active', true)
      .order('updated_at', { ascending: false })
      .limit(200);
    const memoryData = (memoryRows.data || []).filter((row) => {
      const fact = String(row.fact || '').trim();
      if (!fact || fact.startsWith('Recent work:')) return false;
      if (typeof row.expires_at === 'string' && Date.parse(row.expires_at) <= Date.now()) return false;
      return true;
    });
    const memoryUserIds = [...new Set(memoryData.map((row) => String(row.user_id || '')).filter(Boolean))];
    const memoryNames: Record<string, string> = {};
    const memoryPhotos: Record<string, string | null> = {};
    if (memoryUserIds.length > 0) {
      const { data: users } = await supabase.from('users').select(EMPLOYEE_PROFILE_SELECT).in('auth_id', memoryUserIds);
      for (const user of (users || []) as EmployeeUser[]) {
        const authId = typeof user.auth_id === 'string' ? user.auth_id : '';
        if (!authId) continue;
        memoryNames[authId] = employeeName(user);
        memoryPhotos[authId] = employeePhoto(user);
      }
    }
    const memoryInputs = memoryData.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id || ''),
      fact: String(row.fact || '').trim(),
      at: typeof row.updated_at === 'string' ? row.updated_at : typeof row.created_at === 'string' ? row.created_at : null,
    }));
    let memoryChats: Array<{ userId: string; at: string | null; userText: string; answer: string }> = [];
    if (memoryUserIds.length > 0) {
      const chatRows = await supabase
        .from('ai_chat_history')
        .select('user_id, updated_at, messages')
        .in('user_id', memoryUserIds)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(150);
      memoryChats = (chatRows.data || []).map((row) => {
        const messages = (Array.isArray(row.messages) ? row.messages : []) as Array<{ role?: string; content?: unknown }>;
        let userText = '';
        let answer = '';
        for (const message of messages) {
          const content = message?.content;
          const text = (typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((part: { text?: string }) => part?.text || '').join(' ')
              : ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          if (!text || text === 'AI is thinking...' || text === 'Looking up CRM data...') continue;
          if (message?.role === 'user') userText = text;
          if (message?.role === 'assistant') answer = text;
        }
        return {
          userId: String(row.user_id || ''),
          at: typeof row.updated_at === 'string' ? row.updated_at : null,
          userText,
          answer,
        };
      });
    }
    const reviews = reviewMemoryUse(memoryInputs, memoryChats);
    setRemembered(
      memoryInputs.map((row) => ({
        id: row.id,
        userId: row.userId,
        fact: row.fact,
        category: String(memoryData.find((item) => String(item.id) === row.id)?.category || 'preference'),
        at: row.at,
        name: memoryNames[row.userId] || 'Employee',
        photo: memoryPhotos[row.userId] || null,
        review: reviews[row.id] || { status: 'waiting', note: 'No later chat to test this yet.' },
      })),
    );

    const chats = await supabase
      .from('ai_chat_history')
      .select('user_id, message_count, lead_id, tags, summary, updated_at')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false })
      .limit(1000);
    if (chats.error) {
      setUsageChats([]);
      setUsageBlocked(true);
      return;
    }
    const rows = (chats.data || []) as UsageChat[];
    setUsageBlocked(false);
    setUsageChats(rows);
    const ids = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) {
      setUsageNames({});
      setUsagePhotos({});
      return;
    }
    const { data: users } = await supabase.from('users').select(EMPLOYEE_PROFILE_SELECT).in('auth_id', ids);
    const names: Record<string, string> = {};
    const photos: Record<string, string | null> = {};
    for (const user of (users || []) as EmployeeUser[]) {
      const authId = typeof user.auth_id === 'string' ? user.auth_id : '';
      if (authId) {
        names[authId] = employeeName(user);
        photos[authId] = employeePhoto(user);
      }
    }
    setUsageNames(names);
    setUsagePhotos(photos);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (tab !== 'lessons' || candidates.length === 0) return;
    let cancelled = false;
    setLessonEvidenceLoading(true);
    void loadLessonChatEvidence(candidates.map((row) => row.fact)).then((found) => {
      if (cancelled) return;
      setLessonEvidence(found);
      setLessonEvidenceLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, candidates]);

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const filteredRemembered = useMemo(() => {
    return remembered.filter((row) => {
      if (filterEmployee && row.userId !== filterEmployee) return false;
      const day = (row.at || '').slice(0, 10);
      if (filterFrom && (!day || day < filterFrom)) return false;
      if (filterTo && (!day || day > filterTo)) return false;
      return true;
    });
  }, [remembered, filterEmployee, filterFrom, filterTo]);
  const filteredUsageChats = useMemo(() => {
    return usageChats.filter((row) => {
      if (filterEmployee && String(row.user_id || '') !== filterEmployee) return false;
      const day = (row.updated_at || '').slice(0, 10);
      if (filterFrom && (!day || day < filterFrom)) return false;
      if (filterTo && (!day || day > filterTo)) return false;
      if (filterTopic && !purposeOfChat(row).includes(filterTopic)) return false;
      return true;
    });
  }, [usageChats, filterEmployee, filterFrom, filterTo, filterTopic]);
  const employeeOptions = useMemo(
    () =>
      Object.entries(usageNames)
        .map(([id, name]) => ({ id, name, photo: usagePhotos[id] || null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [usageNames, usagePhotos],
  );
  const employeeUsage = useMemo(
    () => usageByEmployee(filteredUsageChats, usageNames, usagePhotos),
    [filteredUsageChats, usageNames, usagePhotos],
  );
  const whereUsage = useMemo(() => usageWhere(filteredUsageChats), [filteredUsageChats]);
  const purposeUsage = useMemo(
    () => usagePurpose(filteredUsageChats, filterTopic),
    [filteredUsageChats, filterTopic],
  );

  const openKnowledgeDraft = () => {
    setTab('knowledge');
    setKnowledgeDraft({ id: null, title: '', body: '' });
  };

  const openKnowledgeEdit = (file: KnowledgeFileRow) => {
    setTab('knowledge');
    setKnowledgeDraft({ id: file.id, title: file.title, body: '' });
    setBusyId(file.id);
    void getKnowledgeText(file.id).then((text) => {
      setBusyId(null);
      setKnowledgeDraft((current) =>
        current?.id === file.id ? { id: file.id, title: file.title, body: text } : current,
      );
    });
  };

  const saveKnowledgeDraft = async () => {
    if (!knowledgeDraft) return;
    const title = knowledgeDraft.title.trim();
    const body = knowledgeDraft.body.trim();
    if (!title || !body) {
      toast.error('Add a title and the text.');
      return;
    }
    setKnowledgeSaving(true);
    if (knowledgeDraft.id) {
      const ok = await replaceKnowledgeText(knowledgeDraft.id, title, body);
      setKnowledgeSaving(false);
      if (!ok) {
        toast.error('Could not save the text. Run sql/2026-11-25_ai_knowledge_chunks_edit.sql');
        return;
      }
      toast.success('Text saved');
    } else {
      const result = await ingestKnowledgeText({ title, text: body, scope: 'firm' });
      setKnowledgeSaving(false);
      if (!result?.chunks) {
        toast.error('Could not save the file. Run the RMQ AI knowledge SQL first.');
        return;
      }
      toast.success('Added');
    }
    setKnowledgeDraft(null);
    void refresh();
  };

  const saveGuideDraft = async () => {
    if (!guideDraft) return;
    const title = guideDraft.title.trim();
    const body = guideDraft.body.trim();
    if (!title || !body) {
      toast.error('Add a title and the text.');
      return;
    }
    setGuideSaving(true);
    const result = await saveChatGuide({ id: guideDraft.id, category: guideCategory, title, body });
    setGuideSaving(false);
    if (!result.ok) {
      toast.error(
        result.missingTable
          ? 'Run sql/2026-11-25_ai_chat_guides.sql, then save again.'
          : 'Could not save. Superuser access is required.',
      );
      return;
    }
    toast.success(guideDraft.id ? 'Saved. The next chat uses this.' : 'Added. The next chat uses this.');
    setGuideDraft(null);
    void refresh();
  };

  const openFeedbackModal = async (rating: 'up' | 'down') => {
    setFeedbackModal(rating);
    setFeedbackPeople([]);
    setFeedbackPeopleLoading(true);
    try {
      setFeedbackPeople(await loadFeedbackPeople(rating));
    } finally {
      setFeedbackPeopleLoading(false);
    }
  };

  return (
    <div ref={pageRef} className="mx-auto w-full max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">RMQ AI Control Center</h1>
        <p className="mt-1 text-sm text-gray-500">
          Quality, versions, and knowledge. Firm-wide lessons still need a person to approve.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-white p-1 shadow-sm">
          {CONTROL_TABS.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setTab(item.id)}
                className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  selected ? 'bg-[#3b28c7] text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      <div className="flex justify-end gap-2">
        <label className="btn btn-sm cursor-pointer gap-1 rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-100">
          Upload
          <input
            type="file"
            accept=".txt,.md,.text"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void file.text().then(async (text) => {
                const result = await ingestKnowledgeText({ title: file.name, text, scope: 'firm' });
                if (result?.chunks) {
                  toast.success(`Saved ${result.chunks} firm knowledge chunks`);
                  setTab('knowledge');
                  void refresh();
                } else {
                  toast.error('Could not save the file. Run the RMQ AI knowledge SQL first.');
                }
              });
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-sm gap-1 rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
          onClick={openKnowledgeDraft}
        >
          <PlusIcon className="h-5 w-5" />
          Add
        </button>
      </div>
      </div>

      <div className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <EmployeeFilter people={employeeOptions} value={filterEmployee} onChange={setFilterEmployee} />
        <label className="block text-xs font-medium text-gray-500">
          From
          <input
            type="date"
            className="input input-bordered mt-1 w-full text-sm text-gray-900"
            value={filterFrom}
            onChange={(event) => setFilterFrom(event.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-gray-500">
          To
          <input
            type="date"
            className="input input-bordered mt-1 w-full text-sm text-gray-900"
            value={filterTo}
            onChange={(event) => setFilterTo(event.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-gray-500">
          Topic
          <select
            className="select select-bordered mt-1 w-full text-sm text-gray-900"
            value={filterTopic}
            onChange={(event) => setFilterTopic(event.target.value)}
          >
            <option value="">All topics</option>
            {PURPOSE_LABELS.map((topic) => (
              <option key={topic} value={topic}>
                {topic.charAt(0).toUpperCase() + topic.slice(1)}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      {tab === 'overview' ? (
        <>
          <UsageChart
            key={`employee-${filterEmployee}-${filterTopic}-${filterFrom}-${filterTo}`}
            title="Usage per employee"
            subtitle="Messages sent to RMQ AI."
            data={employeeUsage}
            dataKey="messages"
            showPhotos
            collapseAt={10}
            empty={usageBlocked ? 'Run sql/2026-11-25_ai_chat_history_superuser_read.sql to see every employee.' : 'No chats match these filters.'}
          />
          <section className="grid gap-3 lg:grid-cols-2">
            <UsageChart
              key={`where-${filterEmployee}-${filterTopic}-${filterFrom}-${filterTo}`}
              title="Where it is used"
              subtitle="Chats opened on a client, and chats with no client."
              data={whereUsage}
              dataKey="chats"
              color="#0f766e"
              empty={usageBlocked ? 'Run the chat history SQL to see every chat.' : 'No chats match these filters.'}
            />
            <UsageChart
              key={`topic-${filterEmployee}-${filterTopic}-${filterFrom}-${filterTo}`}
              title="What it is used for"
              subtitle="Topics the chats were about. One chat can count in more than one topic."
              data={purposeUsage}
              dataKey="chats"
              color="#b45309"
              empty={usageBlocked ? 'Run the chat history SQL to see every chat.' : 'No chats match these filters.'}
            />
          </section>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Eval pass" value={pct(evalSuite.overall)} />
        <Stat label="Critical fails" value={String(evalSuite.criticalFails)} />
        <Stat label="Can deploy" value={evalSuite.canDeploy ? 'Yes' : 'No'} />
        <Stat label="Architecture" value={versions.architectureVersion} />
      </section>
        </>
      ) : null}

      {tab === 'quality' ? (
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Quality</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500">
            These boxes count what was saved from real chats. The checklist further down is a separate fixed test.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <GradientSummaryCard
            label="Thumbs up"
            value={String(feedback.up)}
            hint="Helpful"
            icon={HandThumbUpIcon}
            gradientClassName={REPORT_SUMMARY_GRADIENTS[1]}
          />
          <GradientSummaryCard
            label="Thumbs down"
            value={String(feedback.down)}
            hint="Not helpful"
            icon={HandThumbDownIcon}
            gradientClassName={REPORT_SUMMARY_GRADIENTS[0]}
          />
          <GradientSummaryCard
            label="Slow replies"
            value={String(qualityProblems.find((row) => row.name === 'Slow reply')?.count || 0)}
            hint="Over 8 seconds"
            icon={ClockIcon}
            gradientClassName={REPORT_SUMMARY_GRADIENTS[2]}
          />
          <GradientSummaryCard
            label="Tool errors"
            value={String(qualityProblems.find((row) => row.name === 'Tool error')?.count || 0)}
            hint="Lookup failed"
            icon={ExclamationTriangleIcon}
            gradientClassName={REPORT_SUMMARY_GRADIENTS[4]}
          />
          <GradientSummaryCard
            label="Wrong client"
            value={String(qualityProblems.find((row) => row.name === 'Wrong client')?.count || 0)}
            hint="Wrong person"
            icon={MagnifyingGlassIcon}
            gradientClassName={REPORT_SUMMARY_GRADIENTS[3]}
          />
        </div>
        <UsageChart
          title="Problems in real chats"
          subtitle={`${feedback.up} thumbs up · ${feedback.down} thumbs down. Bars are saved problems, not the checklist.`}
          data={qualityProblems.map((row) => ({ name: row.name, count: row.count }))}
          dataKey="count"
          color="#b45309"
          collapseAt={10}
          empty="No problem events saved yet. Thumbs down and tool failures show up here."
        />
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900">Remembered by employees</h2>
          <p className="mt-1 text-sm text-gray-500">
            Each line is checked against later chats: whether it was sent, whether a reply followed it, or whether a draft ignored it.
          </p>
          {filteredRemembered.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              {remembered.length === 0
                ? 'Nothing saved yet. Run sql/2026-11-25_ai_user_memory_superuser_read.sql to see every employee.'
                : 'No remembered text for this employee and these dates.'}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-200">
              {filteredRemembered.map((row) => (
                <li key={row.id} className="flex items-start gap-3 py-3">
                  <EmployeeAvatar name={row.name} photo={row.photo} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm leading-relaxed text-gray-900">{row.fact}</p>
                      <span className={`shrink-0 text-sm font-semibold ${memoryStatusClass(row.review.status)}`}>
                        {memoryStatusLabel(row.review.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {row.name} · {row.category}
                      {formatFeedbackWhen(row.at) ? ` · ${formatFeedbackWhen(row.at)}` : ''}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">{row.review.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900">Checklist questions</h2>
          <ul className="mt-3 divide-y divide-gray-200">
            {RMQ_AI_EVAL_CASES.map((testCase) => {
              const result = evalSuite.results.find((row) => row.id === testCase.id);
              return (
                <li key={testCase.id} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-gray-900">{testCase.userMessage}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {testCase.category.replaceAll('_', ' ')} · {testCase.severity}
                    </p>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold ${result?.passed === false ? 'text-red-600' : 'text-emerald-600'}`}>
                    {result?.passed === false ? 'Failed' : 'Passed'}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        {qualityRecent.length > 0 ? (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-gray-900">Latest saved problems</h2>
            <ul className="mt-3 divide-y divide-gray-200">
              {qualityRecent.map((row, index) => (
                <li key={`${row.at}-${index}`} className="flex items-center justify-between gap-3 py-3">
                  <p className="text-sm text-gray-900">{row.name}</p>
                  <p className="shrink-0 text-xs text-gray-400">{formatFeedbackWhen(row.at)}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
      ) : null}

      {tab === 'observe' ? (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-gray-900">Observe</h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-relaxed text-gray-700">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-emerald-600 hover:bg-emerald-50"
            onClick={() => void openFeedbackModal('up')}
          >
            <HandThumbUpIcon className="h-5 w-5" />
            {feedback.up}
          </button>
          <span className="text-gray-300">·</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-red-500 hover:bg-red-50"
            onClick={() => void openFeedbackModal('down')}
          >
            <HandThumbDownIcon className="h-5 w-5" />
            {feedback.down}
          </button>
          <span className="text-gray-300">·</span>
          <span>
            {memories} active personal memories · {knowledgeFiles.length} knowledge files · {lessons} lessons awaiting approval
          </span>
        </p>
      </section>
      ) : null}

      {tab === 'model' ? (
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-gray-900">Model</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          {versions.modelVersion} · prompt {versions.promptVersion} · tools {versions.toolContractVersion} ·
          resolver {versions.resolverVersion}
        </p>
        <p className="mt-2 text-xs text-gray-400">
          Embeddings are deferred until Postgres full-text search is not enough.
        </p>
      </section>
      ) : null}

      {tab === 'knowledge' ? (
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="p-4">
        <h2 className="font-semibold text-gray-900">Knowledge files</h2>
        <p className="mt-1 text-sm text-gray-500">
          Playbooks from chat start as personal. Research saved from chat becomes verified firm knowledge with a review date.
        </p>
        </div>
        {knowledgeDraft ? (
          <div className="space-y-3 border-t border-gray-200 p-4">
            <label className="block text-sm font-medium text-gray-700">
              Title
              <input
                className="input input-bordered mt-1 w-full"
                value={knowledgeDraft.title}
                onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, title: event.target.value })}
                placeholder="Playbook name"
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Text
              <textarea
                className="textarea textarea-bordered mt-1 min-h-40 w-full"
                value={knowledgeDraft.body}
                onChange={(event) => setKnowledgeDraft({ ...knowledgeDraft, body: event.target.value })}
                placeholder="Write the knowledge the AI should use."
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setKnowledgeDraft(null)} disabled={knowledgeSaving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
                onClick={() => void saveKnowledgeDraft()}
                disabled={knowledgeSaving}
              >
                {knowledgeSaving ? 'Saving' : 'Save'}
              </button>
            </div>
          </div>
        ) : null}
        {knowledgeFiles.length === 0 ? (
          <p className="border-t border-gray-200 px-4 py-8 text-center text-sm text-gray-500">No files yet. Add text or upload a .txt playbook.</p>
        ) : (
          <ul className="border-t border-gray-200">
            {knowledgeFiles.map((file) => (
              <li key={file.id} className="border-b border-gray-200 px-4 py-4 last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900">{file.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                      {file.scope === 'firm' ? 'Firm-wide' : 'Personal'} · {file.status}
                      {file.knowledge_kind ? ` · ${file.knowledge_kind}` : ''}
                      {file.topic_scope ? ` · ${file.topic_scope}` : ''}
                      {file.owner ? ` · ${file.owner}` : ''}
                    </p>
                  </div>
                  <GreyMenu>
                    <MenuItem
                      icon={<PencilSquareIcon className="h-4 w-4" />}
                      label="Edit"
                      disabled={busyId === file.id}
                      onClick={() => openKnowledgeEdit(file)}
                    />
                    <MenuItem
                      icon={<EyeIcon className="h-4 w-4" />}
                      label={previewById[file.id] ? 'Hide' : 'View'}
                      disabled={busyId === file.id}
                      onClick={() => {
                        if (previewById[file.id]) {
                          setPreviewById((prev) => {
                            const next = { ...prev };
                            delete next[file.id];
                            return next;
                          });
                          return;
                        }
                        setBusyId(file.id);
                        void getKnowledgePreview(file.id).then((text) => {
                          setPreviewById((prev) => ({ ...prev, [file.id]: text || 'No text chunks saved.' }));
                          setBusyId(null);
                        });
                      }}
                    />
                    {file.scope !== 'firm' ? (
                      <MenuItem
                        icon={<UsersIcon className="h-4 w-4" />}
                        label="Make firm-wide"
                        disabled={busyId === file.id}
                        onClick={() => {
                          setBusyId(file.id);
                          void promoteKnowledgeToFirm(file.id).then((ok) => {
                            setBusyId(null);
                            if (ok) {
                              toast.success('Now firm-wide. Everyone can use this playbook.');
                              void refresh();
                            } else {
                              toast.error('Could not make it firm-wide. Run sql/2026-09-02_rmq_ai_v1_knowledge_manage.sql');
                            }
                          });
                        }}
                      />
                    ) : file.status === 'draft' ? (
                      <MenuItem
                        icon={<CheckIcon className="h-4 w-4" />}
                        label="Approve"
                        disabled={busyId === file.id}
                        onClick={() => {
                          setBusyId(file.id);
                          void setKnowledgeStatus(file.id, 'approved').then((ok) => {
                            setBusyId(null);
                            if (ok) {
                              toast.success('Approved for the firm.');
                              void refresh();
                            } else {
                              toast.error('Could not approve. Run the knowledge manage SQL.');
                            }
                          });
                        }}
                      />
                    ) : null}
                    <MenuItem
                      icon={<TrashIcon className="h-4 w-4" />}
                      label="Delete"
                      danger
                      disabled={busyId === file.id}
                      onClick={() => {
                        if (!confirm(`Remove “${file.title}”? The AI will stop using this file.`)) return;
                        setBusyId(file.id);
                        void deleteKnowledgeFile(file.id).then((ok) => {
                          setBusyId(null);
                          if (ok) {
                            toast.success('Knowledge file removed.');
                            void refresh();
                          } else {
                            toast.error('Could not delete. Run sql/2026-09-02_rmq_ai_v1_knowledge_manage.sql');
                          }
                        });
                      }}
                    />
                  </GreyMenu>
                </div>
                {file.verified_by || file.review_after ? (
                  <p className="mt-3 text-xs text-gray-400">
                    {file.verified_by ? `Verified by ${file.verified_by}` : 'Added'}
                    {file.verified_at ? ` · ${String(file.verified_at).slice(0, 10)}` : ''}
                    {file.review_after ? ` · review ${String(file.review_after).slice(0, 10)}` : ''}
                    {knowledgeNeedsReview(file) ? ' · needs re-check' : ''}
                  </p>
                ) : null}
                {previewById[file.id] ? (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-[#ececec] p-3 text-xs text-gray-600">
                    {previewById[file.id]}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      ) : null}

      {tab === 'guides' ? (
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <h2 className="font-semibold text-gray-900">Rules and service</h2>
              <p className="mt-1 text-sm text-gray-500">
                {GUIDE_TABS.find((item) => item.id === guideCategory)?.hint} Active rows are sent with every chat.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm gap-1 rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
              onClick={() => setGuideDraft({ id: null, title: '', body: '' })}
            >
              <PlusIcon className="h-5 w-5" />
              Add
            </button>
          </div>
          <div className="px-4 pb-4">
            <div className="inline-flex rounded-full bg-[#ececec] p-1">
              {GUIDE_TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    guideCategory === item.id ? 'bg-[#3b28c7] text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                  onClick={() => {
                    setGuideCategory(item.id);
                    setGuideDraft(null);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {guideDraft ? (
            <div className="space-y-3 border-t border-gray-200 p-4">
              <label className="block text-sm font-medium text-gray-700">
                Title
                <input
                  className="input input-bordered mt-1 w-full"
                  value={guideDraft.title}
                  onChange={(event) => setGuideDraft({ ...guideDraft, title: event.target.value })}
                  placeholder="Short name"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Text
                <textarea
                  className="textarea textarea-bordered mt-1 min-h-40 w-full"
                  value={guideDraft.body}
                  onChange={(event) => setGuideDraft({ ...guideDraft, body: event.target.value })}
                  placeholder="What the assistant should follow."
                />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setGuideDraft(null)} disabled={guideSaving}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm rounded-full border-0 bg-[#3b28c7] text-white hover:bg-[#3224b0]"
                  onClick={() => void saveGuideDraft()}
                  disabled={guideSaving}
                >
                  {guideSaving ? 'Saving' : 'Save'}
                </button>
              </div>
            </div>
          ) : null}
          {guides.filter((row) => row.category === guideCategory).length === 0 ? (
            <p className="border-t border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
              Nothing here yet. Add the text the assistant should follow.
            </p>
          ) : (
            <ul className="border-t border-gray-200">
              {guides
                .filter((row) => row.category === guideCategory)
                .map((row) => (
                  <li key={row.id} className="border-b border-gray-200 px-4 py-4 last:border-b-0">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">{row.title}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{row.body}</p>
                      </div>
                      <GreyMenu>
                        <MenuItem
                          icon={<PencilSquareIcon className="h-4 w-4" />}
                          label="Edit"
                          onClick={() => setGuideDraft({ id: row.id, title: row.title, body: row.body })}
                        />
                        <MenuItem
                          icon={<TrashIcon className="h-4 w-4" />}
                          label="Delete"
                          danger
                          onClick={() => {
                            void deleteChatGuide(row.id).then((ok) => {
                              if (!ok) {
                                toast.error('Could not delete.');
                                return;
                              }
                              setGuides((prev) => prev.filter((item) => item.id !== row.id));
                            });
                          }}
                        />
                      </GreyMenu>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-400">{row.is_active ? 'On for every chat' : 'Off'}</p>
                      <input
                        type="checkbox"
                        className="toggle toggle-success toggle-sm"
                        checked={row.is_active}
                        aria-label={row.is_active ? 'Turn off' : 'Turn on'}
                        onChange={(event) => {
                          const next = event.target.checked;
                          setGuides((prev) => prev.map((item) => (item.id === row.id ? { ...item, is_active: next } : item)));
                          void setChatGuideActive(row.id, next).then((ok) => {
                            if (!ok) {
                              toast.error('Could not update.');
                              void refresh();
                            }
                          });
                        }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'lessons' ? (
        candidates.length > 0 ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-gray-900">Suggested firm lessons</h2>
          <ul className="-mx-4 mt-3 border-t border-gray-200">
            {candidates.map((row) => {
              const chats = lessonEvidence[row.fact] || [];
              return (
              <li key={row.id} className="border-b border-gray-200 px-4 py-4 last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-relaxed text-gray-900">{row.fact}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatFeedbackWhen(row.created_at || null) ? `Suggested ${formatFeedbackWhen(row.created_at || null)} · ` : ''}
                      Raised {row.evidence_count} {row.evidence_count === 1 ? 'time' : 'times'}
                    </p>
                  </div>
                  <GreyMenu>
                    <MenuItem
                      icon={<CheckIcon className="h-4 w-4" />}
                      label="Approve"
                      onClick={() => {
                        void reviewFirmLesson(row.id, 'approved', row.fact).then(() =>
                          setCandidates((prev) => prev.filter((item) => item.id !== row.id)),
                        );
                      }}
                    />
                    <MenuItem
                      icon={<TrashIcon className="h-4 w-4" />}
                      label="Reject"
                      danger
                      onClick={() => {
                        void reviewFirmLesson(row.id, 'rejected').then(() =>
                          setCandidates((prev) => prev.filter((item) => item.id !== row.id)),
                        );
                      }}
                    />
                  </GreyMenu>
                </div>
                {lessonEvidenceLoading ? (
                  <p className="mt-3 text-xs text-gray-400">Looking up the chats…</p>
                ) : chats.length === 0 ? (
                  <p className="mt-3 text-xs text-gray-400">
                    No saved chat contains this line.
                    {usageBlocked ? ' Run sql/2026-11-25_ai_chat_history_superuser_read.sql to read every employee’s chats.' : ''}
                  </p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {chats.map((chat) => (
                      <li key={chat.chatId} className="rounded-xl bg-[#ececec] p-3">
                        <p className="text-xs text-gray-500">
                          {chat.userId ? usageNames[chat.userId] || 'Employee' : 'Employee'}
                          {formatFeedbackWhen(chat.when) ? ` · ${formatFeedbackWhen(chat.when)}` : ''}
                        </p>
                        {chat.question ? (
                          <p className="mt-2 text-sm leading-relaxed text-gray-900">
                            <span className="font-semibold">Asked. </span>
                            {chat.question}
                          </p>
                        ) : null}
                        {chat.answer ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                            <span className="font-semibold text-gray-900">Answer. </span>
                            {chat.answer}
                          </p>
                        ) : (
                          <p className="mt-2 text-sm text-gray-500">No reply was saved in that chat.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              );
            })}
          </ul>
        </section>
        ) : (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-gray-900">Suggested firm lessons</h2>
            <p className="mt-2 text-sm text-gray-500">No lessons waiting for approval.</p>
          </section>
        )
      ) : null}

      {feedbackModal ? (
        <div
          className="modal modal-open z-[400] !grid !place-items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-people-title"
          onClick={() => setFeedbackModal(null)}
        >
          <div
            className="modal-box flex max-h-[min(85vh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white p-0"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
              <h3 id="feedback-people-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                {feedbackModal === 'up' ? (
                  <HandThumbUpIcon className="h-5 w-5 text-emerald-600" />
                ) : (
                  <HandThumbDownIcon className="h-5 w-5 text-red-500" />
                )}
                {feedbackModal === 'up' ? 'Thumbs up' : 'Thumbs down'}
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                aria-label="Close"
                onClick={() => setFeedbackModal(null)}
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {feedbackPeopleLoading ? (
                <div className="flex justify-center py-8">
                  <span className="loading loading-spinner loading-md text-gray-400" />
                </div>
              ) : feedbackPeople.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No employees yet.</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {feedbackPeople.map((person) => (
                    <li key={person.userId} className="flex items-start gap-3 py-3">
                      <EmployeeAvatar name={person.name} photo={person.photo} />
                      <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{person.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {person.count} {person.count === 1 ? 'time' : 'times'}
                        {formatFeedbackWhen(person.lastAt) ? ` · ${formatFeedbackWhen(person.lastAt)}` : ''}
                      </p>
                      {person.reasons.length > 0 ? (
                        <p className="mt-1 text-xs text-gray-500">{person.reasons.join(' · ')}</p>
                      ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageChart({
  title,
  subtitle,
  data,
  dataKey,
  color = '#3b28c7',
  empty,
  showPhotos = false,
  collapseAt,
}: {
  title: string;
  subtitle: string;
  data: Array<{ name: string; photo?: string | null; messages?: number; chats?: number; count?: number }>;
  dataKey: 'messages' | 'chats' | 'count';
  color?: string;
  empty: string;
  showPhotos?: boolean;
  collapseAt?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = collapseAt && data.length > collapseAt ? data.length - collapseAt : 0;
  const visible = hiddenCount > 0 && !expanded ? data.slice(0, collapseAt) : data;
  const height = Math.max(168, visible.length * (showPhotos ? 56 : 36));
  const photos = Object.fromEntries(visible.map((row) => [row.name, row.photo || null]));
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      {data.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="mt-3" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visible} layout="vertical" margin={{ left: showPhotos ? 12 : 4, right: 12, top: 4, bottom: 0 }}>
              <CartesianGrid stroke="#ececec" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={showPhotos ? 196 : 112}
                tick={showPhotos ? (props) => <EmployeeAxisTick {...props} photos={photos} /> : { fontSize: 12, fill: '#374151' }}
              />
              <Tooltip cursor={{ fill: '#f3f4f6' }} />
              <Bar dataKey={dataKey} fill={color} radius={[0, 6, 6, 0]} barSize={showPhotos ? 22 : undefined} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-1 rounded-full bg-[#ececec] py-2 text-sm font-medium text-gray-700 hover:bg-[#e2e2e2]"
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDownIcon className={`h-4 w-4 ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      ) : null}
    </section>
  );
}

function EmployeeAxisTick({
  x = 0,
  y = 0,
  payload,
  photos,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string; index?: number };
  photos: Record<string, string | null>;
}) {
  const name = String(payload?.value || '');
  const photo = photos[name];
  const src = photo ? toEmployeeAvatarSrc(photo, 96) : null;
  const clipId = `emp-tick-${payload?.index ?? name.replace(/[^a-z0-9]+/gi, '-')}`;
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  return (
    <g transform={`translate(${x},${y})`}>
      <clipPath id={clipId}>
        <circle cx={-158} cy={0} r={16} />
      </clipPath>
      {src ? (
        <image href={src} x={-174} y={-16} width={32} height={32} clipPath={`url(#${clipId})`} />
      ) : (
        <>
          <circle cx={-158} cy={0} r={16} fill="#e5e7eb" />
          <text x={-158} y={5} textAnchor="middle" fontSize={13} fill="#4b5563">
            {initial}
          </text>
        </>
      )}
      <text x={-136} y={4} fontSize={12} fill="#374151">
        {name}
      </text>
    </g>
  );
}

function EmployeeAvatar({ name, photo, size = 32 }: { name: string; photo?: string | null; size?: number }) {
  const src = photo ? toEmployeeAvatarSrc(photo, size * 2) : null;
  if (src) {
    return <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[#ececec] text-xs font-semibold text-gray-600"
      style={{ width: size, height: size }}
    >
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  );
}

function EmployeeFilter({
  people,
  value,
  onChange,
}: {
  people: Array<{ id: string; name: string; photo: string | null }>;
  value: string;
  onChange: (id: string) => void;
}) {
  const selected = people.find((person) => person.id === value);
  const [query, setQuery] = useState(selected?.name || '');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(selected?.name || '');
  }, [selected?.name]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || boxRef.current?.contains(event.target)) return;
      setOpen(false);
      setQuery(selected?.name || '');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [selected?.name]);

  const needle = query.trim().toLowerCase();
  const matches = people.filter((person) => !needle || person.name.toLowerCase().includes(needle)).slice(0, 12);

  return (
    <div ref={boxRef} className="relative">
      <span className="block text-xs font-medium text-gray-500">Employee</span>
      <input
        className="input input-bordered mt-1 w-full text-sm text-gray-900"
        placeholder="All employees"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          if (!next.trim()) onChange('');
        }}
      />
      {open ? (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          <li>
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-[#ececec]"
              onClick={() => {
                onChange('');
                setQuery('');
                setOpen(false);
              }}
            >
              All employees
            </button>
          </li>
          {matches.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-900 hover:bg-[#ececec]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(person.id);
                  setQuery(person.name);
                  setOpen(false);
                }}
              >
                <EmployeeAvatar name={person.name} photo={person.photo} size={28} />
                {person.name}
              </button>
            </li>
          ))}
          {matches.length === 0 ? <li className="px-3 py-2 text-sm text-gray-500">No employee</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function GreyMenu({ children }: { children: React.ReactNode }) {
  return (
    <details className="dropdown dropdown-end shrink-0">
      <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
        <EllipsisVerticalIcon className="h-6 w-6" />
      </summary>
      <ul
        className="dropdown-content z-20 w-44 overflow-hidden rounded-xl border border-gray-300 py-1 shadow-lg"
        style={{ backgroundColor: '#ececec' }}
      >
        {children}
      </ul>
    </details>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        className={`flex w-full items-center gap-2 bg-[#ececec] px-3 py-2 text-left text-sm hover:bg-[#e2e2e2] disabled:opacity-50 ${
          danger ? 'text-red-600' : 'text-gray-800'
        }`}
        onClick={(event) => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          onClick();
        }}
      >
        {icon}
        {label}
      </button>
    </li>
  );
}
