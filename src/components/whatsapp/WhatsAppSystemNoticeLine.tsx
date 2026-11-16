export function WhatsAppSystemNoticeLine({ text }: { text: string }) {
  return (
    <div className="my-2 flex w-full justify-center px-4">
      <p className="max-w-md rounded-lg bg-amber-50 px-3 py-1.5 text-center text-xs leading-snug text-amber-950">
        {text}
      </p>
    </div>
  );
}
