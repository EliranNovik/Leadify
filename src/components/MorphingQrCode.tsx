import React, { useEffect, useMemo, useState } from 'react';
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
  // Small quiet zone for reliable scans while keeping the code close to the frame edge.
  const result = encode(value, { ecc: 'M', border: 1 });
  return result.data.map((row) => row.slice());
}

/**
 * Renders a QR code for the current value.
 * Updates instantly on token rotation (no mid-morph garbage frames that phones can mis-scan).
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

  useEffect(() => {
    setModules(encodeModules(value));
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
