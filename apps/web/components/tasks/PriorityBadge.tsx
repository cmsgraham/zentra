import { cn } from '@/lib/utils';

const priorityColors: Record<string, string> = {
  low: 'var(--ink-low)',
  medium: 'var(--ink-medium)',
  high: 'var(--ink-high)',
  critical: 'var(--ink-critical)',
};

const priorityLabels: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export default function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium')}
      style={{ background: priorityColors[priority] ?? '#eee', color: '#2d2a26' }}
    >
      {priorityLabels[priority] ?? priority}
    </span>
  );
}
