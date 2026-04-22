'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import FloatingActionButton from '@/components/mobile/FloatingActionButton';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';

interface ListSummary {
  id: string;
  title: string;
  ownerName: string;
  isOwner: boolean;
  totalItems: number;
  updatedAt: string;
}

export default function ListsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const loadLists = useCallback(async () => {
    const data = await api<{ items: ListSummary[] }>('/shopping/lists?pageSize=50');
    setLists(data.items);
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    await api('/shopping/lists', {
      method: 'POST',
      body: { title: newTitle.trim() },
    });
    setNewTitle('');
    setShowCreate(false);
    setCreating(false);
    loadLists();
  }

  return (
    <AuthShell>
      <div className={`max-w-2xl mx-auto ${isMobile ? 'px-4 pb-24 pt-2' : 'p-6'}`}>
        {!isMobile && (
          <div className="flex items-center justify-between mb-6">
            <h1 className="z-page-title">Lists</h1>
            <button onClick={() => setShowCreate(true)} className="z-btn z-btn-primary">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <line x1="7" y1="2" x2="7" y2="12" />
                <line x1="2" y1="7" x2="12" y2="7" />
              </svg>
              New List
            </button>
          </div>
        )}

        {lists.length === 0 && (
          <div className="text-center py-16" style={{ color: 'var(--ink-text-faint)' }}>
            <p className="text-base mb-2">No lists yet</p>
            <p className="z-caption">Create one to get started</p>
          </div>
        )}

        <div className="space-y-3">
          {lists.map((list) => (
            <button
              key={list.id}
              onClick={() => router.push(`/lists/${list.id}`)}
              className="w-full text-left rounded-xl transition-all hover:scale-[1.005]"
              style={{
                background: 'var(--ink-surface)',
                border: '1px solid var(--ink-border-subtle)',
                padding: '16px',
                boxShadow: 'var(--ink-shadow-sm)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-base truncate">{list.title}</h3>
                  <p className="z-caption mt-1">
                    {list.isOwner ? 'You' : list.ownerName}
                    {' · '}
                    {list.totalItems} item{list.totalItems === 1 ? '' : 's'}
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--ink-text-faint)' }}>
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {showCreate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center z-animate-fade"
            style={{ background: 'var(--ink-overlay)' }}
            onClick={() => setShowCreate(false)}
          >
            <form onClick={(e) => e.stopPropagation()} onSubmit={handleCreate} className="w-full max-w-sm p-6 space-y-4 z-overlay z-animate-in">
              <h2 className="text-base font-semibold">New List</h2>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="List name"
                required
                autoFocus
                className="z-input"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreate(false)} className="z-btn">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="z-btn z-btn-primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {isMobile && (
        <FloatingActionButton
          actions={[{ label: 'New List', icon: '+', onClick: () => setShowCreate(true) }]}
        />
      )}
    </AuthShell>
  );
}
