'use client';

export interface AppointmentData {
  id: string;
  workspaceId?: string | null;
  ownerUserId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  status: string;
  color?: string | null;
  linkedTaskId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  appointment: AppointmentData;
  onEdit?: (appt: AppointmentData) => void;
  onDelete?: (id: string) => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function AppointmentCard({ appointment, onEdit, onDelete }: Props) {
  const accent = appointment.color || 'var(--ink-accent)';

  return (
    <div
      className="flex items-start gap-2.5 py-1.5 group transition-colors duration-100"
      style={{ borderBottom: '1px solid color-mix(in srgb, var(--ink-border) 50%, transparent)' }}
    >
      {/* Time column */}
      <div className="shrink-0 w-14 text-right">
        <p className="text-[11px] font-medium tabular-nums" style={{ color: 'var(--ink-text-muted)' }}>
          {formatTime(appointment.startsAt)}
        </p>
        {appointment.endsAt && (
          <p className="text-[10px] tabular-nums" style={{ color: 'var(--ink-border)' }}>
            {formatTime(appointment.endsAt)}
          </p>
        )}
      </div>
      {/* Color bar */}
      <div className="w-0.5 self-stretch rounded-full shrink-0" style={{ background: accent }} />
      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{appointment.title}</p>
        {appointment.location && (
          <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--ink-text-muted)' }}>
            {appointment.location}
          </p>
        )}
      </div>
      {/* Actions */}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 shrink-0">
        {onEdit && (
          <button
            onClick={() => onEdit(appointment)}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/5 transition-colors duration-100"
            style={{ color: 'var(--ink-accent)' }}
          >
            Edit
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(appointment.id)}
            className="text-[10px] px-1.5 py-0.5 rounded hover:bg-black/5 transition-colors duration-100"
            style={{ color: 'var(--ink-blocked)' }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
