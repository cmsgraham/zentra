import { cn } from '@/lib/utils';

const statusColors: Record<string, string> = {
  pending: 'var(--ink-pending)',
  in_progress: 'var(--ink-in-progress)',
  blocked: 'var(--ink-blocked)',
  done: 'var(--ink-done)',
};

const statusLabels: Record<string, string> = {
  pending: 'Open',
  in_progress: 'Present',
  blocked: 'Waiting on…',
  done: 'I did it!',
};

export default function StatusChip({ status, small }: { status: string; small?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        small ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
      )}
      style={{ background: statusColors[status] ?? '#ddd', color: '#2d2a26' }}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}
