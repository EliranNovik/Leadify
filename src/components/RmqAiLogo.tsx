import React from 'react';

export const RMQ_AI_LOGO_SRC = '/rmq-ai-logo.png';
export const RMQ_AI_HEADER_LOGO_SRC = '/rmq-ai-header-logo.png';

export function RmqAiLogo({
  className = '',
  alt = 'RMQ AI',
  src = RMQ_AI_LOGO_SRC,
}: {
  className?: string;
  alt?: string;
  src?: string;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={`inline-block shrink-0 object-contain ${className}`.trim()}
    />
  );
}

export default RmqAiLogo;
