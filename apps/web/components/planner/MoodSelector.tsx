'use client';

interface Props {
  value: string;
  onChange: (mood: string) => void;
}

const MOODS = [
  { key: 'great',    label: 'Great',   paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', 'M7 13a5 5 0 0 0 10 0H7z', 'M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z', 'M17 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'] },
  { key: 'good',     label: 'Good',    paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z', 'M17 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'] },
  { key: 'neutral',  label: 'Okay',    paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', 'M8 14h8', 'M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z', 'M17 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'] },
  { key: 'tired',    label: 'Tired',   paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', 'M8 15s1.5-2 4-2 4 2 4 2', 'M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z', 'M17 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z'] },
  { key: 'stressed', label: 'Stressed', paths: ['M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z', 'M8 16s1.5-3 4-3 4 3 4 3', 'M7 8l3 2', 'M17 8l-3 2'] },
];

export default function MoodSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      {MOODS.map((m) => {
        const active = value === m.key;
        return (
          <button
            key={m.key}
            type="button"
            onClick={() => onChange(active ? '' : m.key)}
            title={m.label}
            className="relative p-1 rounded-lg transition-all duration-150"
            style={{
              background: active ? 'var(--ink-accent-light)' : 'transparent',
              transform: active ? 'scale(1.15)' : 'scale(1)',
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                stroke: active ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                opacity: active ? 1 : 0.6,
                transition: 'stroke 150ms, opacity 150ms',
              }}
            >
              {m.paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
