import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type RMQVirtualMessageListProps<T extends { id: number }> = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messages: T[];
  /** When false, render nothing (e.g. hidden layout breakpoint). */
  enabled: boolean;
  row: (message: T, index: number) => React.ReactNode;
};

/**
 * Virtualized message list for long RMQ threads. Parent owns scroll container ref.
 * Not wired into RMQMessagesPage yet — message rows are still inline; use after extracting a shared row renderer.
 */
export function RMQVirtualMessageList<T extends { id: number }>({
  scrollRef,
  messages,
  enabled,
  row,
}: RMQVirtualMessageListProps<T>) {
  const virtualizer = useVirtualizer({
    enabled,
    count: enabled ? messages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  if (!enabled || messages.length === 0) {
    return null;
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {items.map((vi) => {
        const message = messages[vi.index];
        if (!message) return null;
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${vi.start}px)` }}
          >
            {row(message, vi.index)}
          </div>
        );
      })}
    </div>
  );
}
