'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  workspaceId: string;
}

const navItems = (id: string) => [
  { href: `/workspaces/${id}`, label: 'Board', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
    </svg>
  )},
  { href: `/workspaces/${id}/blocked`, label: 'Waiting on…', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
  )},
  { href: `/workspaces/${id}/archive`, label: 'Archive', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
    </svg>
  )},
  { href: `/workspaces/${id}/import/text`, label: 'Text Import', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )},
  { href: `/workspaces/${id}/import/image`, label: 'Image Import', icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
    </svg>
  )},
];

export default function WorkspaceSidebar({ workspaceId }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className="w-52 shrink-0 p-3 flex flex-col gap-0.5"
      style={{ background: 'var(--ink-bg)', borderRight: '1px solid var(--ink-border-subtle)' }}
    >
      <p className="z-section-title px-2.5 mb-2 mt-1">Space</p>
      {navItems(workspaceId).map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-all"
            style={{
              background: active ? 'var(--ink-accent-light)' : 'transparent',
              color: active ? 'var(--ink-accent)' : 'var(--ink-text-secondary)',
              fontWeight: active ? 550 : 400,
            }}
          >
            <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
