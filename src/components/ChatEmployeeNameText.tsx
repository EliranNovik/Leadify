import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { resolveEmployeePhotoUrl } from '../lib/employeePhotoUrl';
import { getSalaryEmployeeInitials, salaryAvatarGradientStyle } from '../lib/employeeSalaries';
import { ChatLeadNumberText } from './ChatLeadNumberText';

export type ChatEmployeeHit = {
  id: number;
  display_name: string;
  photo_url: string | null;
};

let directoryCache: ChatEmployeeHit[] | null = null;
let directoryLoad: Promise<ChatEmployeeHit[]> | null = null;

export async function loadChatEmployeeDirectory(): Promise<ChatEmployeeHit[]> {
  if (directoryCache) return directoryCache;
  if (!directoryLoad) {
    directoryLoad = (async () => {
      const { data, error } = await supabase
        .from('tenants_employee')
        .select('id, display_name, photo_url, photo')
        .not('display_name', 'is', null)
        .limit(3000);
      if (error) {
        directoryLoad = null;
        return [];
      }
      directoryCache = (data || [])
        .map((row: { id?: unknown; display_name?: unknown; photo_url?: unknown; photo?: unknown }) => ({
          id: Number(row.id),
          display_name: String(row.display_name || '').trim(),
          photo_url: resolveEmployeePhotoUrl(
            row.photo_url != null ? String(row.photo_url) : null,
            row.photo != null ? String(row.photo) : null,
          ),
        }))
        .filter((row) => Number.isFinite(row.id) && row.display_name.length >= 3)
        .sort((a, b) => b.display_name.length - a.display_name.length || a.display_name.localeCompare(b.display_name));
      return directoryCache;
    })();
  }
  return directoryLoad;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ChatEmployeeChip({ employee }: { employee: ChatEmployeeHit; compact?: boolean }) {
  const [imgErr, setImgErr] = useState(false);
  const showPhoto = Boolean(employee.photo_url) && !imgErr;

  return (
    <span className="inline-flex items-center gap-1.5 align-middle mx-0.5">
      {showPhoto ? (
        <img
          src={employee.photo_url || ''}
          alt=""
          className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-black/10"
          onError={() => setImgErr(true)}
        />
      ) : (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-black/10"
          style={salaryAvatarGradientStyle(employee.id, employee.display_name)}
          aria-hidden
        >
          {getSalaryEmployeeInitials(employee.display_name).slice(0, 2)}
        </span>
      )}
      <span>{employee.display_name}</span>
    </span>
  );
}

export function ChatEmployeeNameText({
  text,
  employees,
  onOpen,
  compact,
}: {
  text: string;
  employees: ChatEmployeeHit[];
  onOpen?: () => void;
  compact?: boolean;
}) {
  if (!text) return null;
  if (!employees.length) return <ChatLeadNumberText text={text} onOpen={onOpen} />;

  const usable = employees.filter((row) => row.display_name.length >= 3);
  if (!usable.length) return <ChatLeadNumberText text={text} onOpen={onOpen} />;

  const pattern = usable
    .map((row) => escapeRegExp(row.display_name))
    .join('|');
  const re = new RegExp(`(^|[^A-Za-z0-9\\u0590-\\u05FF])(${pattern})(?=[^A-Za-z0-9\\u0590-\\u05FF]|$)`, 'g');
  const byName = new Map(usable.map((row) => [row.display_name.toLowerCase(), row]));

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    const prefix = match[1] || '';
    const name = match[2] || '';
    const nameStart = match.index + prefix.length;
    if (nameStart > lastIndex) {
      nodes.push(
        <ChatLeadNumberText key={`t-${key++}`} text={text.slice(lastIndex, nameStart)} onOpen={onOpen} />,
      );
    }
    const employee = byName.get(name.toLowerCase());
    if (employee) {
      nodes.push(<ChatEmployeeChip key={`e-${key++}`} employee={employee} compact={compact} />);
    } else {
      nodes.push(<ChatLeadNumberText key={`t-${key++}`} text={name} onOpen={onOpen} />);
    }
    lastIndex = nameStart + name.length;
  }

  if (lastIndex < text.length) {
    nodes.push(<ChatLeadNumberText key={`t-${key++}`} text={text.slice(lastIndex)} onOpen={onOpen} />);
  }

  return nodes.length > 0 ? <>{nodes}</> : <ChatLeadNumberText text={text} onOpen={onOpen} />;
}
