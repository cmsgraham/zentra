'use client';

interface SoftUrgencyBadgeProps {
  endOfDayTime: string; // "HH:MM" format
  userTimezone?: string;
}

function getHoursLeft(endOfDayTime: string, timezone?: string): number | null {
  try {
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const [h, m] = endOfDayTime.split(':').map(Number);
    const endToday = new Date(nowInTz);
    endToday.setHours(h, m, 0, 0);
    const diff = endToday.getTime() - nowInTz.getTime();
    return diff > 0 ? diff / 3600000 : 0;
  } catch {
    return null;
  }
}

export function SoftUrgencyBadge({ endOfDayTime, userTimezone }: SoftUrgencyBadgeProps) {
  const hoursLeft = getHoursLeft(endOfDayTime, userTimezone);

  if (hoursLeft === null || hoursLeft <= 0) return null;

  const text =
    hoursLeft < 1
      ? `${Math.round(hoursLeft * 60)} min left today`
      : hoursLeft < 2
      ? `${Math.floor(hoursLeft)} hr ${Math.round((hoursLeft % 1) * 60)} min left today`
      : `${Math.round(hoursLeft)} hours left today`;

  const isLow = hoursLeft < 2;

  return (
    <span
      style={{
        fontSize: '0.75rem',
        color: isLow ? 'var(--ink-pending)' : 'var(--ink-text-muted)',
        padding: '2px 8px',
        borderRadius: '999px',
        border: `1px solid ${isLow ? 'var(--ink-pending)' : 'var(--ink-border)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}
