import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ITEM_HEIGHT = 44;
const WHEEL_HEIGHT = 220;
const WHEEL_PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;
const SNAP_DURATION_MS = 320;
const SETTLE_DELAY_MS = 420;
const SNAP_LOCK_MS = 80;
const SNAP_THRESHOLD_PX = 1.5;

function normalizeTime(time: string): string {
  const parts = time.trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isHourEntryComplete(digits: string, minH: number, maxH: number): boolean {
  if (digits.length >= 2) return true;
  if (digits.length !== 1) return false;
  const d = Number(digits);
  if (!Number.isFinite(d)) return false;
  if (d > 2) return d >= minH && d <= maxH;
  return false;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(max, index));
}

function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function getSnapIndex(scrollTop: number, maxIndex: number): number {
  return clampIndex(Math.round(scrollTop / ITEM_HEIGHT), maxIndex);
}

function getSnapTop(index: number): number {
  return index * ITEM_HEIGHT;
}

function animateScrollTop(
  el: HTMLDivElement,
  targetTop: number,
  onFrame?: (scrollTop: number) => void,
  duration = SNAP_DURATION_MS,
): Promise<void> {
  const startTop = el.scrollTop;
  const delta = targetTop - startTop;
  if (Math.abs(delta) < 0.5) {
    el.scrollTop = targetTop;
    onFrame?.(targetTop);
    return Promise.resolve();
  }

  const ease = Math.abs(delta) <= ITEM_HEIGHT * 0.6 ? easeOutQuart : easeOutCubic;

  return new Promise((resolve) => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const nextTop = startTop + delta * ease(progress);
      el.scrollTop = nextTop;
      onFrame?.(nextTop);
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        el.scrollTop = targetTop;
        onFrame?.(targetTop);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

function readCenteredValue(scrollEl: HTMLDivElement | null, items: number[]): number {
  if (!scrollEl || items.length === 0) return items[0] ?? 0;
  const idx = getSnapIndex(scrollEl.scrollTop, items.length - 1);
  return items[idx];
}

function getItemVisualStyle(index: number, scrollTop: number) {
  const viewportCenter = scrollTop + WHEEL_HEIGHT / 2;
  const itemCenter = WHEEL_PAD + index * ITEM_HEIGHT + ITEM_HEIGHT / 2;
  const distance = Math.abs(viewportCenter - itemCenter);
  const norm = Math.min(1, distance / (ITEM_HEIGHT * 1.75));
  return {
    opacity: 1 - norm * 0.72,
    transform: `scale(${1 - norm * 0.1})`,
  };
}

function parseAllowedTimes(times: string[] | undefined): string[] {
  if (!times?.length) return [];
  return [...new Set(times.map(normalizeTime).filter((t) => t))].sort();
}

function hoursFromAllowedTimes(allowed: string[]): number[] {
  const set = new Set<number>();
  for (const t of allowed) {
    set.add(Number(t.split(':')[0]));
  }
  return Array.from(set).sort((a, b) => a - b);
}

function minutesFromAllowedTimes(allowed: string[], hour: number): number[] {
  const set = new Set<number>();
  for (const t of allowed) {
    const [h, m] = t.split(':').map(Number);
    if (h === hour) set.add(m);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function nearestMinute(minute: number, options: number[]): number {
  if (options.length === 0) return minute;
  return options.reduce((prev, curr) =>
    Math.abs(curr - minute) < Math.abs(prev - minute) ? curr : prev,
  );
}

export type WheelTimePickerProps = {
  value: string;
  onChange: (time: string) => void;
  label?: string;
  labelClassName?: string;
  loading?: boolean;
  disabled?: boolean;
  unavailable?: boolean;
  emptyMessage?: string;
  minHour?: number;
  maxHour?: number;
  minuteStep?: number;
  /** When set, only these HH:mm values can be selected (e.g. server slots in client local time). */
  allowedTimes?: string[];
  className?: string;
  /**
   * `always` — hour/minute inputs sit above the wheel (default).
   * `toggle` — wheel is primary; inputs open via an alternate control (portal booking).
   */
  manualInputs?: 'always' | 'toggle';
};

type WheelColumnProps = {
  label: string;
  items: number[];
  selected: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onActiveChange: (value: number) => void;
  onSettled: () => void;
  /** When set, tapping the centered value opens inline editing for this column. */
  editing?: boolean;
  editDraft?: string;
  onEditCenter?: () => void;
  onEditDraftChange?: (digits: string) => void;
  onEditCommit?: () => void;
  onEditCancel?: () => void;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
};

function WheelColumn({
  label,
  items,
  selected,
  scrollRef,
  onActiveChange,
  onSettled,
  editing = false,
  editDraft,
  onEditCenter,
  onEditDraftChange,
  onEditCommit,
  onEditCancel,
  editInputRef,
}: WheelColumnProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const isUserScroll = useRef(false);
  const isAnimating = useRef(false);
  const isSnapping = useRef(false);
  const isPointerDown = useRef(false);
  const rafRef = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapLockUntil = useRef(0);

  const reportFrame = useCallback(
    (top: number) => {
      setScrollTop(top);
      const idx = getSnapIndex(top, items.length - 1);
      onActiveChange(items[idx]);
    },
    [items, onActiveChange],
  );

  const scrollToValue = useCallback(
    async (target: number, smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = items.indexOf(target);
      if (idx < 0) return;
      const top = getSnapTop(idx);
      if (Math.abs(el.scrollTop - top) < 0.5) {
        reportFrame(top);
        return;
      }

      isAnimating.current = true;
      if (smooth) {
        await animateScrollTop(el, top, reportFrame);
      } else {
        el.scrollTop = top;
        reportFrame(top);
      }
      isAnimating.current = false;
      snapLockUntil.current = Date.now() + SNAP_LOCK_MS;
    },
    [items, reportFrame, scrollRef],
  );

  const snapToNearest = useCallback(async () => {
    const el = scrollRef.current;
    if (!el || isAnimating.current || isSnapping.current || isPointerDown.current) return;
    if (Date.now() < snapLockUntil.current) return;

    const idx = getSnapIndex(el.scrollTop, items.length - 1);
    const top = getSnapTop(idx);
    const offset = Math.abs(el.scrollTop - top);

    if (offset < SNAP_THRESHOLD_PX) {
      reportFrame(top);
      onSettled();
      return;
    }

    isSnapping.current = true;
    isAnimating.current = true;
    const duration = Math.min(
      SNAP_DURATION_MS,
      Math.max(180, Math.round((offset / ITEM_HEIGHT) * SNAP_DURATION_MS)),
    );
    await animateScrollTop(el, top, reportFrame, duration);
    isAnimating.current = false;
    isSnapping.current = false;
    snapLockUntil.current = Date.now() + SNAP_LOCK_MS;
    onSettled();
  }, [items, onSettled, reportFrame, scrollRef]);

  const scheduleSettle = useCallback(
    (delay = SETTLE_DELAY_MS) => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        if (isPointerDown.current) return;
        void snapToNearest().finally(() => {
          isUserScroll.current = false;
        });
      }, delay);
    },
    [snapToNearest],
  );

  const finishScrollInteraction = useCallback(() => {
    if (isPointerDown.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    // Let native scroll-snap / momentum finish before a gentle correction.
    scheduleSettle(60);
  }, [scheduleSettle]);

  useEffect(() => {
    if (isUserScroll.current || isAnimating.current) return;
    void scrollToValue(selected, false);
  }, [selected, scrollToValue]);

  const handleScroll = useCallback(() => {
    if (isAnimating.current || isSnapping.current) return;
    isUserScroll.current = true;

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
      onActiveChange(readCenteredValue(el, items));
    });

    if (!isPointerDown.current) {
      scheduleSettle();
    }
  }, [items, onActiveChange, scheduleSettle, scrollRef]);

  const handleItemSelect = useCallback(
    (item: number, isCentered: boolean) => {
      if (isCentered && onEditCenter) {
        onEditCenter();
        return;
      }
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      isUserScroll.current = true;
      void scrollToValue(item, true).then(() => {
        onSettled();
        isUserScroll.current = false;
      });
    },
    [onEditCenter, onSettled, scrollToValue],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onPointerDown = () => {
      isPointerDown.current = true;
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
    };

    const onPointerUp = () => {
      isPointerDown.current = false;
      scheduleSettle();
    };

    const onScrollEnd = () => {
      if (isAnimating.current || isSnapping.current) return;
      finishScrollInteraction();
    };

    el.addEventListener('scrollend', onScrollEnd);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('scrollend', onScrollEnd);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [finishScrollInteraction, scheduleSettle, scrollRef]);

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
        {label}
      </span>
      <div className="relative w-full" style={{ height: WHEEL_HEIGHT }}>
        <div
          className={`pointer-events-none absolute inset-x-1 top-1/2 z-10 h-11 -translate-y-1/2 rounded-lg border shadow-sm ${
            editing
              ? 'border-primary bg-base-100'
              : 'border-primary/35 bg-base-100/70'
          }`}
          aria-hidden
        />
        {editing ? (
          <input
            ref={editInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={2}
            className="absolute inset-x-1 top-1/2 z-30 h-11 w-[calc(100%-0.5rem)] -translate-y-1/2 rounded-lg border-0 bg-transparent text-center text-lg font-semibold tabular-nums text-primary outline-none focus:ring-0"
            value={editDraft ?? ''}
            aria-label={`Edit ${label}`}
            onChange={(e) => onEditDraftChange?.(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => onEditCommit?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onEditCommit?.();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onEditCancel?.();
              }
            }}
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[72px] bg-gradient-to-b from-base-100 via-base-100/90 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[72px] bg-gradient-to-t from-base-100 via-base-100/90 to-transparent"
          aria-hidden
        />
        <div
          ref={scrollRef}
          role="listbox"
          aria-label={label}
          aria-hidden={editing}
          className={`wheel-time-picker-scroll relative z-0 h-full w-full overflow-y-auto overscroll-contain touch-pan-y select-none ${
            editing ? 'pointer-events-none opacity-0' : ''
          }`}
          onScroll={handleScroll}
        >
          <div style={{ height: WHEEL_PAD }} aria-hidden />
          {items.map((item, index) => {
            const visual = getItemVisualStyle(index, scrollTop);
            const isCentered = index === getSnapIndex(scrollTop, items.length - 1);
            return (
              <div
                key={item}
                role="option"
                aria-selected={isCentered}
                className={`wheel-time-picker-item mx-1 flex h-11 w-[calc(100%-0.5rem)] shrink-0 cursor-pointer items-center justify-center rounded-lg text-lg font-semibold tabular-nums will-change-transform ${
                  isCentered ? 'text-primary' : 'text-gray-500'
                }`}
                style={{
                  opacity: visual.opacity,
                  transform: visual.transform,
                }}
                onClick={() => handleItemSelect(item, isCentered)}
              >
                {pad2(item)}
              </div>
            );
          })}
          <div style={{ height: WHEEL_PAD }} aria-hidden />
        </div>
      </div>
    </div>
  );
};

const WheelTimePicker: React.FC<WheelTimePickerProps> = ({
  value,
  onChange,
  label,
  labelClassName = 'block font-semibold mb-1',
  loading = false,
  disabled = false,
  unavailable = false,
  emptyMessage = 'No times available.',
  minHour = 8,
  maxHour = 23,
  minuteStep = 1,
  allowedTimes,
  className = '',
  manualInputs = 'always',
}) => {
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);
  const minuteInputRef = useRef<HTMLInputElement>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmitted = useRef<string | null>(null);

  const normalizedAllowedTimes = useMemo(() => parseAllowedTimes(allowedTimes), [allowedTimes]);
  const usingAllowedTimes = normalizedAllowedTimes.length > 0;

  const defaultMinutes = useMemo(() => {
    const step = Math.max(1, Math.min(30, minuteStep));
    const list: number[] = [];
    for (let m = 0; m < 60; m += step) list.push(m);
    return list;
  }, [minuteStep]);

  const hours = useMemo(() => {
    if (usingAllowedTimes) return hoursFromAllowedTimes(normalizedAllowedTimes);
    const list: number[] = [];
    for (let h = minHour; h <= maxHour; h += 1) list.push(h);
    return list;
  }, [minHour, maxHour, normalizedAllowedTimes, usingAllowedTimes]);

  const getMinutesForHour = useCallback(
    (hour: number) => {
      if (usingAllowedTimes) return minutesFromAllowedTimes(normalizedAllowedTimes, hour);
      return defaultMinutes;
    },
    [defaultMinutes, normalizedAllowedTimes, usingAllowedTimes],
  );

  const normalizedValue = normalizeTime(value);
  const parsedHour = normalizedValue ? Number(normalizedValue.split(':')[0]) : null;
  const parsedMinute = normalizedValue ? Number(normalizedValue.split(':')[1]) : null;

  const snapMinuteToStep = useCallback(
    (minute: number, hour: number) => {
      const options = getMinutesForHour(hour);
      if (options.includes(minute)) return minute;
      if (usingAllowedTimes) return nearestMinute(minute, options);
      const step = Math.max(1, minuteStep);
      const snapped = Math.round(minute / step) * step;
      const clamped = Math.min(59, Math.max(0, snapped));
      if (options.includes(clamped)) return clamped;
      return nearestMinute(clamped, options);
    },
    [getMinutesForHour, minuteStep, usingAllowedTimes],
  );

  const selectedHour =
    parsedHour != null && hours.includes(parsedHour) ? parsedHour : hours[0] ?? minHour;
  const selectedMinute =
    parsedMinute != null ? snapMinuteToStep(parsedMinute, selectedHour) : getMinutesForHour(selectedHour)[0] ?? 0;

  const [liveHour, setLiveHour] = useState(selectedHour);
  const [liveMinute, setLiveMinute] = useState(selectedMinute);
  const [hourDraft, setHourDraft] = useState<string | null>(null);
  const [minuteDraft, setMinuteDraft] = useState<string | null>(null);
  const [manualInputsOpen, setManualInputsOpen] = useState(manualInputs === 'always');
  const [editingColumn, setEditingColumn] = useState<'hour' | 'minute' | null>(null);
  const hourColumnInputRef = useRef<HTMLInputElement>(null);
  const minuteColumnInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setManualInputsOpen(manualInputs === 'always');
  }, [manualInputs]);

  const showManualInputs = manualInputs === 'always' || manualInputsOpen;
  /** Portal (`toggle`): centered slot click becomes an inline input. */
  const inlineCenterEdit = manualInputs === 'toggle';

  const focusTopHourInput = useCallback(() => {
    setHourDraft('');
    requestAnimationFrame(() => {
      hourInputRef.current?.focus();
      hourInputRef.current?.select();
    });
  }, []);

  const focusTopMinuteInput = useCallback(() => {
    setMinuteDraft('');
    requestAnimationFrame(() => {
      minuteInputRef.current?.focus();
      minuteInputRef.current?.select();
    });
  }, []);

  const activeMinutes = useMemo(() => getMinutesForHour(liveHour), [getMinutesForHour, liveHour]);
  const inputMinHour = hours[0] ?? minHour;
  const inputMaxHour = hours[hours.length - 1] ?? maxHour;

  useEffect(() => {
    setLiveHour(selectedHour);
    setLiveMinute(selectedMinute);
    setHourDraft(null);
    setMinuteDraft(null);
  }, [selectedHour, selectedMinute]);

  useEffect(() => {
    if (!usingAllowedTimes || activeMinutes.length === 0) return;
    if (!activeMinutes.includes(liveMinute)) {
      setLiveMinute(activeMinutes[0]);
    }
  }, [activeMinutes, liveMinute, usingAllowedTimes]);

  const clampHour = useCallback(
    (hour: number) => {
      if (!Number.isFinite(hour)) return selectedHour;
      if (hours.includes(hour)) return hour;
      const clamped = Math.max(inputMinHour, Math.min(inputMaxHour, Math.round(hour)));
      if (hours.includes(clamped)) return clamped;
      return hours.reduce((prev, curr) =>
        Math.abs(curr - hour) < Math.abs(prev - hour) ? curr : prev,
      );
    },
    [hours, inputMaxHour, inputMinHour, selectedHour],
  );

  const clampMinute = useCallback(
    (minute: number, hour = liveHour) => {
      if (!Number.isFinite(minute)) return selectedMinute;
      const snapped = snapMinuteToStep(minute, hour);
      const options = getMinutesForHour(hour);
      if (options.includes(snapped)) return snapped;
      return nearestMinute(snapped, options);
    },
    [getMinutesForHour, liveHour, selectedMinute, snapMinuteToStep],
  );

  const resolveAllowedTime = useCallback(
    (hour: number, minute: number) => {
      const nextHour = clampHour(hour);
      const nextMinute = clampMinute(minute, nextHour);
      const next = `${pad2(nextHour)}:${pad2(nextMinute)}`;
      if (!usingAllowedTimes || normalizedAllowedTimes.includes(next)) {
        return { hour: nextHour, minute: nextMinute };
      }

      const mins = getMinutesForHour(nextHour);
      if (mins.length > 0) {
        return { hour: nextHour, minute: nearestMinute(nextMinute, mins) };
      }

      const fallback = normalizedAllowedTimes[0];
      const [h, m] = fallback.split(':').map(Number);
      return { hour: h, minute: m };
    },
    [clampHour, clampMinute, getMinutesForHour, normalizedAllowedTimes, usingAllowedTimes],
  );

  const applyTime = useCallback(
    (hour: number, minute: number) => {
      const { hour: nextHour, minute: nextMinute } = resolveAllowedTime(hour, minute);
      const next = `${pad2(nextHour)}:${pad2(nextMinute)}`;
      setLiveHour(nextHour);
      setLiveMinute(nextMinute);
      setHourDraft(null);
      setMinuteDraft(null);
      lastEmitted.current = next;
      if (next !== normalizeTime(value)) onChange(next);
    },
    [onChange, resolveAllowedTime, value],
  );

  const handleHourActiveChange = useCallback(
    (hour: number) => {
      setLiveHour(hour);
      if (usingAllowedTimes) {
        const validMins = getMinutesForHour(hour);
        setLiveMinute((prev) => (validMins.includes(prev) ? prev : validMins[0] ?? 0));
      }
    },
    [getMinutesForHour, usingAllowedTimes],
  );

  const commitHourInput = useCallback(() => {
    if (hourDraft === null) return;
    const raw = hourDraft.trim();
    setHourDraft(null);
    if (!raw) return;
    applyTime(Number(raw), liveMinute);
  }, [applyTime, hourDraft, liveMinute]);

  const commitMinuteInput = useCallback(() => {
    if (minuteDraft === null) return;
    const raw = minuteDraft.trim();
    setMinuteDraft(null);
    if (!raw) return;
    applyTime(liveHour, Number(raw));
  }, [applyTime, liveHour, minuteDraft]);

  const focusMinuteInput = useCallback(() => {
    setMinuteDraft('');
    requestAnimationFrame(() => {
      const el = minuteInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, []);

  const handleHourFocus = useCallback(() => {
    setHourDraft('');
    requestAnimationFrame(() => hourInputRef.current?.select());
  }, []);

  const handleMinuteFocus = useCallback(() => {
    setMinuteDraft('');
    requestAnimationFrame(() => minuteInputRef.current?.select());
  }, []);

  const handleHourInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(/\D/g, '').slice(0, 2);
      setHourDraft(next);

      if (!next) return;

      if (isHourEntryComplete(next, inputMinHour, inputMaxHour)) {
        applyTime(Number(next), liveMinute);
        focusMinuteInput();
      }
    },
    [applyTime, focusMinuteInput, inputMaxHour, inputMinHour, liveMinute],
  );

  const handleMinuteInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value.replace(/\D/g, '').slice(0, 2);
      setMinuteDraft(next);

      if (next.length >= 2) {
        applyTime(liveHour, Number(next));
        requestAnimationFrame(() => minuteInputRef.current?.blur());
      }
    },
    [applyTime, liveHour],
  );

  const focusColumnInput = useCallback((column: 'hour' | 'minute') => {
    requestAnimationFrame(() => {
      const el = column === 'hour' ? hourColumnInputRef.current : minuteColumnInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, []);

  const startEditColumn = useCallback(
    (column: 'hour' | 'minute') => {
      setEditingColumn(column);
      if (column === 'hour') {
        setHourDraft('');
        setMinuteDraft(null);
      } else {
        setMinuteDraft('');
        setHourDraft(null);
      }
      focusColumnInput(column);
    },
    [focusColumnInput],
  );

  const cancelEditColumn = useCallback(() => {
    setEditingColumn(null);
    setHourDraft(null);
    setMinuteDraft(null);
  }, []);

  const commitHourColumnEdit = useCallback(() => {
    if (hourDraft !== null && hourDraft.trim()) {
      applyTime(Number(hourDraft), liveMinute);
    }
    setHourDraft(null);
    setEditingColumn(null);
  }, [applyTime, hourDraft, liveMinute]);

  const commitMinuteColumnEdit = useCallback(() => {
    if (minuteDraft !== null && minuteDraft.trim()) {
      applyTime(liveHour, Number(minuteDraft));
    }
    setMinuteDraft(null);
    setEditingColumn(null);
  }, [applyTime, liveHour, minuteDraft]);

  const handleHourColumnDraftChange = useCallback(
    (next: string) => {
      setHourDraft(next);
      if (!next) return;
      if (isHourEntryComplete(next, inputMinHour, inputMaxHour)) {
        applyTime(Number(next), liveMinute);
        setHourDraft(null);
        setEditingColumn('minute');
        setMinuteDraft('');
        focusColumnInput('minute');
      }
    },
    [applyTime, focusColumnInput, inputMaxHour, inputMinHour, liveMinute],
  );

  const handleMinuteColumnDraftChange = useCallback(
    (next: string) => {
      setMinuteDraft(next);
      if (next.length >= 2) {
        applyTime(liveHour, Number(next));
        setMinuteDraft(null);
        setEditingColumn(null);
      }
    },
    [applyTime, liveHour],
  );

  const emitChange = useCallback(() => {
    const hour = readCenteredValue(hourScrollRef.current, hours);
    const minuteOptions = getMinutesForHour(hour);
    const minute = readCenteredValue(minuteScrollRef.current, minuteOptions);
    const next = `${pad2(hour)}:${pad2(minute)}`;
    if (usingAllowedTimes && !normalizedAllowedTimes.includes(next)) return;
    if (next === lastEmitted.current) return;
    lastEmitted.current = next;
    setLiveHour(hour);
    setLiveMinute(minute);
    if (next !== normalizeTime(value)) onChange(next);
  }, [getMinutesForHour, hours, normalizedAllowedTimes, onChange, usingAllowedTimes, value]);

  const handleSettled = useCallback(() => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => emitChange(), 60);
  }, [emitChange]);

  useEffect(
    () => () => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
    },
    [],
  );

  useEffect(() => {
    lastEmitted.current = normalizeTime(value) || null;
  }, [value]);

  useEffect(() => {
    if (loading || unavailable || disabled || hours.length === 0) return;
    const current = normalizeTime(value);
    if (!current) {
      if (usingAllowedTimes) {
        onChange(normalizedAllowedTimes[0]);
      } else {
        onChange(`${pad2(hours[0])}:${pad2(getMinutesForHour(hours[0])[0] ?? 0)}`);
      }
      return;
    }
    if (usingAllowedTimes && !normalizedAllowedTimes.includes(current)) {
      onChange(normalizedAllowedTimes[0]);
    }
  }, [
    disabled,
    getMinutesForHour,
    hours,
    loading,
    normalizedAllowedTimes,
    onChange,
    unavailable,
    usingAllowedTimes,
    value,
  ]);

  if (loading) {
    return (
      <div className={className}>
        {label ? <label className={labelClassName}>{label}</label> : null}
        <div className="flex items-center justify-center py-12">
          <span className="loading loading-spinner loading-lg text-primary" />
        </div>
      </div>
    );
  }

  if (unavailable || hours.length === 0 || (usingAllowedTimes && activeMinutes.length === 0)) {
    return (
      <div className={className}>
        {label ? <label className={labelClassName}>{label}</label> : null}
        <p className="mt-2 text-sm text-base-content/45">{emptyMessage}</p>
      </div>
    );
  }

  const hourInputValue = hourDraft !== null ? hourDraft : pad2(liveHour);
  const minuteInputValue = minuteDraft !== null ? minuteDraft : pad2(liveMinute);

  const renderManualInputs = (spacingClass: string) => (
    <div className={`flex items-end justify-center gap-2 ${spacingClass}`}>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
          Hour
        </span>
        <input
          ref={hourInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          className="input input-bordered input-sm h-11 w-[4.25rem] text-center text-lg font-semibold tabular-nums"
          value={hourInputValue}
          onFocus={handleHourFocus}
          onChange={handleHourInputChange}
          onBlur={commitHourInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitHourInput();
              focusMinuteInput();
            }
          }}
          aria-label="Hour"
        />
      </div>
      <span className="mb-2 text-2xl font-bold text-base-content/25">:</span>
      <div className="flex flex-col items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
          Min
        </span>
        <input
          ref={minuteInputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          className="input input-bordered input-sm h-11 w-[4.25rem] text-center text-lg font-semibold tabular-nums"
          value={minuteInputValue}
          onFocus={handleMinuteFocus}
          onChange={handleMinuteInputChange}
          onBlur={commitMinuteInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          aria-label="Minute"
        />
      </div>
    </div>
  );

  return (
    <div className={className}>
      {label ? <label className={labelClassName}>{label}</label> : null}
      <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
        <div className="relative mx-auto max-w-xs">
          {showManualInputs && manualInputs === 'always' ? renderManualInputs('mb-3') : null}

          <div className="flex items-stretch justify-center gap-1 sm:gap-2">
            <WheelColumn
              label="Hour"
              items={hours}
              selected={liveHour}
              scrollRef={hourScrollRef}
              onActiveChange={handleHourActiveChange}
              onSettled={handleSettled}
              editing={inlineCenterEdit && editingColumn === 'hour'}
              editDraft={hourDraft ?? ''}
              onEditCenter={
                inlineCenterEdit
                  ? () => startEditColumn('hour')
                  : showManualInputs
                    ? focusTopHourInput
                    : () => {
                        setManualInputsOpen(true);
                        focusTopHourInput();
                      }
              }
              onEditDraftChange={handleHourColumnDraftChange}
              onEditCommit={commitHourColumnEdit}
              onEditCancel={cancelEditColumn}
              editInputRef={hourColumnInputRef}
            />
            <div
              className="flex shrink-0 items-center self-center text-2xl font-bold text-base-content/25"
              style={{ paddingTop: 18, height: WHEEL_HEIGHT + 18 }}
            >
              :
            </div>
            <WheelColumn
              label="Min"
              items={activeMinutes}
              selected={liveMinute}
              scrollRef={minuteScrollRef}
              onActiveChange={setLiveMinute}
              onSettled={handleSettled}
              editing={inlineCenterEdit && editingColumn === 'minute'}
              editDraft={minuteDraft ?? ''}
              onEditCenter={
                inlineCenterEdit
                  ? () => startEditColumn('minute')
                  : showManualInputs
                    ? focusTopMinuteInput
                    : () => {
                        setManualInputsOpen(true);
                        focusTopMinuteInput();
                      }
              }
              onEditDraftChange={handleMinuteColumnDraftChange}
              onEditCommit={commitMinuteColumnEdit}
              onEditCancel={cancelEditColumn}
              editInputRef={minuteColumnInputRef}
            />
          </div>

          {manualInputs === 'toggle' ? (
            <div className="mt-3 flex flex-col items-center gap-3">
              <button
                type="button"
                className="btn btn-ghost btn-sm rounded-full font-medium text-base-content/55 hover:text-primary"
                onClick={() => {
                  setManualInputsOpen((open) => {
                    const next = !open;
                    if (next) {
                      requestAnimationFrame(() => {
                        hourInputRef.current?.focus();
                        hourInputRef.current?.select();
                      });
                    }
                    return next;
                  });
                }}
                aria-expanded={showManualInputs}
              >
                {showManualInputs ? 'Hide typed time' : 'Type hour & minute'}
              </button>
              {showManualInputs ? renderManualInputs('') : null}
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        .wheel-time-picker-scroll {
          -webkit-overflow-scrolling: touch;
          scroll-snap-type: y proximity;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .wheel-time-picker-scroll::-webkit-scrollbar {
          display: none;
        }
        .wheel-time-picker-item {
          scroll-snap-align: center;
          scroll-snap-stop: normal;
        }
      `}</style>
    </div>
  );
};

export default WheelTimePicker;
