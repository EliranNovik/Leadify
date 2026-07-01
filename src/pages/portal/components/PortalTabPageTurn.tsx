import React, { useEffect, useRef, useState } from 'react';
import type { PortalTabId } from '../portalTabTypes';

const FADE_MS = 180;

type Props = {
  activeTab: PortalTabId;
  tabOrder: readonly PortalTabId[];
  renderTab: (tabId: PortalTabId) => React.ReactNode;
};

const PortalTabPageTurn: React.FC<Props> = ({ activeTab, tabOrder, renderTab }) => {
  void tabOrder;

  const [renderedTab, setRenderedTab] = useState(activeTab);
  const [phase, setPhase] = useState<'idle' | 'out' | 'in'>('idle');
  const skipFirstRef = useRef(true);
  const outTimerRef = useRef<number | null>(null);
  const inTimerRef = useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const clearTimers = () => {
      if (outTimerRef.current != null) {
        window.clearTimeout(outTimerRef.current);
        outTimerRef.current = null;
      }
      if (inTimerRef.current != null) {
        window.clearTimeout(inTimerRef.current);
        inTimerRef.current = null;
      }
    };

    clearTimers();

    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      setRenderedTab(activeTab);
      setPhase('idle');
      return clearTimers;
    }

    if (reduceMotion) {
      setRenderedTab(activeTab);
      setPhase('idle');
      return clearTimers;
    }

    setPhase('out');

    outTimerRef.current = window.setTimeout(() => {
      setRenderedTab(activeTab);
      setPhase('in');

      inTimerRef.current = window.setTimeout(() => {
        setPhase('idle');
        inTimerRef.current = null;
      }, FADE_MS);
      outTimerRef.current = null;
    }, FADE_MS);

    return clearTimers;
  }, [activeTab, reduceMotion]);

  const phaseClass =
    phase === 'out'
      ? 'portal-tab-transition-fade-out'
      : phase === 'in'
        ? 'portal-tab-transition-fade-in'
        : '';

  return (
    <div
      className={`portal-tab-transition-shell w-full ${phaseClass}`}
      aria-live="polite"
    >
      {renderTab(renderedTab)}
    </div>
  );
};

export default PortalTabPageTurn;
