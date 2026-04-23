import type { ReactNode } from 'react';
import Link from 'next/link';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--ink-bg)', color: 'var(--ink-text)' }}>
      <header
        className="border-b"
        style={{ borderColor: 'var(--ink-border-subtle)', background: 'var(--ink-surface)' }}
      >
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight" style={{ color: 'var(--ink-text)' }}>
            Zentra
          </Link>
          <nav className="flex items-center gap-5 text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
            <Link href="/legal/privacy" className="hover:underline">Privacy</Link>
            <Link href="/legal/terms" className="hover:underline">Terms</Link>
            <Link href="/login" className="hover:underline">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <article
          className="rounded-xl p-8 leading-relaxed"
          style={{
            background: 'var(--ink-surface)',
            border: '1px solid var(--ink-border-subtle)',
            boxShadow: 'var(--ink-shadow-md)',
          }}
        >
          {children}
        </article>

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          © {new Date().getFullYear()} Zentra. Questions? <a href="mailto:support@usezentra.app" className="underline">support@usezentra.app</a>
        </p>
      </main>
    </div>
  );
}
