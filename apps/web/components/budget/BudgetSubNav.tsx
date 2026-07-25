'use client';

import { usePathname, useRouter } from 'next/navigation';

const TABS: { href: string; label: string; match: (path: string) => boolean }[] = [
  {
    href: '/budget',
    label: 'Spaces',
    match: (path) =>
      path === '/budget' ||
      (path.startsWith('/budget/') &&
        !path.startsWith('/budget/monthly') &&
        !path.startsWith('/budget/deductions') &&
        !path.startsWith('/budget/reports')),
  },
  { href: '/budget/monthly', label: 'Monthly', match: (path) => path.startsWith('/budget/monthly') },
  { href: '/budget/deductions', label: 'Deductions', match: (path) => path.startsWith('/budget/deductions') },
  { href: '/budget/reports', label: 'Reports', match: (path) => path.startsWith('/budget/reports') },
];

// One consistent way to move between the four budget screens, replacing the
// mix of "← Back", "← Budget", "← Monthly" and one-off links that used to
// differ per page (and left some screens, like Deductions, with no forward
// link into the others at all).
export default function BudgetSubNav() {
  const router = useRouter();
  const pathname = usePathname() ?? '';

  return (
    <nav
      className="mb-4 flex gap-1 overflow-x-auto rounded-lg p-1"
      style={{ background: 'var(--ink-subtle, var(--ink-border-subtle))' }}
      aria-label="Budget sections"
    >
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        return (
          <button
            key={tab.href}
            type="button"
            className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: active ? 'var(--ink-surface)' : 'transparent',
              color: active ? 'var(--ink-text)' : 'var(--ink-text-muted)',
              boxShadow: active ? 'var(--ink-shadow-sm)' : 'none',
            }}
            onClick={() => router.push(tab.href)}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
