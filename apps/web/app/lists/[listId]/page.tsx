'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import { useAuth } from '@/lib/auth';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import ListImageImportModal from '@/components/ai/ListImageImportModal';

interface ListItem {
  id: string;
  displayName: string;
  quantity: number | null;
  createdByName: string;
  createdByUserId: string;
}

interface ListDetail {
  id: string;
  title: string;
  isOwner: boolean;
  ownerName: string;
  members: { userId: string; name: string; email: string; role: string }[];
}

interface Friend {
  id: string;
  name: string;
  email: string;
}

export default function ListDetailPage() {
  const router = useRouter();
  const { listId } = useParams() as { listId: string };
  const { user } = useAuth();
  const isMobile = useIsMobile();

  const [list, setList] = useState<ListDetail | null>(null);
  const [items, setItems] = useState<ListItem[]>([]);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [adding, setAdding] = useState(false);

  const [tab, setTab] = useState<'items' | 'share'>('items');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [shareUserId, setShareUserId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showImageImport, setShowImageImport] = useState(false);

  const loadList = useCallback(async () => {
    const data = await api<ListDetail>(`/shopping/lists/${listId}`);
    setList(data);
    setTitleDraft(data.title);
  }, [listId]);

  const loadItems = useCallback(async () => {
    const data = await api<{ items: ListItem[] }>(`/shopping/lists/${listId}/items`);
    setItems(data.items);
  }, [listId]);

  useEffect(() => {
    loadList();
    loadItems();
  }, [loadList, loadItems]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    await api(`/shopping/lists/${listId}/items`, {
      method: 'POST',
      body: {
        displayName: newName.trim(),
        ...(newQty.trim() ? { quantity: parseFloat(newQty) } : {}),
      },
    });
    setNewName('');
    setNewQty('');
    setAdding(false);
    loadItems();
  }

  async function deleteItem(itemId: string) {
    await api(`/shopping/items/${itemId}`, { method: 'DELETE' });
    loadItems();
  }

  async function loadFriends() {
    const data = await api<{ items: Friend[] }>('/friends');
    setFriends(data.items);
  }

  async function shareWithUser() {
    if (!shareUserId) return;
    await api(`/shopping/lists/${listId}/share`, {
      method: 'POST',
      body: { userId: shareUserId, role: 'editor' },
    });
    setShareUserId('');
    loadList();
  }

  async function removeMember(memberId: string) {
    await api(`/shopping/lists/${listId}/members/${memberId}`, { method: 'DELETE' });
    loadList();
  }

  async function saveTitle() {
    if (!titleDraft.trim() || titleDraft === list?.title) {
      setEditingTitle(false);
      return;
    }
    await api(`/shopping/lists/${listId}`, { method: 'PATCH', body: { title: titleDraft.trim() } });
    setEditingTitle(false);
    loadList();
  }

  async function deleteList() {
    if (!confirm('Delete this list and all its items?')) return;
    await api(`/shopping/lists/${listId}`, { method: 'DELETE' });
    router.push('/lists');
  }

  useEffect(() => {
    if (tab === 'share') loadFriends();
  }, [tab]);

  if (!list) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center py-20" style={{ color: 'var(--ink-text-muted)' }}>
          Loading…
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className={`max-w-2xl mx-auto px-4 pt-4 ${isMobile ? 'pb-24' : 'pb-6'}`}>
        <div className="flex items-start gap-2 mb-5">
          <button
            onClick={() => router.push('/lists')}
            className="mt-1 p-1 -ml-1 rounded-md transition-colors"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15l-5-5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => e.key === 'Enter' && saveTitle()}
                autoFocus
                className="text-lg font-semibold w-full bg-transparent outline-none"
              />
            ) : (
              <h1 className="text-lg font-semibold cursor-pointer truncate" onClick={() => setEditingTitle(true)}>
                {list.title}
              </h1>
            )}
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
              {list.isOwner ? 'Owner: You' : `Owner: ${list.ownerName}`}
              {list.members.length > 0 && ` · ${list.members.length} member${list.members.length > 1 ? 's' : ''}`}
            </p>
          </div>
          {list.isOwner && (
            <button onClick={deleteList} className="text-xs mt-1 px-2 py-0.5 rounded transition-colors" style={{ color: 'var(--ink-blocked)' }}>
              Delete
            </button>
          )}
        </div>

        <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'var(--ink-subtle, var(--ink-border))' }}>
          {(['items', 'share'] as const).map((section) => (
            <button
              key={section}
              onClick={() => setTab(section)}
              className="flex-1 text-sm py-1.5 rounded-md capitalize transition-colors"
              style={{
                background: tab === section ? 'var(--ink-surface)' : 'transparent',
                color: tab === section ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                fontWeight: tab === section ? 600 : 400,
              }}
            >
              {section === 'items' ? `Items (${items.length})` : 'Share'}
            </button>
          ))}
        </div>

        {tab === 'items' && (
          <>
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setShowImageImport(true)}
                className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)', color: 'var(--ink-text-muted)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Import from photo
              </button>
            </div>
            <form onSubmit={addItem} className="flex gap-2 mb-4">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Item"
                required
                className="flex-1 px-3 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
              />
              <input
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                placeholder="Qty"
                type="number"
                min="0"
                step="any"
                className="w-20 px-2 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
              />
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
                style={{ background: 'var(--ink-accent)' }}
              >
                Add
              </button>
            </form>

            {items.length === 0 ? (
              <p className="text-center py-12 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                No items yet. Add one above.
              </p>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-xl group"
                    style={{
                      background: 'var(--ink-surface)',
                      border: '1px solid var(--ink-border)',
                      minHeight: isMobile ? '56px' : 'auto',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.displayName}</span>
                        {item.quantity !== null && (
                          <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                            ×{item.quantity}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
                        by {item.createdByName}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteItem(item.id)}
                      className={`text-xs px-2 py-1 rounded transition-opacity ${isMobile ? 'opacity-60' : 'opacity-0 group-hover:opacity-100'}`}
                      style={{
                        color: 'var(--ink-blocked)',
                        minWidth: isMobile ? '44px' : 'auto',
                        minHeight: isMobile ? '44px' : 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'share' && (
          <div className="space-y-4">
            {list.isOwner && (
              <div className="flex gap-2">
                <select
                  value={shareUserId}
                  onChange={(e) => setShareUserId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg text-sm"
                  style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
                >
                  <option value="">Select a friend to share with</option>
                  {friends
                    .filter((friend) => !list.members.some((member) => member.userId === friend.id))
                    .map((friend) => (
                      <option key={friend.id} value={friend.id}>
                        {friend.name} ({friend.email})
                      </option>
                    ))}
                </select>
                <button
                  onClick={shareWithUser}
                  disabled={!shareUserId}
                  className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  Share
                </button>
              </div>
            )}

            <div className="space-y-2">
              <div
                className="p-3 rounded-xl"
                style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
              >
                <p className="text-sm font-medium">{list.ownerName} (owner)</p>
              </div>

              {list.members.map((member) => (
                <div
                  key={member.userId}
                  className="p-3 rounded-xl flex items-center justify-between"
                  style={{ background: 'var(--ink-surface)', border: '1px solid var(--ink-border)' }}
                >
                  <div>
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                      {member.email}
                    </p>
                  </div>
                  {(list.isOwner || member.userId === user?.id) && (
                    <button
                      onClick={() => removeMember(member.userId)}
                      className="text-xs px-2 py-1 rounded"
                      style={{ color: 'var(--ink-blocked)' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showImageImport && (
        <ListImageImportModal
          listId={listId}
          onClose={() => setShowImageImport(false)}
          onImported={loadItems}
        />
      )}
    </AuthShell>
  );
}
