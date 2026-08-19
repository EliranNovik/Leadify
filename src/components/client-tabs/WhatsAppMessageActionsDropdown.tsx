import React from 'react';
import { BookmarkIcon } from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import { InteractionActionsDropdown } from './InteractionActionsDropdown';

type Props = {
  onSave: () => void;
  isSaved?: boolean;
  className?: string;
};

export function WhatsAppMessageActionsDropdown({
  onSave,
  isSaved = false,
  className = '',
}: Props) {
  return (
    <InteractionActionsDropdown
      className={className}
      ariaLabel="WhatsApp actions"
      items={[
        {
          key: 'save',
          label: isSaved ? 'Remove save' : 'Save',
          icon: isSaved ? (
            <BookmarkIconSolid className="h-4 w-4 text-sky-600" />
          ) : (
            <BookmarkIcon className="h-4 w-4" />
          ),
          onClick: onSave,
        },
      ]}
    />
  );
}
