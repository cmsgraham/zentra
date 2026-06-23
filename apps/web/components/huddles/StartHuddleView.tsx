'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import type { Huddle } from './types';

interface Workspace { id: string; name: string }
interface Member { id: string; name: string; email: string; avatarUrl: string | null }
interface Template {
  id: string;
  name: string;
  type: 'team' | 'personal';
  workspaceId: string | null;
  defaultTitle: string;
  defaultIntention: string | null;
  defaultParticipantUserIds: string[];
  defaultExternalAttendees: { name: string; email?: string | null }[];
  defaultTopics: { title: string; context?: string | null }[];
}

export function StartHuddleView() {
  const router = useRouter();
  const [step, setStep] = useState<'choose' | 'configure'>('choose');
  const [type, setType] = useState<'team' | 'personal' | null>(null);
  const [title, setTitle] = useState('');
  const [intention, setIntention] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [externalAttendees, setExternalAttendees] = useState<{ name: string; email: string }[]>([]);
  const [extName, setExtName] = useState('');
  const [extEmail, setExtEmail] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: Workspace[] }>('/workspaces');
        const items = data?.items ?? [];
        setWorkspaces(items);
        if (items.length > 0) setWorkspaceId(items[0].id);
      } catch {}
      try {
        const t = await api<{ templates: Template[] }>('/huddles/templates');
        setTemplates(t?.templates ?? []);
      } catch {}
    })();
  }, []);

  function applyTemplate(tpl: Template) {
    setTemplateId(tpl.id);
    setType(tpl.type);
    setTitle(tpl.defaultTitle);
    setIntention(tpl.defaultIntention ?? '');
    if (tpl.workspaceId) setWorkspaceId(tpl.workspaceId);
    setSelected(new Set(tpl.defaultParticipantUserIds ?? []));
    setExternalAttendees(
      (tpl.defaultExternalAttendees ?? []).map((a) => ({ name: a.name, email: a.email ?? '' })),
    );
    setStep('configure');
  }

  function addExternal() {
    const name = extName.trim();
    if (!name) return;
    const email = extEmail.trim();
    setExternalAttendees((prev) => [...prev, { name, email }]);
    setExtName('');
    setExtEmail('');
  }
  function removeExternal(idx: number) {
    setExternalAttendees((prev) => prev.filter((_, i) => i !== idx));
  }

  async function deleteTemplate(tid: string) {
    if (!confirm('Delete this template?')) return;
    try {
      await api(`/huddles/templates/${tid}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((t) => t.id !== tid));
      if (templateId === tid) setTemplateId(null);
    } catch {}
  }

  useEffect(() => {
    if (!workspaceId || type !== 'team') { setMembers([]); return; }
    (async () => {
      try {
        const data = await api<{ members: Member[] }>(`/huddles/workspaces/${workspaceId}/members`);
        setMembers(data?.members ?? []);
      } catch {
        setMembers([]);
      }
    })();
  }, [workspaceId, type]);

  function toggleMember(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!type || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    const externals = externalAttendees.map((a) => ({
      name: a.name.trim(),
      email: a.email.trim() ? a.email.trim() : null,
    })).filter((a) => a.name.length > 0);
    try {
      let res: { huddle: Huddle };
      if (templateId) {
        const overrides: any = {
          title: title.trim(),
          intention: intention.trim() || null,
          participantUserIds: type === 'team' ? Array.from(selected) : [],
          externalAttendees: externals,
        };
        if (workspaceId) overrides.workspaceId = workspaceId;
        else if (type === 'personal') overrides.workspaceId = null;
        res = await api<{ huddle: Huddle }>(`/huddles/from-template/${templateId}`, { method: 'POST', body: overrides });
      } else {
        const body: any = {
          type,
          title: title.trim(),
          intention: intention.trim() || null,
          participantUserIds: type === 'team' ? Array.from(selected) : [],
          externalAttendees: externals,
        };
        if (workspaceId) body.workspaceId = workspaceId;
        res = await api<{ huddle: Huddle }>('/huddles', { method: 'POST', body });
      }
      router.push(`/huddles/${res.huddle.id}`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not start huddle');
      setSubmitting(false);
    }
  }

  async function saveAsTemplate() {
    if (!type || !title.trim()) return;
    const name = prompt('Name this template (e.g. "Weekly engineering sync"):', title.trim());
    if (!name || !name.trim()) return;
    const externals = externalAttendees.map((a) => ({
      name: a.name.trim(),
      email: a.email.trim() ? a.email.trim() : null,
    })).filter((a) => a.name.length > 0);
    try {
      const res = await api<{ template: Template }>('/huddles/templates', {
        method: 'POST',
        body: {
          name: name.trim(),
          type,
          workspaceId: workspaceId || null,
          defaultTitle: title.trim(),
          defaultIntention: intention.trim() || null,
          defaultParticipantUserIds: type === 'team' ? Array.from(selected) : [],
          defaultExternalAttendees: externals,
          defaultTopics: [],
        },
      });
      setTemplates((prev) => [res.template, ...prev]);
      setTemplateId(res.template.id);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save template');
    }
  }

  if (step === 'choose') {
    return (
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-16 w-full">
        <div className="text-center mb-10">
          <h1 className="z-page-title">Start a Huddle</h1>
          <p className="z-body mt-2" style={{ color: 'var(--ink-text-secondary)' }}>
            Choose how you want this conversation to move things forward.
          </p>
        </div>

        {templates.length > 0 ? (
          <div className="mb-8">
            <div className="flex items-baseline justify-between mb-2.5">
              <h3 className="text-[12.5px] uppercase tracking-wider" style={{ color: 'var(--ink-text-muted)', fontWeight: 600, letterSpacing: '0.06em' }}>
                Your templates
              </h3>
              <Link
                href="/huddles/templates"
                className="text-[11.5px]"
                style={{ color: 'var(--ink-accent)', fontWeight: 550 }}
              >
                Manage templates →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="inline-flex items-center gap-1.5 rounded-full pl-3 pr-1 py-0.5"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border-subtle)' }}
                >
                  <button
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="inline-flex items-center gap-1.5 py-1.5"
                    style={{ color: 'var(--ink-text)', fontWeight: 550 }}
                  >
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{
                        background: tpl.type === 'team' ? 'var(--ink-accent-light)' : 'var(--ink-surface-raised)',
                        color: tpl.type === 'team' ? 'var(--ink-accent)' : 'var(--ink-text-secondary)',
                        fontWeight: 600, letterSpacing: '0.06em',
                      }}
                    >
                      {tpl.type === 'team' ? 'Team' : '1:1'}
                    </span>
                    <span className="text-[13px]">{tpl.name}</span>
                    {tpl.defaultTopics.length > 0 && (
                      <span className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                        · {tpl.defaultTopics.length} topic{tpl.defaultTopics.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteTemplate(tpl.id)}
                    aria-label="Delete template"
                    className="inline-flex items-center justify-center rounded-full"
                    style={{ width: 22, height: 22, color: 'var(--ink-text-muted)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ink-surface-hover)'; e.currentTarget.style.color = 'var(--ink-blocked)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-text-muted)'; }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="mb-8 flex items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ background: 'var(--ink-surface)', border: '1px dashed var(--ink-border)' }}
          >
            <div className="min-w-0">
              <div className="text-[13px]" style={{ color: 'var(--ink-text)', fontWeight: 550 }}>
                Save recurring huddles as templates
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                Pre-fill title, intention, participants, and agenda — and optionally email the
                summary to participants on close.
              </div>
            </div>
            <Link
              href="/huddles/templates"
              className="shrink-0 px-3 py-1.5 rounded-full text-[12.5px] whitespace-nowrap"
              style={{
                background: 'var(--ink-accent)',
                color: 'var(--ink-on-accent)',
                fontWeight: 600,
              }}
            >
              + Create template
            </Link>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <HuddleTypeCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="8" r="3.2"/><circle cx="17" cy="9" r="2.6"/>
                <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5"/>
                <path d="M14.5 16.5c.4-1.6 2-3 3.5-3s2.6 1 3 2.5"/>
              </svg>
            }
            title="Team Huddle"
            tagline="Coordinate people and move work forward."
            description="Weekly syncs, project alignment, leadership check-ins. Multiple voices, one direction."
            onClick={() => { setType('team'); setStep('configure'); }}
          />
          <HuddleTypeCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.5"/>
                <path d="M5.5 20c.7-3.4 3.4-5.5 6.5-5.5s5.8 2.1 6.5 5.5"/>
                <path d="M19 4l-1 2-2-1 2-1z" fill="currentColor"/>
              </svg>
            }
            title="Personal Huddle"
            tagline="Support progress and create momentum."
            description="1:1s, coaching, mentoring, growth conversations. One person, one warm push forward."
            onClick={() => { setType('personal'); setStep('configure'); }}
          />
        </div>
      </div>
    );
  }

  // Configure step
  return (
    <div className="max-w-2xl mx-auto px-5 sm:px-8 py-10 sm:py-12 w-full">
      <button
        onClick={() => setStep('choose')}
        className="z-caption mb-5 inline-flex items-center gap-1.5"
        style={{ color: 'var(--ink-text-muted)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>

      <div className="mb-7">
        <div className="inline-flex items-center gap-2 mb-2 flex-wrap">
          <span
            className="text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{
              background: type === 'team' ? 'var(--ink-accent-light)' : 'var(--ink-surface-raised)',
              color: type === 'team' ? 'var(--ink-accent)' : 'var(--ink-text-secondary)',
              fontWeight: 600, letterSpacing: '0.06em',
            }}
          >
            {type === 'team' ? 'Team Huddle' : 'Personal Huddle'}
          </span>
          {templateId && (
            <button
              type="button"
              onClick={() => setTemplateId(null)}
              className="inline-flex items-center gap-1 text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--ink-surface)',
                color: 'var(--ink-text-secondary)',
                border: '1px solid var(--ink-border-subtle)',
                fontWeight: 600, letterSpacing: '0.06em',
              }}
              title="Clear template (start a fresh huddle instead)"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              From template
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
        <h1 className="z-page-title">Set the stage</h1>
      </div>

      <div className="space-y-5">
        <Field label="Title" hint="What is this huddle called?">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'team' ? 'Weekly sync' : 'Catch-up with Sam'}
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px]"
            style={{
              background: 'var(--ink-surface)', color: 'var(--ink-text)',
              border: '1px solid var(--ink-border)', outline: 'none',
            }}
            autoFocus
          />
        </Field>

        <Field label="Intention" hint="What matters most from this huddle?">
          <textarea
            value={intention}
            onChange={(e) => setIntention(e.target.value)}
            placeholder={type === 'team'
              ? 'Align on this week’s priorities and unblock anything stuck.'
              : 'Support their progress and surface what’s in the way.'}
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px] resize-none"
            style={{
              background: 'var(--ink-surface)', color: 'var(--ink-text)',
              border: '1px solid var(--ink-border)', outline: 'none', lineHeight: 1.5,
            }}
          />
        </Field>

        {workspaces.length > 0 && (
          <Field label="Space" hint={type === 'team' ? 'Required for team huddles.' : 'Optional — keep this huddle tied to a space.'}>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg text-[14px]"
              style={{
                background: 'var(--ink-surface)', color: 'var(--ink-text)',
                border: '1px solid var(--ink-border)', outline: 'none',
              }}
            >
              {type === 'personal' && <option value="">— No space —</option>}
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        )}

        {type === 'team' && members.length > 0 && (
          <Field label="Invite" hint="Who else is in this huddle?">
            <div
              className="rounded-lg p-1.5 max-h-56 overflow-y-auto"
              style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
            >
              {members.map((m) => {
                const on = selected.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-all"
                    style={{
                      background: on ? 'var(--ink-accent-light)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--ink-surface-hover)'; }}
                    onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Avatar name={m.name} url={m.avatarUrl} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] truncate" style={{ color: 'var(--ink-text)', fontWeight: on ? 600 : 450 }}>
                        {m.name}
                      </div>
                      <div className="text-[11.5px] truncate" style={{ color: 'var(--ink-text-muted)' }}>
                        {m.email}
                      </div>
                    </div>
                    <span
                      style={{
                        width: 18, height: 18, borderRadius: '50%',
                        border: `1.5px solid ${on ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                        background: on ? 'var(--ink-accent)' : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: 'var(--ink-on-accent)', flexShrink: 0,
                      }}
                    >
                      {on && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field
          label="External attendees"
          hint="People joining but not in the app. They'll appear on the attendee list and can receive the meeting minute by email."
        >
          {externalAttendees.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {externalAttendees.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1 py-0.5 text-[12px]"
                  style={{
                    background: 'var(--ink-surface)',
                    border: '1px solid var(--ink-border-subtle)',
                    color: 'var(--ink-text)',
                  }}
                >
                  <span>{a.name}{a.email ? ` <${a.email}>` : ''}</span>
                  <button
                    type="button"
                    onClick={() => removeExternal(i)}
                    aria-label={`Remove ${a.name}`}
                    className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                    style={{ color: 'var(--ink-text-muted)' }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              value={extName}
              onChange={(e) => setExtName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal(); } }}
              placeholder="Name"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg text-[13.5px]"
              style={{
                background: 'var(--ink-surface)', color: 'var(--ink-text)',
                border: '1px solid var(--ink-border)', outline: 'none',
              }}
            />
            <input
              value={extEmail}
              onChange={(e) => setExtEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal(); } }}
              placeholder="Email (optional)"
              type="email"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg text-[13.5px]"
              style={{
                background: 'var(--ink-surface)', color: 'var(--ink-text)',
                border: '1px solid var(--ink-border)', outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={addExternal}
              disabled={!extName.trim()}
              className="px-3 py-2 rounded-lg text-[13px]"
              style={{
                background: 'var(--ink-accent-light)', color: 'var(--ink-accent)',
                fontWeight: 600, opacity: !extName.trim() ? 0.45 : 1,
                cursor: !extName.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              Add
            </button>
          </div>
        </Field>

        {error && (
          <div className="text-[13px] px-3 py-2 rounded-lg" style={{ color: 'var(--ink-blocked)', background: 'var(--ink-surface)' }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            onClick={submit}
            disabled={!title.trim() || submitting || (type === 'team' && !workspaceId)}
            className="px-5 py-2.5 rounded-full text-[14px] transition-all"
            style={{
              background: 'var(--ink-accent)', color: 'var(--ink-on-accent)',
              fontWeight: 600, opacity: !title.trim() || submitting ? 0.55 : 1,
              cursor: !title.trim() || submitting ? 'not-allowed' : 'pointer',
              boxShadow: 'var(--ink-shadow-md)',
            }}
          >
            {submitting ? 'Starting…' : 'Start Huddle'}
          </button>
          <button
            onClick={() => router.push('/huddles')}
            className="px-4 py-2.5 rounded-full text-[14px]"
            style={{ color: 'var(--ink-text-muted)', background: 'transparent' }}
          >
            Cancel
          </button>
          {!templateId && (
            <button
              type="button"
              onClick={saveAsTemplate}
              disabled={!title.trim() || submitting}
              className="ml-auto px-3 py-2 rounded-full text-[12.5px]"
              style={{
                color: 'var(--ink-text-secondary)', background: 'transparent',
                border: '1px dashed var(--ink-border)',
                opacity: !title.trim() ? 0.5 : 1,
                cursor: !title.trim() ? 'not-allowed' : 'pointer',
              }}
              title="Save these settings as a reusable template"
            >
              Save as template
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function HuddleTypeCard({
  icon, title, tagline, description, onClick,
}: { icon: React.ReactNode; title: string; tagline: string; description: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-left p-6 rounded-2xl transition-all group"
      style={{
        background: 'var(--ink-surface)',
        border: '1px solid var(--ink-border-subtle)',
        boxShadow: 'var(--ink-shadow-sm)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--ink-shadow-lg)';
        e.currentTarget.style.borderColor = 'var(--ink-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--ink-shadow-sm)';
        e.currentTarget.style.borderColor = 'var(--ink-border-subtle)';
      }}
    >
      <div
        className="inline-flex items-center justify-center mb-4"
        style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--ink-accent-light)', color: 'var(--ink-accent)',
        }}
      >
        {icon}
      </div>
      <h3 className="text-[17px] font-semibold mb-1" style={{ color: 'var(--ink-text)' }}>{title}</h3>
      <p className="text-[13.5px] mb-3" style={{ color: 'var(--ink-text-secondary)', fontWeight: 500 }}>{tagline}</p>
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-text-muted)' }}>{description}</p>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12.5px] mb-1.5" style={{ color: 'var(--ink-text-secondary)', fontWeight: 600 }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--ink-text-muted)' }}>{hint}</p>}
    </div>
  );
}

export function Avatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  const initials = (name ?? '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 overflow-hidden"
      style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--ink-accent-light)', color: 'var(--ink-accent)',
        fontSize: Math.max(10, Math.floor(size * 0.4)), fontWeight: 600,
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : initials}
    </span>
  );
}
