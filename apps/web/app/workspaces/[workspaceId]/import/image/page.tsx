'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
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

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export default function ImageImportPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.workspaceId as string;
  const isMobile = useIsMobile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('input');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<{ items: { id: string; name: string }[] }>('/workspaces').then(data => setWorkspaces(data.items));
  }, []);

  function setImageFile(f: File) {
    if (!ACCEPTED_TYPES.includes(f.type)) { setError('Only JPG, PNG, WEBP are accepted'); return; }
    if (f.size > MAX_SIZE) { setError('File must be under 10 MB'); return; }
    setError('');
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setImageFile(f);
  }

  useEffect(() => {
    if (step !== 'input') return;
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) setImageFile(blob);
          return;
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [step]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStep('processing');
    const formData = new FormData();
    formData.append('image', file);
    const result = await api<{ id: string }>(`/workspaces/${workspaceId}/ai/import-image`, {
      method: 'POST',
      body: formData,
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
            <h2 className="text-xl font-bold mb-4">Image Import</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--ink-text-muted)' }}>
              Upload or paste (Ctrl+V) a photo of your handwritten notes or whiteboard — AI will extract draft tasks.
            </p>

            {step === 'input' && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="text-sm px-3 py-2 rounded-lg" style={{ background: '#fff0f0', color: 'var(--ink-blocked)' }}>{error}</div>
                )}
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-[var(--ink-accent)]"
                  style={{ borderColor: file ? 'var(--ink-accent)' : 'var(--ink-border)' }}
                >
                  {preview ? (
                    <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                  ) : (
                    <div>
                      <p className="text-lg mb-1">Upload</p>
                      <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>Click to upload or paste from clipboard</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--ink-text-muted)' }}>JPG, PNG, or WEBP up to 10MB — Ctrl+V to paste</p>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
                {file && (
                  <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>
                )}
                <button
                  type="submit"
                  disabled={!file}
                  className="px-6 py-2.5 rounded-lg text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  Extract Tasks
                </button>
              </form>
            )}

            {step === 'processing' && (
              <div className="text-center py-16">
                <div className="animate-pulse text-lg mb-2" style={{ color: 'var(--ink-accent)' }}>Analyzing image…</div>
                <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>AI is reading your notes</p>
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
                  <button onClick={() => { setStep('input'); setFile(null); setPreview(null); setJob(null); }} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>Import more</button>
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
