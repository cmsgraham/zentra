'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api-client';
import type { AppointmentData } from './AppointmentCard';

interface Props {
  workspaceId?: string;
  date: string; // YYYY-MM-DD pre-fill
  appointment?: AppointmentData | null; // null = create mode
  onSaved: () => void;
  onCancel: () => void;
}

export default function AppointmentForm({ workspaceId, date, appointment, onSaved, onCancel }: Props) {
  const isEdit = !!appointment;

  const [title, setTitle] = useState(appointment?.title ?? '');
  const [description, setDescription] = useState(appointment?.description ?? '');
  const [startDate, setStartDate] = useState(
    appointment ? appointment.startsAt.slice(0, 10) : date,
  );
  const [startTime, setStartTime] = useState(
    appointment ? new Date(appointment.startsAt).toTimeString().slice(0, 5) : '09:00',
  );
  const [endTime, setEndTime] = useState(
    appointment?.endsAt ? new Date(appointment.endsAt).toTimeString().slice(0, 5) : '',
  );
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [color, setColor] = useState(appointment?.color ?? '');
  const [submitting, setSubmitting] = useState(false);

  const colors = ['', '#6c5ce7', '#00b894', '#fdcb6e', '#e17055', '#74b9ff', '#a29bfe', '#fab1a0'];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const startsAt = new Date(`${startDate}T${startTime}:00`).toISOString();
    const endsAt = endTime ? new Date(`${startDate}T${endTime}:00`).toISOString() : undefined;

    const body: Record<string, unknown> = {
      title,
      description: description || undefined,
      startsAt,
      endsAt: endsAt || null,
      location: location || null,
      notes: notes || null,
      color: color || null,
    };

    if (isEdit) {
      await api(`/appointments/${appointment!.id}`, { method: 'PATCH', body });
    } else {
      body.workspaceId = workspaceId || undefined;
      await api('/appointments', { method: 'POST', body });
    }

    setSubmitting(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.2)' }} onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl p-6 space-y-4 shadow-lg"
        style={{ background: 'var(--ink-surface)' }}
      >
        <h2 className="text-lg font-semibold">{isEdit ? 'Edit Appointment' : 'New Appointment'}</h2>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Appointment title"
          required
          autoFocus
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--ink-border)' }}
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--ink-border)' }}
          rows={2}
        />

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--ink-text-muted)' }}>Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--ink-border)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--ink-text-muted)' }}>Start</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--ink-border)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--ink-text-muted)' }}>End</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: '1px solid var(--ink-border)' }}
            />
          </div>
        </div>

        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--ink-border)' }}
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full px-3 py-2 rounded-lg text-sm"
          style={{ border: '1px solid var(--ink-border)' }}
          rows={2}
        />

        {/* Color picker */}
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'var(--ink-text-muted)' }}>Color</label>
          <div className="flex gap-2">
            {colors.map((c) => (
              <button
                key={c || 'none'}
                type="button"
                onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full border-2 transition-transform"
                style={{
                  background: c || 'var(--ink-surface)',
                  borderColor: color === c ? 'var(--ink-text)' : 'var(--ink-border)',
                  transform: color === c ? 'scale(1.2)' : 'scale(1)',
                }}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ border: '1px solid var(--ink-border)' }}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50" style={{ background: 'var(--ink-accent)' }}>
            {submitting ? 'Saving…' : isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
