export default function LeadsManagementIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3.25" y="3.75" width="17.5" height="16.5" rx="3.25" />
      <circle cx="9" cy="9.75" r="1.85" />
      <path d="M6.1 15.35c.45-1.85 1.7-2.75 2.9-2.75s2.45.9 2.9 2.75" />
      <path d="M14.25 9.25h3.75M14.25 12.25h3.75M14.25 15.25h2.25" />
    </svg>
  );
}
