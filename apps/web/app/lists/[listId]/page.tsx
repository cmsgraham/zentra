'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthShell from '@/components/layout/AuthShell';
import { useAuth } from '@/lib/auth';
import { useIsMobile } from '@/lib/useIsMobile';
import { api } from '@/lib/api-client';
import ListImageImportModal from '@/components/ai/ListImageImportModal';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Accept bare hostnames like "amazon.com/..." by prefixing https:// before
// sending to the API (which only accepts http/https). Returning the original
// string if it already has a scheme keeps explicit http:// links intact.
function normalizeProductUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

interface ListItem {
  id: string;
  displayName: string;
  quantity: number | null;
  createdByName: string;
  createdByUserId: string;
  checked?: boolean;
  checkedAt?: string | null;
  price?: number | null;
  vendor?: string | null;
  category?: string | null;
  notes?: string | null;
  url?: string | null;
  customValue?: string | null;
  isSection?: boolean;
  // The section (store) header this item belongs to, or null when ungrouped.
  // Persisted server-side so the grouping survives check/uncheck and reorder.
  sectionId?: string | null;
}

type ListField = 'quantity' | 'price' | 'vendor' | 'category' | 'notes' | 'url' | 'custom';

interface ListDetail {
  id: string;
  title: string;
  isOwner: boolean;
  ownerName: string;
  members: { userId: string; name: string; email: string; role: string }[];
  enabledFields: ListField[];
  customFieldLabel: string | null;
}

interface Friend {
  id: string;
  name: string;
  email: string;
}

// Order a set of unchecked items so each one sits under its section (store)
// header, using the persisted `sectionId` rather than raw position. Items with
// no section come first; items whose section header is missing fall back to the
// ungrouped top. Relative order within a group is preserved from the input
// (which arrives in sort_order).
function buildSectionLayout(unchecked: ListItem[]): ListItem[] {
  const sections = unchecked.filter((it) => it.isSection);
  const sectionIds = new Set(sections.map((s) => s.id));
  const bySection = new Map<string, ListItem[]>();
  const ungrouped: ListItem[] = [];

  for (const it of unchecked) {
    if (it.isSection) continue;
    if (it.sectionId && sectionIds.has(it.sectionId)) {
      const bucket = bySection.get(it.sectionId) ?? [];
      bucket.push(it);
      bySection.set(it.sectionId, bucket);
    } else {
      ungrouped.push(it);
    }
  }

  const result: ListItem[] = [...ungrouped];
  for (const sec of sections) {
    result.push(sec);
    result.push(...(bySection.get(sec.id) ?? []));
  }
  return result;
}

// Mirror the server's section assignment after a drag so the optimistic state
// stays consistent without a refetch: walk the new order, tracking the current
// section header, and stamp unchecked items; checked items keep their section.
function recomputeSectionIds(ordered: ListItem[]): ListItem[] {
  let current: string | null = null;
  return ordered.map((it) => {
    if (it.isSection) {
      current = it.id;
      return it;
    }
    if (it.checked) return it;
    return { ...it, sectionId: current };
  });
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
  const [newPrice, setNewPrice] = useState('');
  const [newVendor, setNewVendor] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newCustom, setNewCustom] = useState('');
  const [adding, setAdding] = useState(false);

  const [tab, setTab] = useState<'items' | 'share'>('items');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [shareUserId, setShareUserId] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showImageImport, setShowImageImport] = useState(false);
  const [search, setSearch] = useState('');
  const [editingItem, setEditingItem] = useState<ListItem | null>(null);
  // True when the Zentra Opener browser extension is installed. The
  // extension's content script tags <html data-zentra-opener="1"> and also
  // posts a 'ready' message after SPA navigations.
  const [hasOpener, setHasOpener] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.documentElement.getAttribute('data-zentra-opener') === '1') {
      setHasOpener(true);
    }
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data as { source?: string; type?: string } | undefined;
      if (d && d.source === 'zentra-opener' && d.type === 'ready') setHasOpener(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  function openUrlsInBackground(urls: string[]) {
    if (!hasOpener || urls.length === 0) return;
    window.postMessage({ source: 'zentra', type: 'open-bg', urls, reqId: Date.now() }, window.location.origin);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const loadList = useCallback(async () => {
    // api() returns null offline when nothing is cached; guard against
    // dereferencing null which would throw and leave the page stuck on "Loading…".
    const data = await api<ListDetail | null>(`/shopping/lists/${listId}`);
    if (!data) return;
    setList(data);
    setTitleDraft(data.title);
  }, [listId]);

  const loadItems = useCallback(async () => {
    const data = await api<{ items: ListItem[] } | null>(`/shopping/lists/${listId}/items`);
    if (!data) return;
    setItems(data.items);
  }, [listId]);

  useEffect(() => {
    loadList();
    loadItems();
  }, [loadList, loadItems]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const fields = list?.enabledFields ?? ['quantity'];
    setAdding(true);
    const created = await api<ListItem | null>(`/shopping/lists/${listId}/items`, {
      method: 'POST',
      body: {
        displayName: newName.trim(),
        ...(fields.includes('quantity') && newQty.trim() ? { quantity: parseFloat(newQty) } : {}),
        ...(fields.includes('price') && newPrice.trim() ? { price: parseFloat(newPrice) } : {}),
        ...(fields.includes('vendor') && newVendor.trim() ? { vendor: newVendor.trim() } : {}),
        ...(fields.includes('category') && newCategory.trim() ? { category: newCategory.trim() } : {}),
        ...(fields.includes('notes') && newNotes.trim() ? { notes: newNotes.trim() } : {}),
        ...(fields.includes('url') && newUrl.trim() ? { url: normalizeProductUrl(newUrl.trim()) } : {}),
        ...(fields.includes('custom') && newCustom.trim() ? { customValue: newCustom.trim() } : {}),
      },
    });
    if (created) {
      // New rows are inserted at the top server-side; mirror that locally so
      // the user sees the addition immediately. Don't reload from GET — the
      // SW's stale-while-revalidate may still serve a pre-mutation snapshot
      // for a beat (the cache-invalidation postMessage is async vs. fetch on
      // mobile), which would otherwise overwrite the optimistic insert.
      setItems((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
    } else {
      loadItems();
    }
    setNewName('');
    setNewQty('');
    setNewPrice('');
    setNewVendor('');
    setNewCategory('');
    setNewNotes('');
    setNewUrl('');
    setNewCustom('');
    setAdding(false);
  }

  async function addSection() {
    const title = prompt('Section title');
    if (!title || !title.trim()) return;
    const created = await api<ListItem | null>(`/shopping/lists/${listId}/items`, {
      method: 'POST',
      body: { displayName: title.trim(), isSection: true },
    });
    if (created) {
      // Prepend optimistically — see addItem for why we don't reload here.
      setItems((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
    } else {
      loadItems();
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const unchecked = buildSectionLayout(items.filter((it) => !it.checked));
    const checked = items.filter((it) => it.checked);
    const oldIndex = unchecked.findIndex((it) => it.id === active.id);
    const newIndex = unchecked.findIndex((it) => it.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(unchecked, oldIndex, newIndex);
    const next = recomputeSectionIds([...reordered, ...checked]);
    setItems(next);
    try {
      await api(`/shopping/lists/${listId}/reorder`, {
        method: 'POST',
        body: { itemIds: next.map((it) => it.id) },
      });
    } catch {
      loadItems();
    }
  }

  async function deleteItem(itemId: string) {
    await api(`/shopping/items/${itemId}`, { method: 'DELETE' });
    loadItems();
  }

  async function saveEditedItem(patch: Partial<ListItem> & { url?: string | null }) {    if (!editingItem) return;
    const id = editingItem.id;
    // Optimistic local merge — keeps the row visible while the request flies.
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setEditingItem(null);
    try {
      await api(`/shopping/items/${id}`, { method: 'PATCH', body: patch });
    } catch {
      loadItems();
    }
  }

  async function toggleItem(itemId: string) {
    // Optimistic update — flip immediately, revert on failure.
    const prev = items;
    setItems((current) =>
      current.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it)),
    );
    try {
      const res = await api<{ id: string; checked: boolean; checkedAt: string | null }>(
        `/shopping/items/${itemId}/toggle`,
        { method: 'POST' },
      );
      setItems((current) =>
        current.map((it) =>
          it.id === itemId ? { ...it, checked: res.checked, checkedAt: res.checkedAt } : it,
        ),
      );
    } catch {
      setItems(prev);
    }
  }

  async function loadFriends() {
    const data = await api<{ items: Friend[] } | null>('/friends');
    if (!data) return;
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
            <div className="flex justify-end mb-2 gap-2">
              <button
                type="button"
                onClick={addSection}
                className="text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)', color: 'var(--ink-text-muted)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
                Add section
              </button>
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
            <div className="mb-3 relative">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-full pl-9 pr-8 py-2 rounded-lg text-sm"
                style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
              />
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2"
                width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: 'var(--ink-text-muted)' }}
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  ×
                </button>
              )}
            </div>
            <form onSubmit={addItem} className="mb-4">
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Item"
                  required
                  className="flex-1 px-3 py-2 rounded-lg text-sm"
                  style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }}
                />
                {(list?.enabledFields ?? ['quantity']).includes('quantity') && (
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
                )}
                <button
                  type="submit"
                  disabled={adding}
                  className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
                  style={{ background: 'var(--ink-accent)' }}
                >
                  Add
                </button>
              </div>

              {(() => {
                const fields = list?.enabledFields ?? ['quantity'];
                const extras = (['price', 'vendor', 'category', 'notes', 'url', 'custom'] as const).filter((f) => fields.includes(f));
                if (extras.length === 0) return null;
                return (
                  <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: `repeat(${Math.min(extras.length, 3)}, minmax(0, 1fr))` }}>
                    {extras.map((f) => {
                      if (f === 'price') return (
                        <input key={f} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Price" type="number" min="0" step="any"
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                      if (f === 'vendor') return (
                        <input key={f} value={newVendor} onChange={(e) => setNewVendor(e.target.value)} placeholder="Vendor"
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                      if (f === 'category') return (
                        <input key={f} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category"
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                      if (f === 'notes') return (
                        <input key={f} value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="Notes"
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                      if (f === 'url') return (
                        <input key={f} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Product URL" type="url" inputMode="url"
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                      return (
                        <input key={f} value={newCustom} onChange={(e) => setNewCustom(e.target.value)} placeholder={list?.customFieldLabel || 'Custom'}
                          className="px-3 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)', background: 'var(--ink-surface)' }} />
                      );
                    })}
                  </div>
                );
              })()}
            </form>

            {items.length === 0 ? (
              <p className="text-center py-12 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                No items yet. Add one above.
              </p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={buildSectionLayout(items.filter((it) => !it.checked)).map((it) => it.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {(() => {
                      const q = search.trim().toLowerCase();
                      const matches = (it: ListItem) => {
                        if (!q) return true;
                        if (it.isSection) return false;
                        const hay = [it.displayName, it.vendor, it.category, it.notes, it.customValue]
                          .filter(Boolean)
                          .join(' ')
                          .toLowerCase();
                        return hay.includes(q);
                      };
                      const visible = q ? items.filter(matches) : items;
                      const unchecked = q
                        ? visible.filter((it) => !it.checked)
                        : buildSectionLayout(visible.filter((it) => !it.checked));
                      const checked = visible.filter((it) => it.checked);
                      // Build the list of URLs that belong under each
                      // unchecked section header. Items above the first
                      // section are bundled into that first section's
                      // group so a one-section list still gets one tap.
                      const sectionUrls = new Map<string, string[]>();
                      const urlEnabled = (list?.enabledFields ?? []).includes('url');
                      if (urlEnabled && hasOpener) {
                        let firstSeenSection = false;
                        const pendingPreSection: string[] = [];
                        let currentSection: string | null = null;
                        let currentList: string[] = [];
                        const flush = () => {
                          if (currentSection) sectionUrls.set(currentSection, currentList);
                        };
                        for (const it of unchecked) {
                          if (it.isSection) {
                            flush();
                            currentSection = it.id;
                            currentList = !firstSeenSection ? [...pendingPreSection] : [];
                            firstSeenSection = true;
                          } else if (it.url) {
                            if (!firstSeenSection) pendingPreSection.push(it.url);
                            else currentList.push(it.url);
                          }
                        }
                        flush();
                      }
                      return (
                        <>
                          {q && unchecked.length === 0 && checked.length === 0 && (
                            <p className="text-center py-8 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                              No items match “{search}”.
                            </p>
                          )}
                          {unchecked.map((item, idx) => (
                            <SortableItemRow
                              key={item.id}
                              item={item}
                              rowNumber={idx + 1}
                              isMobile={isMobile}
                              list={list}
                              onToggle={toggleItem}
                              onDelete={deleteItem}
                              onEdit={setEditingItem}
                              onOpenUrls={openUrlsInBackground}
                              sectionUrls={sectionUrls.get(item.id)}
                            />
                          ))}
                          {checked.map((item) => (
                            <ItemRow
                              key={item.id}
                              item={item}
                              rowNumber={null}
                              isMobile={isMobile}
                              list={list}
                              onToggle={toggleItem}
                              onDelete={deleteItem}
                              onEdit={setEditingItem}
                            />
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </SortableContext>
              </DndContext>
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
      {editingItem && (
        <EditItemModal
          item={editingItem}
          list={list}
          onClose={() => setEditingItem(null)}
          onSave={saveEditedItem}
        />
      )}
    </AuthShell>
  );
}

interface RowProps {
  item: ListItem;
  rowNumber: number | null;
  isMobile: boolean;
  list: ListDetail;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (item: ListItem) => void;
  onOpenUrls?: (urls: string[]) => void;
  sectionUrls?: string[];
  dragHandleProps?: {
    attributes?: React.HTMLAttributes<HTMLElement>;
    listeners?: React.DOMAttributes<HTMLElement>;
    setActivatorNodeRef?: (node: HTMLElement | null) => void;
  };
}

function ItemRowContent({ item, rowNumber, isMobile, list, onToggle, onDelete, onEdit, onOpenUrls, sectionUrls, dragHandleProps }: RowProps) {
  const fields = list?.enabledFields ?? ['quantity'];
  const isSection = !!item.isSection;
  const parts: string[] = [];
  if (!isSection) {
    if (fields.includes('price') && item.price != null) parts.push(`$${item.price.toFixed(2)}`);
    if (fields.includes('vendor') && item.vendor) parts.push(item.vendor);
    if (fields.includes('category') && item.category) parts.push(item.category);
    if (fields.includes('custom') && item.customValue) {
      parts.push(list?.customFieldLabel ? `${list.customFieldLabel}: ${item.customValue}` : item.customValue);
    }
  }
  const meta = parts.join(' · ');

  return (
    <>
      {rowNumber !== null ? (
        <button
          ref={dragHandleProps?.setActivatorNodeRef}
          type="button"
          aria-label={`Drag to reorder, position ${rowNumber}`}
          {...(dragHandleProps?.attributes ?? {})}
          {...(dragHandleProps?.listeners ?? {})}
          className="flex items-center justify-center text-xs font-semibold rounded-md select-none"
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            background: isSection ? 'transparent' : 'var(--ink-subtle, var(--ink-border))',
            color: 'var(--ink-text-muted)',
            cursor: 'grab',
            touchAction: 'none',
          }}
          title="Drag to reorder"
        >
          {isSection ? '⋮⋮' : rowNumber}
        </button>
      ) : (
        <span
          className="flex items-center justify-center text-xs rounded-md"
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            color: 'var(--ink-text-muted)',
            opacity: 0.4,
          }}
        >
          ✓
        </span>
      )}
      {!isSection && (
        <input
          type="checkbox"
          checked={!!item.checked}
          onChange={() => onToggle(item.id)}
          aria-label={item.checked ? `Uncheck ${item.displayName}` : `Mark ${item.displayName} as done`}
          style={{
            width: isMobile ? 22 : 18,
            height: isMobile ? 22 : 18,
            accentColor: 'var(--ink-accent)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={isSection ? 'text-xs font-semibold uppercase tracking-wider' : 'text-sm font-medium'}
            style={{
              textDecoration: item.checked ? 'line-through' : 'none',
              color: isSection
                ? 'var(--ink-text-muted)'
                : item.checked ? 'var(--ink-text-muted)' : 'var(--ink-text)',
              transition: 'color 120ms, text-decoration-color 120ms',
            }}
          >
            {item.displayName}
          </span>
          {!isSection && fields.includes('quantity') && item.quantity !== null && (
            <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
              ×{item.quantity}
            </span>
          )}
          {isSection && sectionUrls && sectionUrls.length > 0 && onOpenUrls && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenUrls(sectionUrls);
              }}
              aria-label={`Open ${sectionUrls.length} link${sectionUrls.length > 1 ? 's' : ''} in background tabs`}
              title={`Open ${sectionUrls.length} link${sectionUrls.length > 1 ? 's' : ''} in background tabs`}
              className="inline-flex items-center justify-center rounded-md"
              style={{ width: 22, height: 22, color: 'var(--ink-accent)', flexShrink: 0 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </button>
          )}
          {!isSection && fields.includes('url') && item.url && (
            // rel includes noopener+noreferrer to prevent reverse-tabnabbing
            // attacks where the opened product page could try to manipulate
            // the originating Zentra tab via window.opener.
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={(e) => {
                e.stopPropagation();
                // In standalone PWA mode a plain target="_blank" can navigate
                // inside the app window, so force a real separate browser
                // window via window.open. In a normal browser tab we must let
                // the native anchor handle the click — a script-initiated
                // window.open (with noopener) is silently blocked by popup
                // blockers in many browsers/mobile webviews, which left the
                // link doing nothing.
                const isStandalone =
                  typeof window !== 'undefined' &&
                  (window.matchMedia?.('(display-mode: standalone)').matches ||
                    (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
                if (isStandalone) {
                  e.preventDefault();
                  window.open(item.url!, '_blank', 'noopener,noreferrer');
                }
              }}
              aria-label={`Open product page for ${item.displayName}`}
              title="Open product link"
              className="inline-flex items-center justify-center rounded-md"
              style={{
                width: 24,
                height: 24,
                color: 'var(--ink-accent)',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </a>
          )}
        </div>
        {!isSection && (
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--ink-text-muted)' }}>
            {meta}
            {meta ? ' · ' : ''}
            by {item.createdByName}
          </p>
        )}
        {!isSection && fields.includes('notes') && item.notes && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--ink-text-muted)' }}>
            {item.notes}
          </p>
        )}
      </div>
      <button
        onClick={() => onEdit(item)}
        aria-label={`Edit ${item.displayName}`}
        title="Edit"
        className={`text-xs px-2 py-1 rounded transition-opacity ${isMobile ? 'opacity-70' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          color: 'var(--ink-text-muted)',
          minWidth: isMobile ? '40px' : 'auto',
          minHeight: isMobile ? '40px' : 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
      <button
        onClick={() => onDelete(item.id)}
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
    </>
  );
}

function ItemRow(props: RowProps) {
  const isSection = !!props.item.isSection;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-xl group"
      style={{
        background: isSection ? 'transparent' : 'var(--ink-surface)',
        border: isSection ? 'none' : '1px solid var(--ink-border)',
        borderBottom: isSection ? '1px solid var(--ink-border)' : '1px solid var(--ink-border)',
        borderRadius: isSection ? '0' : undefined,
        minHeight: props.isMobile ? '56px' : 'auto',
        marginTop: isSection ? '12px' : undefined,
      }}
    >
      <ItemRowContent {...props} />
    </div>
  );
}

function SortableItemRow(props: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.item.id });

  const isSection = !!props.item.isSection;
  const style: React.CSSProperties = {
    background: isSection ? 'transparent' : 'var(--ink-surface)',
    border: isSection ? 'none' : '1px solid var(--ink-border)',
    borderBottom: '1px solid var(--ink-border)',
    borderRadius: isSection ? 0 : undefined,
    minHeight: props.isMobile ? '56px' : 'auto',
    marginTop: isSection ? 12 : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-3 p-3 rounded-xl group"
      style={style}
    >
      <ItemRowContent
        {...props}
        dragHandleProps={{
          attributes,
          listeners,
          setActivatorNodeRef,
        }}
      />
    </div>
  );
}

interface EditItemModalProps {
  item: ListItem;
  list: ListDetail;
  onClose: () => void;
  onSave: (patch: Partial<ListItem> & { url?: string | null }) => void;
}

function EditItemModal({ item, list, onClose, onSave }: EditItemModalProps) {
  const fields = list.enabledFields ?? ['quantity'];
  const isSection = !!item.isSection;
  const [name, setName] = useState(item.displayName);
  const [qty, setQty] = useState(item.quantity != null ? String(item.quantity) : '');
  const [price, setPrice] = useState(item.price != null ? String(item.price) : '');
  const [vendor, setVendor] = useState(item.vendor ?? '');
  const [category, setCategory] = useState(item.category ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');
  const [url, setUrl] = useState(item.url ?? '');
  const [customValue, setCustomValue] = useState(item.customValue ?? '');
  const [saving, setSaving] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    // Only send fields that are enabled on the list (or always-on like name).
    // null values clear an existing value server-side.
    const patch: Partial<ListItem> & { url?: string | null } = {
      displayName: name.trim(),
    };
    if (!isSection) {
      if (fields.includes('quantity')) patch.quantity = qty.trim() ? parseFloat(qty) : null;
      if (fields.includes('price')) patch.price = price.trim() ? parseFloat(price) : null;
      if (fields.includes('vendor')) patch.vendor = vendor.trim() || null;
      if (fields.includes('category')) patch.category = category.trim() || null;
      if (fields.includes('notes')) patch.notes = notes.trim() || null;
      if (fields.includes('url')) patch.url = url.trim() ? normalizeProductUrl(url.trim()) : null;
      if (fields.includes('custom')) patch.customValue = customValue.trim() || null;
    }
    onSave(patch);
    setSaving(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center z-animate-fade px-4"
      style={{ background: 'var(--ink-overlay)' }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md p-6 space-y-3 z-overlay z-animate-in"
      >
        <h2 className="text-base font-semibold">{isSection ? 'Edit section' : 'Edit item'}</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isSection ? 'Section title' : 'Item'}
          required
          autoFocus
          className="z-input"
        />
        {!isSection && (
          <>
            {fields.includes('quantity') && (
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Quantity"
                type="number"
                min="0"
                step="any"
                className="z-input"
              />
            )}
            {fields.includes('price') && (
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Price"
                type="number"
                min="0"
                step="any"
                className="z-input"
              />
            )}
            {fields.includes('vendor') && (
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="Vendor"
                className="z-input"
              />
            )}
            {fields.includes('category') && (
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category"
                className="z-input"
              />
            )}
            {fields.includes('url') && (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Product URL"
                type="url"
                inputMode="url"
                className="z-input"
              />
            )}
            {fields.includes('custom') && (
              <input
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={list.customFieldLabel || 'Custom'}
                className="z-input"
              />
            )}
            {fields.includes('notes') && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                rows={3}
                className="z-input"
                style={{ resize: 'vertical' }}
              />
            )}
          </>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="z-btn">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="z-btn z-btn-primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

