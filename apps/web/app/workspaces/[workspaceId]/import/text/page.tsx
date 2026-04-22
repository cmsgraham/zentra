'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import WorkspaceSidebar from '@/components/layout/WorkspaceSidebar';
import ImportReviewPanel from '@/components/ai/ImportReviewPanel';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';

interface DraftItem {
  id: string;
  title: string;
  suggestedStatus: string;
  suggestedPriority: string;
  confidence: number;
  ambiguityNote?: string;
  sourceSnippet?: string;
}

interface ImportJob {
  id: string;
  status: string;
  items: DraftItem[];
}

type Step = 'input' | 'processing' | 'review' | 'done';

export default function TextImportPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const isMobile = useIsMobile();
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>('/workspaces').then(data => setWorkspaces(data.items));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStep('processing');
    const result = await api<{ id: string }>(`/workspaces/${workspaceId}/ai/import-text`, {
      method: 'POST',
      body: { text },
    });
    await pollJob(result.id);
  }

  async function pollJob(jobId: string) {
    let attempts = 0;
    while (attempts < 30) {
      const j = await api<any>(`/ai/import-jobs/${jobId}`);
      if (j.status === 'completed') {
        const mapped: ImportJob = {
          ...j,
          items: (j.items || []).map((r: any) => ({
            id: r.id,
            title: r.proposedTitle || r.title || 'Untitled',
            suggestedStatus: r.proposedStatus || r.suggestedStatus || 'pending',
            suggestedPriority: r.proposedPriority || r.suggestedPriority || 'medium',
            confidence: r.confidenceScore ?? r.confidence ?? 0.5,
            ambiguityNote: Array.isArray(r.ambiguityFlags) ? r.ambiguityFlags.join(', ') : r.ambiguityNote,
            sourceSnippet: r.originalTextSnippet || r.sourceSnippet,
          })),
        };
        setJob(mapped);
        setStep('review');
        return;
      }
      if (j.status === 'failed') {
        setStep('input');
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
    }
    setStep('input');
  }

  async function handleAccept(ids: string[], targetWorkspaceId: string) {
    if (!job) return;
    setAccepting(true);
    await api(`/ai/import-jobs/${job.id}/accept`, {
      method: 'POST',
      body: { itemIds: ids, workspaceId: targetWorkspaceId },
    });
    setAccepting(false);
    setStep('done');
  }

  return (
    <AuthShell>
      <div className="flex flex-1 h-[calc(100vh-57px)]">
        {!isMobile && <WorkspaceSidebar workspaceId={workspaceId} />}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-xl font-bold mb-4">Text Import</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-text-muted)' }}>
              Paste your notes, meeting minutes, or any text — AI will extract draft tasks for you to review.
            </p>

            {step === 'input' && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  required
                  placeholder="Paste your text here…"
                  className="w-full px-4 py-3 rounded-xl text-sm"
                  style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
                />
                <button
                  type="submit"
                  disabled={!text.trim()}
                  className="px-6 py-2.5 rounded-lg text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  Extract Tasks
                </button>
              </form>
            )}

            {step === 'processing' && (
              <div className="text-center py-16">
                <div className="animate-pulse text-lg mb-2" style={{ color: 'var(--ink-accent)' }}>Analyzing text…</div>
                <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>AI is extracting intentions from your text</p>
              </div>
            )}

            {step === 'review' && job && (
              <ImportReviewPanel
                items={job.items}
                workspaces={workspaces}
                currentWorkspaceId={workspaceId}
                onAccept={handleAccept}
                onCancel={() => { setStep('input'); setJob(null); }}
                loading={accepting}
              />
            )}

            {step === 'done' && (
              <div className="text-center py-16">
                <p className="text-lg mb-4" style={{ color: 'var(--ink-done)' }}>Tasks imported successfully!</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => { setStep('input'); setText(''); setJob(null); }} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>Import more</button>
                  <button onClick={() => router.push(`/workspaces/${workspaceId}`)} className="px-4 py-2 rounded-lg text-sm text-white" style={{ background: 'var(--ink-accent)' }}>Go to board</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
