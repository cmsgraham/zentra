'use client';

import { useRef, useState, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Calendar,
  Clock,
  Target,
  Timer,
  ClipboardList,
  Pencil,
  MessageCircle,
  Sunrise,
  ListChecks,
  X,
  Check,
} from 'lucide-react';
import {
  ALL_WIDGETS,
  LAYOUT_TEMPLATES,
  TEMPLATE_ORDER,
  zid,
  type ZoneLayout,
  type WidgetId,
  type LayoutType,
  type Column,
} from '@/lib/planner-layout';

const MIN_COL_WIDTH = 0.12;
const MAX_COLUMNS = 5;
const MIN_ZONE_HEIGHT = 0.12;
const MAX_ZONES = 5;

/* ── Lucide icon map for widget types ── */

const WIDGET_ICONS: Record<WidgetId, React.ComponentType<{ size?: number; className?: string }>> = {
  'calendar-mood': Calendar,
  schedule: Clock,
  goals: Target,
  pomodoro: Timer,
  'due-tasks': ClipboardList,
  notes: Pencil,
  reflection: MessageCircle,
  tomorrow: Sunrise,
  'today-plan': ListChecks,
};

/* ── Anchored popover portal ── */

interface PopoverPos {
  top: number;
  left: number;
}

function WidgetPickerPopover({
  anchorRef,
  zoneId,
  currentWidget,
  assignedWidgets,
  onAssign,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  zoneId: string;
  currentWidget: WidgetId | null;
  assignedWidgets: Set<WidgetId>;
  onAssign: (zoneId: string, widget: WidgetId | null) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  // Position the popover anchored to the trigger button
  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuW = 192;
    const menuH = 320;

    let top = rect.bottom + 8;
    let left = rect.right - menuW;

    // Clamp to viewport
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.innerHeight - 8) {
      top = rect.top - menuH - 8;
      if (top < 8) top = 8;
    }

    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [reposition]);

  // Click outside to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener('pointerdown', handleClick, true);
    return () => document.removeEventListener('pointerdown', handleClick, true);
  }, [onClose, anchorRef]);

  // ESC to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed rounded-xl overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        width: 192,
        zIndex: 99999,
        background: 'var(--ink-surface)',
        border: '1px solid var(--ink-border)',
        boxShadow:
          '0 4px 24px color-mix(in srgb, var(--ink-text) 12%, transparent), 0 1px 4px color-mix(in srgb, var(--ink-text) 6%, transparent)',
        animation: 'inkPopIn 120ms ease-out',
      }}
    >
      <style>{`
        @keyframes inkPopIn {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      <div className="max-h-[280px] overflow-y-auto py-1">
        {currentWidget && (
          <button
            onClick={() => onAssign(zoneId, null)}
            className="w-full flex items-center gap-2.5 px-3 py-[7px] text-[12px] transition-colors"
            style={{
              color: 'var(--ink-blocked)',
              borderBottom: '1px solid color-mix(in srgb, var(--ink-border) 50%, transparent)',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                'color-mix(in srgb, var(--ink-border) 25%, transparent)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'transparent')
            }
          >
            <X size={14} />
            <span>Clear zone</span>
          </button>
        )}
        {ALL_WIDGETS.map((wd) => {
          const placed = assignedWidgets.has(wd.id) && wd.id !== currentWidget;
          const active = wd.id === currentWidget;
          const Icon = WIDGET_ICONS[wd.id];
          return (
            <button
              key={wd.id}
              onClick={() => onAssign(zoneId, wd.id)}
              disabled={placed}
              className="w-full flex items-center gap-2.5 px-3 py-[7px] text-[12px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                color: active ? 'var(--ink-accent)' : 'var(--ink-text)',
              }}
              onMouseEnter={(e) => {
                if (!placed)
                  (e.currentTarget as HTMLElement).style.background =
                    'color-mix(in srgb, var(--ink-border) 25%, transparent)';
              }}
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              <Icon size={14} className="shrink-0" />
              <span className="flex-1 text-left truncate">{wd.label}</span>
              {active && <Check size={12} className="shrink-0" style={{ color: 'var(--ink-accent)' }} />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

/* ── Main editor ── */

interface LayoutEditorProps {
  layout: ZoneLayout;
  onChange: (layout: ZoneLayout) => void;
  onDone: () => void;
  onReset: () => void;
  renderWidget: (wid: WidgetId) => ReactNode;
}

export default function LayoutEditor({
  layout,
  onChange,
  onDone,
  onReset,
  renderWidget,
}: LayoutEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pickerZone, setPickerZone] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const getTriggerRef = useCallback(
    (zoneId: string) => ({
      current: triggerRefs.current.get(zoneId) ?? null,
    }),
    [],
  );

  const closePicker = useCallback(() => setPickerZone(null), []);

  /* ── Template ── */

  function applyTemplate(type: LayoutType) {
    onChange(LAYOUT_TEMPLATES[type].create());
    setPickerZone(null);
  }

  /* ── Column ops ── */

  function addColumn() {
    if (layout.columns.length >= MAX_COLUMNS) return;
    const newW = 1 / (layout.columns.length + 1);
    const scale = 1 - newW;
    const cols = layout.columns.map((c) => ({ ...c, width: c.width * scale }));
    cols.push({
      id: zid(),
      width: newW,
      zones: [{ id: zid(), height: 1, widget: null }],
    });
    onChange({ ...layout, columns: cols, type: 'custom' });
  }

  function removeColumn(colId: string) {
    if (layout.columns.length <= 1) return;
    const col = layout.columns.find((c) => c.id === colId);
    if (!col) return;
    const rest = layout.columns.filter((c) => c.id !== colId);
    const total = rest.reduce((s, c) => s + c.width, 0);
    const cols = rest.map((c) => ({ ...c, width: c.width / total }));
    onChange({ ...layout, columns: cols, type: 'custom' });
  }

  /* ── Zone ops ── */

  function splitZone(colId: string, zoneId: string) {
    const cols = layout.columns.map((c) => {
      if (c.id !== colId || c.zones.length >= MAX_ZONES) return c;
      const idx = c.zones.findIndex((z) => z.id === zoneId);
      if (idx === -1) return c;
      const zone = c.zones[idx];
      const half = zone.height / 2;
      const newZones = [...c.zones];
      newZones.splice(
        idx,
        1,
        { ...zone, height: half },
        { id: zid(), height: half, widget: null },
      );
      return { ...c, zones: newZones };
    });
    onChange({ ...layout, columns: cols, type: 'custom' });
  }

  function removeZone(colId: string, zoneId: string) {
    const cols = layout.columns.map((c) => {
      if (c.id !== colId || c.zones.length <= 1) return c;
      const idx = c.zones.findIndex((z) => z.id === zoneId);
      if (idx === -1) return c;
      const zone = c.zones[idx];
      const newZones = c.zones.filter((z) => z.id !== zoneId);
      const adj = idx > 0 ? idx - 1 : 0;
      newZones[adj] = {
        ...newZones[adj],
        height: newZones[adj].height + zone.height,
      };
      return { ...c, zones: newZones };
    });
    onChange({ ...layout, columns: cols, type: 'custom' });
    if (pickerZone === zoneId) setPickerZone(null);
  }

  /* ── Widget assignment ── */

  const assignedWidgets = new Set<WidgetId>(
    layout.columns.flatMap((c) =>
      c.zones.map((z) => z.widget).filter(Boolean),
    ) as WidgetId[],
  );

  function assignWidget(zoneId: string, widget: WidgetId | null) {
    const cols = layout.columns.map((c) => ({
      ...c,
      zones: c.zones.map((z) => {
        if (z.id === zoneId) return { ...z, widget };
        if (widget && z.widget === widget) return { ...z, widget: null };
        return z;
      }),
    }));
    onChange({ ...layout, columns: cols, type: 'custom' });
    setPickerZone(null);
  }

  /* ── Column separator drag ── */

  function handleColSepDown(e: React.PointerEvent, sepIdx: number) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const leftW = layout.columns[sepIdx].width;
    const rightW = layout.columns[sepIdx + 1].width;
    const total = leftW + rightW;

    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / rect.width;
      const newLeft = Math.max(
        MIN_COL_WIDTH,
        Math.min(leftW + dx, total - MIN_COL_WIDTH),
      );
      const cols = layout.columns.map((c, i) => {
        if (i === sepIdx) return { ...c, width: newLeft };
        if (i === sepIdx + 1) return { ...c, width: total - newLeft };
        return c;
      });
      onChange({ ...layout, columns: cols, type: 'custom' });
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* ── Zone separator drag ── */

  function handleZoneSepDown(
    e: React.PointerEvent,
    col: Column,
    sepIdx: number,
  ) {
    e.preventDefault();
    const target = (e.currentTarget as HTMLElement).parentElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const startY = e.clientY;
    const topH = col.zones[sepIdx].height;
    const bottomH = col.zones[sepIdx + 1].height;
    const total = topH + bottomH;

    function onMove(ev: PointerEvent) {
      const dy = (ev.clientY - startY) / rect.height;
      const newTop = Math.max(
        MIN_ZONE_HEIGHT,
        Math.min(topH + dy, total - MIN_ZONE_HEIGHT),
      );
      const cols = layout.columns.map((c) => {
        if (c.id !== col.id) return c;
        return {
          ...c,
          zones: c.zones.map((z, i) => {
            if (i === sepIdx) return { ...z, height: newTop };
            if (i === sepIdx + 1) return { ...z, height: total - newTop };
            return z;
          }),
        };
      });
      onChange({ ...layout, columns: cols, type: 'custom' });
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  /* ── Render ── */

  // Find the zone whose picker is open (for the portal popover)
  const pickerZoneData = pickerZone
    ? layout.columns.flatMap((c) => c.zones).find((z) => z.id === pickerZone) ?? null
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Template picker ── */}
      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
        <span
          className="text-[10px] font-medium shrink-0"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          Templates:
        </span>
        {TEMPLATE_ORDER.map((type) => {
          const t = LAYOUT_TEMPLATES[type];
          return (
            <button
              key={type}
              onClick={() => applyTemplate(type)}
              className="text-[10px] px-2.5 py-1 rounded-md shrink-0 transition-colors hover:opacity-80"
              style={{
                background:
                  layout.type === type
                    ? 'var(--ink-accent)'
                    : 'var(--ink-subtle)',
                color:
                  layout.type === type
                    ? 'var(--ink-on-accent)'
                    : 'var(--ink-text-muted)',
              }}
              title={t.desc}
            >
              {t.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <span
          className="text-[10px] shrink-0"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          {layout.columns.length} col{layout.columns.length !== 1 ? 's' : ''}
        </span>
        {layout.columns.length < MAX_COLUMNS && (
          <button
            onClick={addColumn}
            className="z-btn z-btn-primary z-btn-xs shrink-0"
          >
            + Col
          </button>
        )}
        <button
          onClick={onReset}
          className="text-[10px] px-2.5 py-1 rounded-md transition-colors hover:opacity-80 shrink-0"
          style={{ color: 'var(--ink-text-muted)', background: 'var(--ink-subtle)' }}
        >
          Reset
        </button>
      </div>

      {/* ── WYSIWYG zone grid with real widgets ── */}
      <div
        ref={containerRef}
        className="flex flex-1 min-h-0 select-none"
        style={{ gap: '6px' }}
      >
        {layout.columns.map((col, ci) => (
          <Fragment key={col.id}>
            {/* ─ Column ─ */}
            <div
              className="relative flex flex-col min-w-0 min-h-0"
              style={{ width: `${col.width * 100}%`, gap: '0px' }}
            >
              {/* Column header badge */}
              <div className="flex items-center justify-between px-1 mb-1 shrink-0">
                <span
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded"
                  style={{ color: 'var(--ink-text-muted)', background: 'var(--ink-subtle)' }}
                >
                  {Math.round(col.width * 100)}%
                </span>
                {layout.columns.length > 1 && (
                  <button
                    onClick={() => removeColumn(col.id)}
                    className="text-[9px] w-4 h-4 flex items-center justify-center rounded hover:opacity-80 transition-colors"
                    style={{ color: 'var(--ink-blocked)', background: 'var(--ink-subtle)' }}
                    title="Remove column"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Zones with real widgets */}
              <div
                className="flex-1 flex flex-col min-h-0"
                style={{ gap: 0 }}
              >
                {col.zones.map((zone, zi) => {
                  const isPicker = pickerZone === zone.id;
                  const isHover = hoverZone === zone.id;

                  return (
                    <Fragment key={zone.id}>
                      {/* Zone cell — real widget with editing overlay */}
                      <div
                        className="relative min-h-0 rounded-lg overflow-visible transition-shadow"
                        style={{
                          flex: zone.height,
                          outline: isPicker
                            ? '2px solid var(--ink-accent)'
                            : isHover
                              ? '2px dashed var(--ink-accent)'
                              : '2px dashed color-mix(in srgb, var(--ink-border) 50%, transparent)',
                          outlineOffset: '-2px',
                        }}
                        onMouseEnter={() => setHoverZone(zone.id)}
                        onMouseLeave={() => setHoverZone(null)}
                      >
                        {/* Real widget content */}
                        {zone.widget ? (
                          <div className="h-full overflow-y-auto rounded-lg overflow-x-hidden">
                            {renderWidget(zone.widget)}
                          </div>
                        ) : (
                          <div
                            className="h-full flex flex-col items-center justify-center cursor-pointer rounded-lg"
                            style={{
                              background: 'color-mix(in srgb, var(--ink-card-bg) 80%, transparent)',
                              border: '1px dashed color-mix(in srgb, var(--ink-border) 40%, transparent)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPickerZone(isPicker ? null : zone.id);
                            }}
                          >
                            <p
                              className="text-[11px]"
                              style={{ color: 'var(--ink-text-muted)', opacity: 0.5 }}
                            >
                              Click to assign widget
                            </p>
                          </div>
                        )}

                        {/* Edit overlay controls — visible on hover */}
                        <div
                          className="absolute inset-0 rounded-lg flex items-start justify-end p-1 pointer-events-none transition-opacity"
                          style={{ opacity: isHover || isPicker ? 1 : 0 }}
                        >
                          <div className="flex items-center gap-0.5 pointer-events-auto">
                            <button
                              ref={(el) => { triggerRefs.current.set(zone.id, el); }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPickerZone(isPicker ? null : zone.id);
                              }}
                              className="text-[8px] px-1.5 py-0.5 rounded transition-colors hover:opacity-80 backdrop-blur-sm"
                              style={{
                                color: 'var(--ink-on-accent)',
                                background: 'color-mix(in srgb, var(--ink-accent) 85%, transparent)',
                              }}
                              title={zone.widget ? 'Change widget' : 'Assign widget'}
                            >
                              {zone.widget ? '⇄' : '+'}
                            </button>
                            {col.zones.length < MAX_ZONES && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  splitZone(col.id, zone.id);
                                }}
                                className="text-[8px] px-1.5 py-0.5 rounded transition-colors hover:opacity-80 backdrop-blur-sm"
                                style={{
                                  color: 'var(--ink-on-accent)',
                                  background: 'color-mix(in srgb, var(--ink-accent) 85%, transparent)',
                                }}
                                title="Split zone"
                              >
                                ⊞
                              </button>
                            )}
                            {col.zones.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeZone(col.id, zone.id);
                                }}
                                className="text-[8px] px-1 py-0.5 rounded transition-colors hover:opacity-80 backdrop-blur-sm"
                                style={{
                                  color: 'white',
                                  background: 'color-mix(in srgb, var(--ink-blocked) 85%, transparent)',
                                }}
                                title="Remove zone"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Horizontal separator between zones */}
                      {zi < col.zones.length - 1 && (
                        <div
                          className="h-3 cursor-row-resize flex items-center justify-center group/sep mx-2 shrink-0"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleZoneSepDown(e, col, zi);
                          }}
                          title="Drag to resize zones"
                        >
                          <div
                            className="w-10 h-0.5 rounded-full transition-all group-hover/sep:h-1 group-active/sep:h-1"
                            style={{
                              background: 'var(--ink-accent)',
                              opacity: 0.35,
                            }}
                          />
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            </div>

            {/* Vertical separator between columns */}
            {ci < layout.columns.length - 1 && (
              <div
                className="w-3 cursor-col-resize flex items-center justify-center group/sep shrink-0"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleColSepDown(e, ci);
                }}
                title="Drag to resize columns"
              >
                <div
                  className="w-0.5 h-14 rounded-full transition-all group-hover/sep:w-1 group-active/sep:w-1"
                  style={{ background: 'var(--ink-accent)', opacity: 0.35 }}
                />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      {/* ── Widget picker popover (portal) ── */}
      {pickerZone && pickerZoneData && (
        <WidgetPickerPopover
          anchorRef={getTriggerRef(pickerZone)}
          zoneId={pickerZone}
          currentWidget={pickerZoneData.widget}
          assignedWidgets={assignedWidgets}
          onAssign={assignWidget}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
