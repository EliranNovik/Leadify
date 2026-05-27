import React, { useEffect, useState } from 'react';

type VoiceSpeakingBarsProps = {
  active: boolean;
  level?: number;
  className?: string;
};

const BAR_COUNT = 5;
const BAR_DELAYS = [0, 0.12, 0.24, 0.12, 0];

const VoiceSpeakingBars: React.FC<VoiceSpeakingBarsProps> = ({
  active,
  level = 0,
  className = '',
}) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    const loop = () => {
      setTick((prev) => prev + 1);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  const clampedLevel = Math.max(0, Math.min(1, level));

  return (
    <div
      className={`inline-flex items-end gap-0.5 h-5 ${className}`}
      aria-hidden="true"
      role="presentation"
    >
      {Array.from({ length: BAR_COUNT }).map((_, index) => {
        const wave = Math.sin(tick * 0.18 + index * 1.2);
        const pulse = 0.35 + clampedLevel * 0.65;
        const height = 4 + Math.round((0.45 + pulse * 0.55) * (0.55 + Math.abs(wave) * 0.45) * 16);
        return (
          <span
            key={index}
            className="w-1 rounded-full bg-red-500 transition-[height] duration-75 ease-out"
            style={{
              height: `${height}px`,
              animationDelay: `${BAR_DELAYS[index]}s`,
              opacity: 0.55 + clampedLevel * 0.45,
            }}
          />
        );
      })}
    </div>
  );
};

export default VoiceSpeakingBars;
