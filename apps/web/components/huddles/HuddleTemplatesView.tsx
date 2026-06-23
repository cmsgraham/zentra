'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface Workspace { id: string; name: string }
interface Member { id: string; name: string; email: string; avatarUrl: string | null }

interface TemplateTopic { title: string; context?: string | null }
interface Template {
  id: string;
  name: string;
  type: 'team' | 'personal';
  workspaceId: string | null;
  defaultTitle: string;
  defaultIntention: string | null;
  defaultParticipantUserIds: string[];
  defaultExternalAttendees: { name: string; email?: string | null }[];
  defaultTopics: TemplateTopic[];
  emailSummaryToParticipants?: boolean;
  createdAt: string;
  updatedAt: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  type: 'team',
  workspaceId: null,
  defaultTitle: '',
  defaultIntention: '',
  defaultParticipantUserIds: [],
  defaultTopics: [{ title: '', context: '' }],
  emailSummaryToParticipants: false,
});

interface Draft {
  name: string;
  type: 'team' | 'personal';
  workspaceId: string | null;
  defaultTitle: string;
  defaultIntention: string;
  defaultParticipantUserIds: string[];
  defaultTopics: { title: string; context: string }[];
  emailSummaryToParticipants: boolean;
}

function fromTemplate(t: Template): Draft {
  return {
    name: t.name,
    type: t.type,
    workspaceId: t.workspaceId,
    defaultTitle: t.defaultTitle,
    defaultIntention: t.defaultIntention ?? '',
    defaultParticipantUserIds: [...(t.defaultParticipantUserIds ?? [])],
    defaultTopics: (t.defaultTopics ?? []).map((x) => ({
      title: x.title,
      context: x.context ?? '',
    })),
    emailSummaryToParticipants: !!t.emailSummaryToParticipants,
  };
}

export function HuddleTemplatesView() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [t, w] = await Promise.all([
        api<{ templates: Template[] }>('/huddles/templates'),
        api<{ items: Workspace[] }>('/workspaces'),
      ]);
      setTemplates(t?.templates ?? []);
      setWorkspaces(
        (w?.items ?? []).slice().sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
      );
    } catch (e: any) {
      setError(e?.message ?? 'Could not load templates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function startCreate() {
    const d = emptyDraft();
    if (workspaces[0]) d.workspaceId = workspaces[0].id;
    setEditing({ id: null, draft: d });
  }

  function startEdit(t: Template) {
    setEditing({ id: t.id, draft: fromTemplate(t) });
  }

  async function handleDelete(t: Template) {
    if (!confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    try {
      await api(`/huddles/templates/${t.id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e: any) {
      alert(e?.message ?? 'Could not delete template');
    }
  }

  async function handleStartFromTemplate(t: Template) {
    try {
      const res = await api<{ huddle: { id: string } }>(`/huddles/from-template/${t.id}`, {
        method: 'POST',
        body: {},
      });
      router.push(`/huddles/${res.huddle.id}`);
    } catch (e: any) {
      alert(e?.message ?? 'Could not start huddle from template');
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 sm:py-12 w-full">
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <Link
            href="/huddles"
            className="z-caption inline-flex items-center gap-1.5"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Huddles
          </Link>
          <h1 className="z-page-title mt-2">Huddle templates</h1>
          <p className="z-body mt-2" style={{ color: 'var(--ink-text-secondary)', maxWidth: 560 }}>
            Reusable presets for recurring huddles. Capture a name, default title, intention,
            participants, and an agenda — then start a fresh huddle in one click.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="z-btn z-btn-sm rounded-full shrink-0"
          style={{
            background: 'var(--ink-accent)',
            color: 'var(--ink-on-accent)',
            padding: '8px 16px',
            fontWeight: 550,
            fontSize: '0.875rem',
            boxShadow: 'var(--ink-shadow-sm)',
          }}
        >
          + New template
        </button>
      </div>

      {error && (
        <div
          className="mb-4 px-3 py-2 rounded-md text-[13px]"
          style={{ background: 'var(--ink-surface)', color: 'var(--ink-blocked)', border: '1px solid var(--ink-border-subtle)' }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-[13px] py-12 text-center" style={{ color: 'var(--ink-text-muted)' }}>
          Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <EmptyState onCreate={startCreate} />
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              workspaces={workspaces}
              onEdit={() => startEdit(t)}
              onDelete={() => handleDelete(t)}
              onStart={() => handleStartFromTemplate(t)}
            />
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditorModal
          editing={editing}
          workspaces={workspaces}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setTemplates((prev) => {
              const i = prev.findIndex((x) => x.id === saved.id);
              if (i === -1) return [saved, ...prev];
              const next = [...prev];
              next[i] = saved;
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="text-center py-16 rounded-xl"
      style={{ background: 'var(--ink-surface)', border: '1px dashed var(--ink-border)' }}
    >
      <p className="z-body mb-4" style={{ color: 'var(--ink-text-secondary)' }}>
        No templates yet. Save a recurring huddle as a template — or build one from scratch.
      </p>
      <button
        onClick={onCreate}
        className="z-btn z-btn-sm rounded-full"
        style={{
          background: 'var(--ink-accent)',
          color: 'var(--ink-on-accent)',
          padding: '8px 16px',
          fontWeight: 550,
          fontSize: '0.875rem',
        }}
      >
        + Create your first template
      </button>
    </div>
  );
}

function TemplateCard({
  template,
  workspaces,
  onEdit,
  onDelete,
  onStart,
}: {
  template: Template;
  workspaces: Workspace[];
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
}) {
  const wsName = template.workspaceId
    ? workspaces.find((w) => w.id === template.workspaceId)?.name ?? '—'
    : null;
  const topicCount = template.defaultTopics?.length ?? 0;
  const partCount = template.defaultParticipantUserIds?.length ?? 0;

  return (
    <div
      className="p-4 sm:p-5 rounded-xl"
      style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{
                background: template.type === 'team' ? 'var(--ink-accent-soft)' : 'var(--ink-surface-raised)',
                color: template.type === 'team' ? 'var(--ink-accent)' : 'var(--ink-text-secondary)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {template.type}
            </span>
            {wsName && (
              <span className="text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
                {wsName}
              </span>
            )}
          </div>
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>
            {template.name}
          </h3>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-text-secondary)' }}>
            {template.defaultTitle}
          </p>
          {template.defaultIntention && (
            <p className="text-[12.5px] mt-1.5 italic" style={{ color: 'var(--ink-text-muted)' }}>
              “{template.defaultIntention}”
            </p>
          )}
          <div className="flex gap-3 mt-2.5 text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
            <span>{topicCount} topic{topicCount === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{partCount} participant{partCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onStart}
            className="px-3 py-1.5 rounded-full text-[12.5px]"
            style={{
              background: 'var(--ink-accent)',
              color: 'var(--ink-on-accent)',
              fontWeight: 600,
            }}
          >
            Start huddle
          </button>
          <button
            onClick={onEdit}
            className="px-3 py-1.5 rounded-full text-[12.5px]"
            style={{
              background: 'var(--ink-surface-raised)',
              color: 'var(--ink-text)',
              border: '1px solid var(--ink-border-subtle)',
              fontWeight: 550,
            }}
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 rounded-full text-[12.5px]"
            style={{
              background: 'transparent',
              color: 'var(--ink-blocked)',
              border: '1px solid var(--ink-border-subtle)',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateEditorModal({
  editing,
  workspaces,
  onCancel,
  onSaved,
}: {
  editing: { id: string | null; draft: Draft };
  workspaces: Workspace[];
  onCancel: () => void;
  onSaved: (t: Template) => void;
}) {
  const [draft, setDraft] = useState<Draft>(editing.draft);
  const [members, setMembers] = useState<Member[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load workspace members for participant picker (team only)
  useEffect(() => {
    if (draft.type !== 'team' || !draft.workspaceId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ members: Member[] }>(`/huddles/workspaces/${draft.workspaceId}/members`);
        if (!cancelled) setMembers(data?.members ?? []);
      } catch {
        if (!cancelled) setMembers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [draft.workspaceId, draft.type]);

  const selected = useMemo(() => new Set(draft.defaultParticipantUserIds), [draft.defaultParticipantUserIds]);

  function toggleMember(id: string) {
    setDraft((d) => {
      const set = new Set(d.defaultParticipantUserIds);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...d, defaultParticipantUserIds: Array.from(set) };
    });
  }

  function updateTopic(i: number, patch: Partial<{ title: string; context: string }>) {
    setDraft((d) => {
      const next = [...d.defaultTopics];
      next[i] = { ...next[i], ...patch };
      return { ...d, defaultTopics: next };
    });
  }

  function addTopic() {
    setDraft((d) => ({ ...d, defaultTopics: [...d.defaultTopics, { title: '', context: '' }] }));
  }

  function removeTopic(i: number) {
    setDraft((d) => ({ ...d, defaultTopics: d.defaultTopics.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setError(null);
    if (!draft.name.trim()) { setError('Name is required'); return; }
    if (!draft.defaultTitle.trim()) { setError('Default title is required'); return; }
    if (draft.type === 'team' && !draft.workspaceId) { setError('Choose a workspace for team templates'); return; }

    setSubmitting(true);
    try {
      const payload: any = {
        name: draft.name.trim(),
        type: draft.type,
        workspaceId: draft.type === 'team' ? draft.workspaceId : null,
        defaultTitle: draft.defaultTitle.trim(),
        defaultIntention: draft.defaultIntention.trim() || null,
        defaultParticipantUserIds: draft.type === 'team' ? draft.defaultParticipantUserIds : [],
        defaultTopics: draft.defaultTopics
          .filter((t) => t.title.trim())
          .map((t) => ({ title: t.title.trim(), context: t.context.trim() || null })),
        emailSummaryToParticipants: !!draft.emailSummaryToParticipants,
      };
      const res = editing.id
        ? await api<{ template: Template }>(`/huddles/templates/${editing.id}`, { method: 'PATCH', body: payload })
        : await api<{ template: Template }>(`/huddles/templates`, { method: 'POST', body: payload });
      onSaved(res.template);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save template');
    } finally {
      setSubmitting(false);
    }
  }

  const backdropMouseDown = useRef(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onMouseDown={(e) => {
        backdropMouseDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDown.current) {
          onCancel();
        }
        backdropMouseDown.current = false;
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--ink-bg)', border: '1px solid var(--ink-border)', maxHeight: '90vh' }}
      >
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--ink-border-subtle)' }}
        >
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink-text)' }}>
            {editing.id ? 'Edit template' : 'New template'}
          </h2>
          <button onClick={onCancel} className="text-[13px]" style={{ color: 'var(--ink-text-muted)' }}>
            Cancel
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto" style={{ flex: 1 }}>
          {error && (
            <div
              className="mb-3 px-3 py-2 rounded-md text-[13px]"
              style={{ background: 'var(--ink-surface)', color: 'var(--ink-blocked)' }}
            >
              {error}
            </div>
          )}

          <Field label="Template name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder='e.g. "Weekly engineering sync"'
              className="z-input w-full"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Type">
              <select
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as 'team' | 'personal' })}
                className="z-input w-full"
              >
                <option value="team">Team</option>
                <option value="personal">Personal</option>
              </select>
            </Field>
            {draft.type === 'team' && (
              <Field label="Workspace">
                <select
                  value={draft.workspaceId ?? ''}
                  onChange={(e) => setDraft({ ...draft, workspaceId: e.target.value || null })}
                  className="z-input w-full"
                >
                  <option value="">Select workspace…</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <Field label="Default title">
            <input
              value={draft.defaultTitle}
              onChange={(e) => setDraft({ ...draft, defaultTitle: e.target.value })}
              placeholder='e.g. "Weekly sync"'
              className="z-input w-full"
            />
          </Field>

          <Field label="Default intention">
            <textarea
              value={draft.defaultIntention}
              onChange={(e) => setDraft({ ...draft, defaultIntention: e.target.value })}
              placeholder="What's this huddle for? (optional)"
              rows={2}
              className="z-input w-full"
            />
          </Field>

          {draft.type === 'team' && draft.workspaceId && (
            <Field label={`Default participants (${selected.size})`}>
              <div
                className="rounded-md p-1 max-h-40 overflow-y-auto"
                style={{ border: '1px solid var(--ink-border-subtle)' }}
              >
                {members.length === 0 ? (
                  <div className="text-[12.5px] px-2 py-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                    No workspace members.
                  </div>
                ) : (
                  members.map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] cursor-pointer"
                      style={{ color: 'var(--ink-text)' }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleMember(m.id)}
                      />
                      <span className="truncate">{m.name}</span>
                      <span className="ml-auto text-[12px]" style={{ color: 'var(--ink-text-muted)' }}>
                        {m.email}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </Field>
          )}

          {draft.type === 'team' && (
            <label
              className="flex items-start gap-2.5 mb-3 p-3 rounded-md cursor-pointer"
              style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
            >
              <input
                type="checkbox"
                checked={draft.emailSummaryToParticipants}
                onChange={(e) =>
                  setDraft({ ...draft, emailSummaryToParticipants: e.target.checked })
                }
                className="mt-0.5"
              />
              <span className="text-[13px]" style={{ color: 'var(--ink-text)' }}>
                Email the summary to participants when the huddle is closed
                <span
                  className="block text-[12px] mt-0.5"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  Each participant with an email address will receive the decisions, intentions,
                  follow-ups, notes, and host summary — plus a link to view it online.
                </span>
              </span>
            </label>
          )}

          <Field label="Agenda">
            <div className="space-y-2">
              {draft.defaultTopics.map((t, i) => (
                <div
                  key={i}
                  className="rounded-md p-2"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={t.title}
                      onChange={(e) => updateTopic(i, { title: e.target.value })}
                      placeholder={`Topic ${i + 1} title`}
                      className="z-input flex-1"
                    />
                    <button
                      onClick={() => removeTopic(i)}
                      className="text-[12px] px-2 py-1"
                      style={{ color: 'var(--ink-text-muted)' }}
                      title="Remove topic"
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={t.context}
                    onChange={(e) => updateTopic(i, { context: e.target.value })}
                    placeholder="Context (optional)"
                    rows={1}
                    className="z-input w-full mt-1.5"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={addTopic}
                className="text-[12.5px] px-3 py-1.5 rounded-full"
                style={{
                  background: 'transparent',
                  color: 'var(--ink-accent)',
                  border: '1px dashed var(--ink-border)',
                }}
              >
                + Add topic
              </button>
            </div>
          </Field>
        </div>

        <div
          className="px-5 py-3 flex justify-end gap-2"
          style={{ borderTop: '1px solid var(--ink-border-subtle)' }}
        >
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-full text-[13px]"
            style={{ background: 'transparent', color: 'var(--ink-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={submitting}
            className="px-4 py-1.5 rounded-full text-[13px]"
            style={{
              background: 'var(--ink-accent)',
              color: 'var(--ink-on-accent)',
              fontWeight: 600,
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Saving…' : editing.id ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span
        className="block text-[12px] mb-1.5"
        style={{ color: 'var(--ink-text-muted)', fontWeight: 550 }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
