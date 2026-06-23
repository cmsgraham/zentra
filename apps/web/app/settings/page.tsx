'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api-client';
import AuthenticatedLayout from '@/components/layout/AuthShell';
import SecuritySection from '@/components/settings/SecuritySection';
import DangerZoneSection from '@/components/settings/DangerZoneSection';
import { resetTour, useTour } from '@/lib/useTour';

const COMMON_TIMEZONES = [
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage',
  'Pacific/Honolulu','America/Phoenix','America/Toronto','America/Vancouver','America/Mexico_City',
  'America/Bogota','America/Sao_Paulo','America/Argentina/Buenos_Aires','Europe/London','Europe/Paris',
  'Europe/Berlin','Europe/Madrid','Europe/Rome','Europe/Amsterdam','Europe/Moscow','Asia/Dubai',
  'Asia/Kolkata','Asia/Bangkok','Asia/Singapore','Asia/Shanghai','Asia/Tokyo','Asia/Seoul',
  'Australia/Sydney','Australia/Melbourne','Pacific/Auckland',
];

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = fmt.formatToParts(now);
    const offset = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return `${tz.replace(/_/g, ' ')} (${offset})`;
  } catch { return tz; }
}

type SectionId = 'profile' | 'preferences' | 'security' | 'walkthrough' | 'danger';

const SECTIONS: { id: SectionId; label: string; description: string }[] = [
  { id: 'profile', label: 'Profile', description: 'Your name, email and timezone' },
  { id: 'preferences', label: 'Preferences', description: 'Intention defaults, focus & AI' },
  { id: 'security', label: 'Security', description: 'Password & sign-in' },
  { id: 'walkthrough', label: 'Walkthrough', description: 'Replay the product tour' },
  { id: 'danger', label: 'Danger zone', description: 'Delete account' },
];

export default function SettingsPage() {
  const { user, loadUser } = useAuth();
  const [section, setSection] = useState<SectionId>('profile');

  // Profile
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');

  // Preferences — intention defaults
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskComplexity, setTaskComplexity] = useState('1');
  const [taskEstMinutes, setTaskEstMinutes] = useState('');

  // Preferences — focus / Zentra
  const [sessionMinutes, setSessionMinutes] = useState(25);
  const [startOfDay, setStartOfDay] = useState('09:00');
  const [endOfDay, setEndOfDay] = useState('18:00');
  const [dndStart, setDndStart] = useState('');
  const [dndEnd, setDndEnd] = useState('');
  const [aiOptIn, setAiOptIn] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setTaskPriority(user.taskDefaultPriority || 'medium');
      setTaskComplexity(String(user.taskDefaultComplexity || 1));
      setTaskEstMinutes(user.taskDefaultEstimatedMinutes ? String(user.taskDefaultEstimatedMinutes) : '');
      const u = user as any;
      if (u.zentraDefaultSessionMinutes) setSessionMinutes(u.zentraDefaultSessionMinutes);
      if (u.zentraStartOfDayTime) setStartOfDay(u.zentraStartOfDayTime);
      if (u.zentraEndOfDayTime) setEndOfDay(u.zentraEndOfDayTime);
      if (u.zentraDndStart) setDndStart(u.zentraDndStart);
      if (u.zentraDndEnd) setDndEnd(u.zentraDndEnd);
      if (u.zentraAiOptIn !== undefined) setAiOptIn(!!u.zentraAiOptIn);
    }
  }, [user]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api('/auth/me', {
        method: 'PATCH',
        body: {
          name,
          timezone,
          taskDefaultPriority: taskPriority,
          taskDefaultComplexity: parseInt(taskComplexity) || 1,
          taskDefaultEstimatedMinutes: taskEstMinutes ? parseInt(taskEstMinutes) : null,
          zentraDefaultSessionMinutes: sessionMinutes,
          zentraStartOfDayTime: startOfDay,
          zentraEndOfDayTime: endOfDay,
          zentraDndStart: dndStart || null,
          zentraDndEnd: dndEnd || null,
          zentraAiOptIn: aiOptIn,
        },
      });
      await loadUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const allTimezones = COMMON_TIMEZONES.includes(detectedTz)
    ? COMMON_TIMEZONES
    : [detectedTz, ...COMMON_TIMEZONES];

  const fieldStyle = { border: '1px solid var(--ink-border)', background: 'var(--ink-bg)', color: 'var(--ink-text)' } as const;

  return (
    <AuthenticatedLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold mb-6">Settings</h1>

        <div className="flex flex-col md:flex-row gap-6">
          {/* Sidebar nav */}
          <nav className="md:w-56 shrink-0">
            <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
              {SECTIONS.map((s) => {
                const active = section === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSection(s.id)}
                      className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap"
                      style={{
                        background: active ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                        color: active ? 'var(--ink-accent)' : 'var(--ink-text)',
                        fontWeight: active ? 600 : 400,
                        border: `1px solid ${active ? 'color-mix(in srgb, var(--ink-accent) 30%, transparent)' : 'transparent'}`,
                      }}
                    >
                      <span className="block">{s.label}</span>
                      <span className="hidden md:block text-[11px] mt-0.5" style={{ color: 'var(--ink-text-muted)', fontWeight: 400 }}>
                        {s.description}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Section panel */}
          <section className="flex-1 max-w-xl">
            {section === 'profile' && (
              <div className="space-y-5">
                <SectionHeader title="Profile" subtitle="How you appear in Zentra and where you live time-wise." />

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Display name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Email</label>
                  <input type="email" value={user?.email || ''} disabled className="w-full px-3 py-2 rounded-lg text-sm opacity-60"
                    style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)', color: 'var(--ink-text)' }} />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Timezone</label>
                  <select value={timezone} onChange={e => setTimezone(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={fieldStyle}>
                    {allTimezones.map(tz => (<option key={tz} value={tz}>{formatTzLabel(tz)}</option>))}
                  </select>
                  {timezone !== detectedTz && (
                    <button onClick={() => setTimezone(detectedTz)} className="text-xs mt-1" style={{ color: 'var(--ink-accent)' }}>
                      Use detected: {detectedTz}
                    </button>
                  )}
                </div>

                <SaveBar saving={saving} saved={saved} onSave={handleSave} disabled={!name.trim()} />
              </div>
            )}

            {section === 'preferences' && (
              <div className="space-y-7">
                <SectionHeader title="Preferences" subtitle="Defaults Zentra uses when creating intentions and shaping your day." />

                {/* Intention Defaults */}
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--ink-text-muted)' }}>Intention Defaults</p>
                  <p className="text-xs mb-4" style={{ color: 'var(--ink-text-muted)' }}>Used when quick-adding intentions on the board.</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Default priority</label>
                      <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={fieldStyle}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Default complexity</label>
                      <div className="flex gap-2">
                        {[{ v: '1', l: 'Simple' }, { v: '2', l: 'Moderate' }, { v: '3', l: 'Complex' }].map(({ v, l }) => (
                          <button key={v} type="button" onClick={() => setTaskComplexity(v)} className="flex-1 text-xs py-2 rounded-md transition-all"
                            style={{
                              border: `1.5px solid ${taskComplexity === v ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                              background: taskComplexity === v ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                              color: taskComplexity === v ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                              fontWeight: taskComplexity === v ? 600 : 400,
                            }}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Default time estimate (minutes)</label>
                      <input type="number" value={taskEstMinutes} onChange={(e) => setTaskEstMinutes(e.target.value)} placeholder="None"
                        min="1" max="480" className="w-full px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                    </div>
                  </div>
                </div>

                {/* Focus */}
                <div className="pt-5 border-t" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                  <p className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--ink-text-muted)' }}>Focus</p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Default session length</label>
                      <div className="flex gap-2">
                        {[15, 25, 50].map((m) => (
                          <button key={m} type="button" onClick={() => setSessionMinutes(m)} className="flex-1 text-xs py-2 rounded-md transition-all"
                            style={{
                              border: `1.5px solid ${sessionMinutes === m ? 'var(--ink-accent)' : 'var(--ink-border)'}`,
                              background: sessionMinutes === m ? 'color-mix(in srgb, var(--ink-accent) 10%, transparent)' : 'transparent',
                              color: sessionMinutes === m ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                              fontWeight: sessionMinutes === m ? 600 : 400,
                            }}>
                            {m} min
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Working hours</label>
                      <div className="flex gap-2 items-center">
                        <input type="time" value={startOfDay} onChange={(e) => setStartOfDay(e.target.value)} className="flex-1 px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                        <span className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>to</span>
                        <input type="time" value={endOfDay} onChange={(e) => setEndOfDay(e.target.value)} className="flex-1 px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>Used for the urgency indicator and AI plan generation.</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--ink-text-muted)' }}>Do not disturb</label>
                      <div className="flex gap-2 items-center">
                        <input type="time" value={dndStart} onChange={(e) => setDndStart(e.target.value)} placeholder="Start" className="flex-1 px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                        <span className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>to</span>
                        <input type="time" value={dndEnd} onChange={(e) => setDndEnd(e.target.value)} placeholder="End" className="flex-1 px-3 py-2 rounded-lg text-sm" style={fieldStyle} />
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>Suppresses in-app prompts during these hours.</p>
                    </div>

                    <div>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={aiOptIn} onChange={(e) => setAiOptIn(e.target.checked)} className="mt-0.5"
                          style={{ accentColor: 'var(--ink-accent)', width: '16px', height: '16px' }} />
                        <span>
                          <span className="block text-sm font-medium" style={{ color: 'var(--ink-text)' }}>Allow AI assistance</span>
                          <span className="block text-xs mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                            Task titles and descriptions may be sent to OpenAI to generate decompositions and next-action suggestions. No data is used for training.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                <SaveBar saving={saving} saved={saved} onSave={handleSave} disabled={!name.trim()} />
              </div>
            )}

            {section === 'security' && (
              <div className="space-y-5">
                <SectionHeader title="Security" subtitle="Password and sign-in." />
                <SecuritySection />
              </div>
            )}

            {section === 'walkthrough' && (
              <div className="space-y-5">
                <SectionHeader title="Walkthrough" subtitle="Replay the product tour anytime." />
                <ProductTourSection />
              </div>
            )}

            {section === 'danger' && (
              <div className="space-y-5">
                <SectionHeader title="Danger zone" subtitle="Permanent actions. No takebacks." />
                <DangerZoneSection />
              </div>
            )}
          </section>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--ink-text)' }}>{title}</h2>
      <p className="text-xs mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>{subtitle}</p>
    </div>
  );
}

function SaveBar({ saving, saved, onSave, disabled }: { saving: boolean; saved: boolean; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button onClick={onSave} disabled={saving || disabled} className="px-4 py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: 'var(--ink-accent)', opacity: (saving || disabled) ? 0.6 : 1 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saved && (<span className="text-sm" style={{ color: 'var(--ink-accent)' }}>Saved!</span>)}
    </div>
  );
}

function ProductTourSection() {
  const start = useTour((s) => s.start);
  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--ink-text-muted)' }}>
        Replay the product tour explaining Studio, Spaces, Canvas, Flow, Lists, Echoes and more.
      </p>
      <button type="button" onClick={() => { resetTour(); start(); }} className="px-4 py-2 rounded-lg text-sm font-medium"
        style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)', color: 'var(--ink-text)' }}>
        Restart product tour
      </button>
    </div>
  );
}
