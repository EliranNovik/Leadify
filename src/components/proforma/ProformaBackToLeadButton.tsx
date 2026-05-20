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
        'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-900 px-3 py-1.5',
        'text-xs font-semibold text-white no-underline transition-colors',
        'hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={label}
    >
      <ChevronLeftIcon className="h-4 w-4 shrink-0 stroke-[2]" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
};

export default ProformaBackToLeadButton;
