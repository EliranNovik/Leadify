import React from 'react';
import {
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  BookmarkIcon,
  ChatBubbleLeftEllipsisIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import {
  InteractionActionsDropdown,
  type InteractionActionMenuItem,
} from './InteractionActionsDropdown';

type Props = {
  onReply: () => void;
  onForward: () => void;
  onComment: () => void;
  onDelete: () => void;
  onSave?: () => void;
  isSaved?: boolean;
  className?: string;
};

export function EmailMessageActionsDropdown({
  onReply,
  onForward,
  onComment,
  onDelete,
  onSave,
  isSaved = false,
  className = '',
}: Props) {
  const items: InteractionActionMenuItem[] = [
    {
      key: 'reply',
      label: 'Reply',
      icon: <ArrowUturnLeftIcon className="h-4 w-4" />,
      onClick: onReply,
    },
    {
      key: 'forward',
      label: 'Forward',
      icon: <ArrowUturnRightIcon className="h-4 w-4" />,
      onClick: onForward,
    },
    {
      key: 'comment',
      label: 'Comment',
      icon: <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />,
      onClick: onComment,
    },
  ];

  if (onSave) {
    items.push({
      key: 'save',
      label: isSaved ? 'Remove save' : 'Save',
      icon: isSaved ? (
        <BookmarkIconSolid className="h-4 w-4 text-sky-600" />
      ) : (
        <BookmarkIcon className="h-4 w-4" />
      ),
      onClick: onSave,
    });
  }

  items.push({
    key: 'delete',
    label: 'Delete',
    icon: <TrashIcon className="h-4 w-4" />,
    onClick: onDelete,
    danger: true,
  });

  return <InteractionActionsDropdown items={items} className={className} ariaLabel="Email actions" />;
}
