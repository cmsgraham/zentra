'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';

interface ExtractedEvent {
  title: string;
  date: string;
  start: string;
  end: string;
  selected: boolean;
}

interface AICalendarExtractModalProps {
  date: string;
  onClose: () => void;
  onImported: () => void;
}

export default function AICalendarExtractModal({ date, onClose, onImported }: AICalendarExtractModalProps) {
  const [step, setStep] = useState<'upload' | 'loading' | 'review'>('upload');
  const [events, setEvents] = useState<ExtractedEvent[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<File | null>(null);

  const handleFileSelect = useCallback((file: File | undefined) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG, and WEBP images are supported');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB');
      return;
    }
    selectedFileRef.current = file;
    setError('');
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  // Listen for clipboard paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      if (step !== 'upload') return;

      // Try clipboardData.items first (Chrome, Edge)
      const items = e.clipboardData?.items;
      if (items) {
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) handleFileSelect(file);
            return;
          }
        }
      }

      // Fallback: try clipboardData.files (Firefox, Safari)
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        for (const file of Array.from(files)) {
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            handleFileSelect(file);
            return;
          }
        }
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [step, handleFileSelect]);

  async function extractEvents() {
    const file = selectedFileRef.current;
    if (!file) return;

    setStep('loading');
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('fallbackDate', date);

      const result = await api<{ events: { title: string; date: string; start: string; end: string }[] }>(
        '/appointments/ai/extract-from-image',
        { method: 'POST', body: formData },
      );

      if (!result.events || result.events.length === 0) {
        setError('No events found in this image. Try a clearer screenshot.');
        setStep('upload');
        return;
      }

      setEvents(result.events.map(e => ({ ...e, selected: true })));
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Failed to extract events');
      setStep('upload');
    }
  }

  async function importEvents() {
    const selected = events.filter(e => e.selected);
    if (selected.length === 0) return;

    setImporting(true);
    try {
      await api('/appointments/ai/import', {
        method: 'POST',
        body: {
          events: selected.map(({ title, date, start, end }) => ({ title, date, start, end })),
        },
      });
      onImported();
    } catch (err: any) {
      setError(err.message || 'Failed to import events');
      setImporting(false);
    }
  }

  function toggleEvent(index: number) {
    setEvents(prev => prev.map((e, i) => i === index ? { ...e, selected: !e.selected } : e));
  }

  function toggleAll() {
    const allSelected = events.every(e => e.selected);
    setEvents(prev => prev.map(e => ({ ...e, selected: !allSelected })));
  }

  const selectedCount = events.filter(e => e.selected).length;

  // Group events by date for display
  const grouped = events.reduce<Record<string, ExtractedEvent[]>>((acc, e, i) => {
    const key = e.date;
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...e, selected: e.selected });
    return acc;
  }, {});

  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Auto-focus the modal content so paste events fire
  useEffect(() => {
    if (step === 'upload' && dropZoneRef.current) {
      dropZoneRef.current.focus();
    }
  }, [step]);

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-xl flex flex-col"
        style={{ background: 'var(--ink-card-bg)', border: '1px solid var(--ink-border)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--ink-border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-text)' }}>
              Import from Screenshot
            </h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
              Extract events from a schedule image
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none px-1 rounded hover:opacity-60 transition-opacity"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div
              className="mb-3 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'color-mix(in srgb, var(--ink-blocked) 12%, transparent)', color: 'var(--ink-blocked)' }}
            >
              {error}
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-4">
              {/* Drop zone / file picker */}
              <div
                ref={dropZoneRef}
                tabIndex={0}
                className="flex flex-col items-center justify-center rounded-xl py-10 px-4 cursor-pointer transition-all duration-150 outline-none focus:ring-2 focus:ring-offset-1"
                style={{
                  border: '2px dashed var(--ink-border)',
                  background: preview ? 'transparent' : 'color-mix(in srgb, var(--ink-surface) 50%, transparent)',
                  // @ts-ignore
                  '--tw-ring-color': 'var(--ink-accent)',
                }}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFileSelect(e.dataTransfer.files[0]);
                }}
              >
                {preview ? (
                  <div className="w-full">
                    <img
                      src={preview}
                      alt="Schedule preview"
                      className="w-full max-h-48 object-contain rounded-lg mb-3"
                    />
                    <p className="text-[10px] text-center" style={{ color: 'var(--ink-text-muted)' }}>
                      Click or drop to change image
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="text-3xl mb-2">Cal</div>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--ink-text)' }}>
                      Upload a schedule screenshot
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--ink-text-muted)' }}>
                      Paste from clipboard, drop an image, or click to browse
                    </p>
                    <p className="text-[9px] mt-1.5 px-2 py-1 rounded-md" style={{ color: 'var(--ink-accent)', background: 'color-mix(in srgb, var(--ink-accent) 8%, transparent)' }}>
                      Ctrl+V to paste
                    </p>
                    <p className="text-[9px] mt-2" style={{ color: 'var(--ink-text-muted)' }}>
                      Supports JPG, PNG, WEBP · Max 10 MB
                    </p>
                  </>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
              </div>

              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--ink-text-muted)' }}>
                Works with screenshots from Google Calendar, Apple Calendar, Outlook, or any schedule view.
                The AI will extract event titles, dates, and times.
              </p>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div
                className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mb-3"
                style={{ borderColor: 'var(--ink-accent)', borderTopColor: 'transparent' }}
              />
              <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                Analyzing your schedule...
              </p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--ink-text-muted)' }}>
                  Extracted Events
                </p>
                <button
                  onClick={toggleAll}
                  className="z-btn z-btn-primary z-btn-xs"
                >
                  {events.every(e => e.selected) ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, dateEvents]) => (
                <div key={dateKey}>
                  <p className="text-[10px] font-medium mb-1.5 px-1" style={{ color: 'var(--ink-text-muted)' }}>
                    {new Date(dateKey + 'T00:00:00').toLocaleDateString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </p>
                  <div className="space-y-1">
                    {dateEvents.map((event) => {
                      const globalIndex = events.findIndex(
                        e => e.title === event.title && e.date === event.date && e.start === event.start,
                      );
                      return (
                        <label
                          key={`${event.date}-${event.start}-${event.title}`}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors duration-100"
                          style={{
                            background: event.selected
                              ? 'color-mix(in srgb, var(--ink-accent) 8%, transparent)'
                              : 'transparent',
                            border: `1px solid ${event.selected
                              ? 'color-mix(in srgb, var(--ink-accent) 25%, transparent)'
                              : 'color-mix(in srgb, var(--ink-border) 40%, transparent)'}`,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={event.selected}
                            onChange={() => toggleEvent(globalIndex)}
                            className="w-3.5 h-3.5 rounded accent-current shrink-0"
                            style={{ accentColor: 'var(--ink-accent)' }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate" style={{ color: 'var(--ink-text)' }}>
                              {event.title}
                            </p>
                          </div>
                          <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--ink-text-muted)' }}>
                            {event.start} – {event.end}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--ink-border)' }}>
          {step === 'upload' && (
            <>
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={extractEvents}
                disabled={!selectedFileRef.current}
                className="text-xs px-4 py-1.5 rounded-md text-white transition-colors hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--ink-accent)' }}
              >
                Extract Events
              </button>
            </>
          )}

          {step === 'loading' && (
            <button
              onClick={() => { setStep('upload'); }}
              className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80 ml-auto"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              Cancel
            </button>
          )}

          {step === 'review' && (
            <>
              <button
                onClick={() => { setStep('upload'); setEvents([]); setPreview(null); selectedFileRef.current = null; setError(''); }}
                className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                Try Another
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="text-xs px-3 py-1.5 rounded-md transition-colors hover:opacity-80"
                  style={{ color: 'var(--ink-text-muted)', border: '1px solid var(--ink-border)' }}
                >
                  Discard
                </button>
                <button
                  onClick={importEvents}
                  disabled={importing || selectedCount === 0}
                  className="text-xs px-4 py-1.5 rounded-md text-white transition-colors hover:opacity-90 disabled:opacity-40"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  {importing ? 'Importing...' : `Import ${selectedCount} Event${selectedCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
