import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';

type Props = {
  href: string | null;
  label?: string;
  className?: string;
};

const ProformaBackToLeadButton: React.FC<Props> = ({
  href,
  label = 'Back to lead',
  className = '',
}) => {
  if (!href) return null;

  return (
    <Link
      to={href}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'bg-transparent text-slate-900 no-underline transition',
        'hover:bg-slate-900/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={label}
      aria-label={label}
    >
      <ChevronLeftIcon className="h-7 w-7 shrink-0 stroke-[2.5]" aria-hidden />
    </Link>
  );
};

export default ProformaBackToLeadButton;
