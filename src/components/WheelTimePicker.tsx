import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

const ITEM_HEIGHT = 44;
const WHEEL_HEIGHT = 220;
const WHEEL_PAD = (WHEEL_HEIGHT - ITEM_HEIGHT) / 2;
const SNAP_DURATION_MS = 320;

const ALL_MINUTES = Array.from({ length: 60 }, (_, i) => i);

function normalizeTime(time: string): string {
  const parts = time.trim().split(':');
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDisplay12h(time: string): string {
  const normalized = normalizeTime(time);
  if (!normalized) return time;
  const [h, m] = normalized.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clampIndex(index: number, max: number): number {
  return Math.max(0, Math.min(max, index));
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

  return new Promise((resolve) => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const nextTop = startTop + delta * easeOutCubic(progress);
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
  showSummary?: boolean;
  className?: string;
};

type WheelColumnProps = {
  label: string;
  items: number[];
  selected: number;
  activeValue: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onActiveChange: (value: number) => void;
  onSettled: () => void;
};

function WheelColumn({
  label,
  items,
  selected,
  activeValue,
  scrollRef,
  onActiveChange,
  onSettled,
}: WheelColumnProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const isUserScroll = useRef(false);
  const isAnimating = useRef(false);
  const isSnapping = useRef(false);
  const rafRef = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (Math.abs(el.scrollTop - top) < 0.5) return;

      isAnimating.current = true;
      setIsScrolling(true);
      if (smooth) {
        await animateScrollTop(el, top, reportFrame);
      } else {
        el.scrollTop = top;
        reportFrame(top);
      }
      isAnimating.current = false;
      setIsScrolling(false);
    },
    [items, reportFrame, scrollRef],
  );

  const snapToNearest = useCallback(async () => {
    const el = scrollRef.current;
    if (!el || isAnimating.current || isSnapping.current) return;

    const idx = getSnapIndex(el.scrollTop, items.length - 1);
    const top = getSnapTop(idx);
    if (Math.abs(el.scrollTop - top) < 0.5) {
      reportFrame(top);
      setIsScrolling(false);
      onSettled();
      return;
    }

    isSnapping.current = true;
    isAnimating.current = true;
    setIsScrolling(true);
    await animateScrollTop(el, top, reportFrame);
    isAnimating.current = false;
    isSnapping.current = false;
    setIsScrolling(false);
    onSettled();
  }, [items, onSettled, reportFrame, scrollRef]);

  useEffect(() => {
    if (isUserScroll.current || isAnimating.current) return;
    void scrollToValue(selected, true);
  }, [selected, scrollToValue]);

  const handleScroll = useCallback(() => {
    if (isAnimating.current) return;
    isUserScroll.current = true;
    setIsScrolling(true);

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
      onActiveChange(readCenteredValue(el, items));
    });

    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      void snapToNearest().finally(() => {
        isUserScroll.current = false;
      });
    }, 120);
  }, [items, onActiveChange, scrollRef, snapToNearest]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScrollEnd = () => {
      void snapToNearest().finally(() => {
        isUserScroll.current = false;
      });
    };
    const onPointerUp = () => {
      void snapToNearest().finally(() => {
        isUserScroll.current = false;
      });
    };

    el.addEventListener('scrollend', onScrollEnd);
    el.addEventListener('touchend', onPointerUp, { passive: true });
    el.addEventListener('mouseup', onPointerUp);

    return () => {
      el.removeEventListener('scrollend', onScrollEnd);
      el.removeEventListener('touchend', onPointerUp);
      el.removeEventListener('mouseup', onPointerUp);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, snapToNearest]);

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-base-content/45">
        {label}
      </span>
      <div className="relative w-full" style={{ height: WHEEL_HEIGHT }}>
        <div
          className={`pointer-events-none absolute inset-x-1 top-1/2 z-[15] flex h-11 -translate-y-1/2 items-center justify-center rounded-lg text-lg font-semibold tabular-nums ${
            isScrolling
              ? 'border border-primary/40 bg-transparent shadow-none'
              : 'border border-transparent bg-primary text-primary-content shadow-sm'
          }`}
          style={{
            transition: isScrolling
              ? 'background-color 140ms ease-in, border-color 140ms ease-in, box-shadow 140ms ease-in'
              : 'background-color 100ms ease-out, border-color 100ms ease-out, box-shadow 100ms ease-out',
          }}
          aria-hidden
        >
          <span
            className={isScrolling ? 'opacity-0' : 'opacity-100'}
            style={{
              transition: isScrolling ? 'opacity 140ms ease-in' : 'opacity 100ms ease-out',
            }}
          >
            {pad2(activeValue)}
          </span>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-base-100 via-base-100/85 to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-base-100 via-base-100/85 to-transparent"
          aria-hidden
        />
        <div
          ref={scrollRef}
          className="wheel-time-picker-scroll relative z-0 h-full w-full overflow-y-auto overscroll-contain"
          onScroll={handleScroll}
        >
          <div style={{ height: WHEEL_PAD }} aria-hidden />
          {items.map((item, index) => {
            const visual = getItemVisualStyle(index, scrollTop);
            const isNearCenter = visual.opacity > 0.88;
            return (
              <div
                key={item}
                className={`mx-1 flex h-11 shrink-0 snap-center items-center justify-center rounded-lg text-lg font-semibold tabular-nums will-change-transform ${
                  isNearCenter ? 'text-gray-800' : 'text-gray-400'
                }`}
                style={{
                  opacity: visual.opacity,
                  transform: visual.transform,
                  transition: 'opacity 200ms ease, transform 200ms ease, color 200ms ease',
                }}
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
}

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
  showSummary = true,
  className = '',
}) => {
  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);
  const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hours = useMemo(() => {
    const list: number[] = [];
    for (let h = minHour; h <= maxHour; h += 1) list.push(h);
    return list;
  }, [minHour, maxHour]);

  const normalizedValue = normalizeTime(value);
  const parsedHour = normalizedValue ? Number(normalizedValue.split(':')[0]) : null;
  const parsedMinute = normalizedValue ? Number(normalizedValue.split(':')[1]) : null;

  const selectedHour =
    parsedHour != null && hours.includes(parsedHour) ? parsedHour : hours[0] ?? minHour;
  const selectedMinute =
    parsedMinute != null && parsedMinute >= 0 && parsedMinute <= 59 ? parsedMinute : 0;

  const [liveHour, setLiveHour] = useState(selectedHour);
  const [liveMinute, setLiveMinute] = useState(selectedMinute);

  useEffect(() => {
    setLiveHour(selectedHour);
    setLiveMinute(selectedMinute);
  }, [selectedHour, selectedMinute]);

  const emitChange = useCallback(() => {
    const hour = readCenteredValue(hourScrollRef.current, hours);
    const minute = readCenteredValue(minuteScrollRef.current, ALL_MINUTES);
    const next = `${pad2(hour)}:${pad2(minute)}`;
    if (next !== normalizeTime(value)) onChange(next);
  }, [hours, onChange, value]);

  const handleSettled = useCallback(() => {
    if (changeTimer.current) clearTimeout(changeTimer.current);
    changeTimer.current = setTimeout(() => emitChange(), 40);
  }, [emitChange]);

  useEffect(
    () => () => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (loading || unavailable || disabled || hours.length === 0) return;
    if (!normalizeTime(value)) onChange(`${pad2(hours[0])}:${pad2(0)}`);
  }, [loading, unavailable, disabled, hours, value, onChange]);

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

  if (unavailable || hours.length === 0) {
    return (
      <div className={className}>
        {label ? <label className={labelClassName}>{label}</label> : null}
        <p className="mt-2 text-sm text-base-content/45">{emptyMessage}</p>
      </div>
    );
  }

  const displayTime = `${pad2(liveHour)}:${pad2(liveMinute)}`;

  return (
    <div className={className}>
      {label ? <label className={labelClassName}>{label}</label> : null}
      <div className={disabled ? 'pointer-events-none opacity-50' : ''}>
        <div className="relative mx-auto max-w-xs">
          <div className="flex items-stretch justify-center gap-1 sm:gap-2">
            <WheelColumn
              label="Hour"
              items={hours}
              selected={selectedHour}
              activeValue={liveHour}
              scrollRef={hourScrollRef}
              onActiveChange={setLiveHour}
              onSettled={handleSettled}
            />
            <div
              className="flex shrink-0 items-center self-center text-2xl font-bold text-base-content/25"
              style={{ paddingTop: 18, height: WHEEL_HEIGHT + 18 }}
            >
              :
            </div>
            <WheelColumn
              label="Min"
              items={ALL_MINUTES}
              selected={selectedMinute}
              activeValue={liveMinute}
              scrollRef={minuteScrollRef}
              onActiveChange={setLiveMinute}
              onSettled={handleSettled}
            />
          </div>
        </div>

        {showSummary ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-gray-800">
            <ClockIcon className="h-4 w-4 text-primary" aria-hidden />
            <span className="tabular-nums">{displayTime}</span>
            <span className="text-base-content/45">({formatDisplay12h(displayTime)})</span>
          </div>
        ) : null}
      </div>

      <style>{`
        .wheel-time-picker-scroll {
          scroll-snap-type: y proximity;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .wheel-time-picker-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
};

export default WheelTimePicker;
