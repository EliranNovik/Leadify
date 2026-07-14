import React, { useEffect, useMemo, useRef, useState } from 'react';
import { encode } from 'uqr';

type MorphingQrCodeProps = {
  value: string;
  size: number;
  maxWidth?: string;
  fgColor?: string;
  bgColor?: string;
  className?: string;
};

function encodeModules(value: string): boolean[][] {
  const result = encode(value, { ecc: 'M', border: 0 });
  return result.data.map((row) => row.slice());
}

function cloneModules(modules: boolean[][]): boolean[][] {
  return modules.map((row) => row.slice());
}

function shuffleInPlace<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j]!;
    items[j] = tmp!;
  }
}

/**
 * QR that morphs dark modules in place when the value changes —
 * no white flash between codes.
 */
const MorphingQrCode: React.FC<MorphingQrCodeProps> = ({
  value,
  size,
  maxWidth,
  fgColor = '#0f172a',
  bgColor = '#ffffff',
  className,
}) => {
  const [modules, setModules] = useState(() => encodeModules(value));
  const modulesRef = useRef(modules);
  const morphTimersRef = useRef<number[]>([]);

  useEffect(() => {
    modulesRef.current = modules;
  }, [modules]);

  useEffect(() => {
    const target = encodeModules(value);
    const current = modulesRef.current;

    morphTimersRef.current.forEach((id) => window.clearTimeout(id));
    morphTimersRef.current = [];

    if (!current.length || current.length !== target.length) {
      setModules(target);
      return;
    }

    const flips: Array<{ r: number; c: number; next: boolean }> = [];
    for (let r = 0; r < target.length; r += 1) {
      const row = target[r]!;
      const curRow = current[r]!;
      if (row.length !== curRow.length) {
        setModules(target);
        return;
      }
      for (let c = 0; c < row.length; c += 1) {
        if (curRow[c] !== row[c]) {
          flips.push({ r, c, next: row[c]! });
        }
      }
    }

    if (flips.length === 0) return;

    shuffleInPlace(flips);

    const durationMs = 320;
    const steps = Math.min(14, Math.max(6, Math.ceil(flips.length / 18)));
    const batchSize = Math.ceil(flips.length / steps);
    let working = cloneModules(current);

    for (let step = 0; step < steps; step += 1) {
      const start = step * batchSize;
      const batch = flips.slice(start, start + batchSize);
      working = cloneModules(working);
      for (const flip of batch) {
        working[flip.r]![flip.c] = flip.next;
      }
      const snapshot = cloneModules(working);
      const delay = Math.round(((step + 1) / steps) * durationMs);
      const timer = window.setTimeout(() => {
        modulesRef.current = snapshot;
        setModules(snapshot);
      }, delay);
      morphTimersRef.current.push(timer);
    }

    const settle = window.setTimeout(() => {
      modulesRef.current = target;
      setModules(target);
    }, durationMs + 40);
    morphTimersRef.current.push(settle);

    return () => {
      morphTimersRef.current.forEach((id) => window.clearTimeout(id));
      morphTimersRef.current = [];
    };
  }, [value]);

  const n = modules.length || 1;
  const path = useMemo(() => {
    let d = '';
    for (let r = 0; r < modules.length; r += 1) {
      const row = modules[r]!;
      for (let c = 0; c < row.length; c += 1) {
        if (row[c]) d += `M${c} ${r}h1v1h-1z`;
      }
    }
    return d;
  }, [modules]);

  return (
    <svg
      role="img"
      aria-label="Clock-in QR code"
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={className}
      style={{ maxWidth, height: 'auto', display: 'block' }}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill={bgColor} />
      <path fill={fgColor} d={path} />
    </svg>
  );
};

export default MorphingQrCode;
