'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';

interface ImportItem {
  id: string;
  proposedName: string;
  proposedQuantity: number | null;
  proposedUnit: string | null;
  confidenceScore: number;
}

interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  errorMessage?: string | null;
  items: ImportItem[];
}

interface Props {
  listId: string;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'input' | 'processing' | 'review' | 'done';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;

export default function ListImageImportModal({ listId, onClose, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('input');
  const [items, setItems] = useState<ImportItem[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  function setImageFile(f: File) {
    if (!ACCEPTED_TYPES.includes(f.type)) { setError('Only JPG, PNG, WEBP are accepted'); return; }
    if (f.size > MAX_SIZE) { setError('File must be under 10 MB'); return; }
    setError('');
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  useEffect(() => {
    if (step !== 'input') return;
    function handlePaste(e: ClipboardEvent) {
      const clipItems = e.clipboardData?.items;
      if (!clipItems) return;
      for (const item of clipItems) {
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
    formData.append('file', file);
    try {
      const result = await api<{ id: string }>('/shopping/ai/import-image', {
        method: 'POST',
        body: formData,
      });
      await pollJob(result.id);
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
      setStep('input');
    }
  }

  async function pollJob(id: string) {
    setJobId(id);
    let attempts = 0;
    while (attempts < 30) {
      const data = await api<JobStatus>(`/shopping/ai/import-jobs/${id}`);
      if (data.status === 'completed') {
        setItems(data.items);
        setCheckedIds(new Set(data.items.map((i) => i.id)));
        setStep('review');
        return;
      }
      if (data.status === 'failed') {
        setError(data.errorMessage ?? 'The image could not be read.');
        setStep('input');
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
      attempts++;
    }
    setError('Timed out — please try again.');
    setStep('input');
  }

  function toggleItem(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAccept() {
    if (!jobId || checkedIds.size === 0) return;
    setAccepting(true);
    try {
      await api(`/shopping/ai/import-jobs/${jobId}/accept`, {
        method: 'POST',
        body: { itemIds: Array.from(checkedIds), listId },
      });
      onImported();
      setStep('done');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add items');
      setAccepting(false);
    }
  }

  function reset() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    setStep('input');
    setItems([]);
    setCheckedIds(new Set());
    setJobId(null);
    setError('');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center z-animate-fade"
      style={{ background: 'var(--ink-overlay)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg p-6 z-overlay z-animate-in"
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold">Image Import</h2>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>✕</button>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--ink-text-muted)' }}>
          Upload or paste (Ctrl+V) a photo of your handwritten list or whiteboard — AI will extract draft items.
        </p>

        {step === 'input' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" style={{ background: '#fff0f0', color: 'var(--ink-blocked)' }}>
                {error}
              </div>
            )}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-[var(--ink-accent)]"
              style={{ borderColor: file ? 'var(--ink-accent)' : 'var(--ink-border)' }}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
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
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setImageFile(f); }}
                className="hidden"
              />
            </div>
            {file && (
              <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
            <button
              type="submit"
              disabled={!file}
              className="px-6 py-2.5 rounded-lg text-sm text-white disabled:opacity-50"
              style={{ background: 'var(--ink-accent)' }}
            >
              Extract Items
            </button>
          </form>
        )}

        {step === 'processing' && (
          <div className="text-center py-16">
            <div className="animate-pulse text-lg mb-2" style={{ color: 'var(--ink-accent)' }}>Analyzing image…</div>
            <p className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>AI is reading your list</p>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3">
            <p className="text-sm mb-1" style={{ color: 'var(--ink-text-muted)' }}>
              Review what we found. Uncheck anything you don't want to add.
            </p>
            {items.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--ink-text-muted)' }}>
                We couldn't find any items in that image.
              </p>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {items.map((it) => (
                  <label
                    key={it.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer"
                    style={{ background: checkedIds.has(it.id) ? 'var(--ink-subtle, rgba(0,0,0,0.03))' : 'transparent' }}
                  >
                    <input
                      type="checkbox"
                      checked={checkedIds.has(it.id)}
                      onChange={() => toggleItem(it.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{it.proposedName}</div>
                      {(it.proposedQuantity != null || it.proposedUnit) && (
                        <div className="text-[11px]" style={{ color: 'var(--ink-text-muted)' }}>
                          {it.proposedQuantity != null && `x${it.proposedQuantity}`}
                          {it.proposedUnit && ` ${it.proposedUnit}`}
                          {' - '}{Math.round(it.confidenceScore * 100)}% confidence
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
            {error && <p className="text-xs" style={{ color: 'var(--ink-blocked)' }}>{error}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={reset} className="z-btn flex-1">Try again</button>
              <button
                onClick={handleAccept}
                disabled={checkedIds.size === 0 || accepting}
                className="px-6 py-2.5 rounded-lg text-sm text-white disabled:opacity-50 flex-1"
                style={{ background: 'var(--ink-accent)' }}
              >
                {accepting ? 'Adding...' : `Add ${checkedIds.size} item${checkedIds.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-12">
            <p className="text-lg mb-4" style={{ color: 'var(--ink-done)' }}>
              {checkedIds.size} item{checkedIds.size === 1 ? '' : 's'} added successfully!
            </p>
            <div className="flex gap-3 justify-center">
              <button onClick={reset} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>
                Import more
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-white"
                style={{ background: 'var(--ink-accent)' }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
