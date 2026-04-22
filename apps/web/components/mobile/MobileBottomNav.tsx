'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const iconToday = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>
  </svg>
);
const iconTasks = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
  </svg>
);
const iconShopping = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>
  </svg>
);
const iconMore = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/>
  </svg>
);

interface Props {
  onMorePress: () => void;
}

export default function MobileBottomNav({ onMorePress }: Props) {
  const pathname = usePathname();

  const items = [
    { key: 'today', label: 'Flow', icon: iconToday, href: '/today', active: pathname === '/today' || pathname === '/reflect' },
    { key: 'tasks', label: 'Studio', icon: iconTasks, href: '/workspaces', active: pathname.startsWith('/workspaces') },
    { key: 'lists', label: 'Lists', icon: iconShopping, href: '/lists', active: pathname.startsWith('/lists') || pathname.startsWith('/shopping') },
    { key: 'more', label: 'More', icon: iconMore, href: null, active: false },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch safe-area-bottom"
      style={{ background: 'var(--ink-surface)', borderTop: '1px solid var(--ink-border-subtle)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.key}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
            style={{ color: item.active ? 'var(--ink-accent)' : 'var(--ink-text-faint)', minHeight: '52px' }}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ) : (
          <button
            key={item.key}
            onClick={onMorePress}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors"
            style={{ color: 'var(--ink-text-faint)', minHeight: '52px' }}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ),
      )}
    </nav>
  );
}
