import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import {
  currentRmqAiVersions,
  deleteKnowledgeFile,
  getKnowledgePreview,
  ingestKnowledgeText,
  knowledgeNeedsReview,
  listFirmLessonCandidates,
  listKnowledgeFiles,
  promoteKnowledgeToFirm,
  reviewFirmLesson,
  runDeterministicEvalSuite,
  setKnowledgeStatus,
  type KnowledgeFileRow,
} from '../lib/rmqAiV1';

export default function RmqAiControlPage() {
  const evalSuite = useMemo(() => runDeterministicEvalSuite(), []);
  const versions = useMemo(() => currentRmqAiVersions(), []);
  const [feedback, setFeedback] = useState({ up: 0, down: 0 });
  const [memories, setMemories] = useState(0);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileRow[]>([]);
  const [lessons, setLessons] = useState(0);
  const [candidates, setCandidates] = useState<Array<{ id: string; fact: string; evidence_count: number }>>([]);
  const [previewById, setPreviewById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">RMQ AI Control Center</h1>
        <p className="mt-1 text-sm text-slate-600">
          Quality, versions, and knowledge. Firm-wide lessons still need a person to approve.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Eval pass" value={pct(evalSuite.overall)} />
        <Stat label="Critical fails" value={String(evalSuite.criticalFails)} />
        <Stat label="Can deploy" value={evalSuite.canDeploy ? 'Yes' : 'No'} />
        <Stat label="Architecture" value={versions.architectureVersion} />
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Quality</h2>
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          <li>Lead resolution {pct(evalSuite.byCategory.lead_resolution)}</li>
          <li>Meetings {pct(evalSuite.byCategory.meeting)}</li>
          <li>Write safety {pct(evalSuite.byCategory.write_action)}</li>
          <li>History recall {pct(evalSuite.byCategory.history_recall)}</li>
          <li>Adversarial {pct(evalSuite.byCategory.adversarial)}</li>
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Observe</h2>
        <p className="mt-2 text-sm text-slate-700">
          {feedback.up} thumbs up · {feedback.down} thumbs down · {memories} active personal memories ·{' '}
          {knowledgeFiles.length} knowledge files · {lessons} lessons awaiting approval
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-semibold text-slate-900">Model</h2>
        <p className="mt-2 text-sm text-slate-700">
          {versions.modelVersion} · prompt {versions.promptVersion} · tools {versions.toolContractVersion} ·
          resolver {versions.resolverVersion}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Embeddings are deferred until Postgres full-text search is not enough.
        </p>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Knowledge files</h2>
            <p className="mt-1 text-xs text-slate-500">
              Playbooks from chat start as personal. Research saved from chat becomes verified firm knowledge with a review date.
            </p>
          </div>
          <label className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
            Upload firm playbook
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
                    void refresh();
                  } else {
                    toast.error('Could not save the file. Run the RMQ AI knowledge SQL first.');
                  }
                });
              }}
            />
          </label>
        </div>
        {knowledgeFiles.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No files yet. Upload a .txt playbook here or from chat history.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {knowledgeFiles.map((file) => (
              <li key={file.id} className="rounded-xl bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{file.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {file.scope === 'firm' ? 'Firm-wide' : 'Personal'} · {file.status}
                      {file.knowledge_kind ? ` · ${file.knowledge_kind}` : ''}
                      {file.topic_scope ? ` · ${file.topic_scope}` : ''}
                      {file.owner ? ` · ${file.owner}` : ''}
                    </p>
                    {file.verified_by || file.review_after ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {file.verified_by ? `Verified by ${file.verified_by}` : ''}
                        {file.verified_at ? ` · ${String(file.verified_at).slice(0, 10)}` : ''}
                        {file.review_after ? ` · review ${String(file.review_after).slice(0, 10)}` : ''}
                        {knowledgeNeedsReview(file) ? ' · needs re-check' : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
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
                    >
                      {previewById[file.id] ? 'Hide' : 'View'}
                    </button>
                    {file.scope !== 'firm' ? (
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
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
                      >
                        Make firm-wide
                      </button>
                    ) : file.status === 'draft' ? (
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
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
                      >
                        Approve
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
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
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {previewById[file.id] ? (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-slate-600">
                    {previewById[file.id]}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {candidates.length > 0 ? (
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="font-semibold text-slate-900">Suggested firm lessons</h2>
          <ul className="mt-3 space-y-3">
            {candidates.map((row) => (
              <li key={row.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                <p className="text-slate-800">{row.fact}</p>
                <p className="mt-1 text-xs text-slate-500">Evidence: {row.evidence_count}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => {
                      void reviewFirmLesson(row.id, 'approved', row.fact).then(() =>
                        setCandidates((prev) => prev.filter((item) => item.id !== row.id)),
                      );
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700"
                    onClick={() => {
                      void reviewFirmLesson(row.id, 'rejected').then(() =>
                        setCandidates((prev) => prev.filter((item) => item.id !== row.id)),
                      );
                    }}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
