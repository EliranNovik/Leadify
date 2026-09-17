import React from 'react';
import { Link } from 'react-router-dom';

type CheckoutSessionExpiredCardProps = {
  onRetry?: () => void;
  retryHref?: string;
};

export default function CheckoutSessionExpiredCard({
  onRetry,
  retryHref,
}: CheckoutSessionExpiredCardProps) {
  const retryClassName =
    'inline-flex items-center justify-center rounded-full bg-[#3b28c7] px-10 py-3.5 text-lg font-semibold text-white shadow-sm transition-transform duration-200 hover:scale-105 hover:bg-[#3222b0] active:scale-[0.99]';

  return (
    <div className="text-center">
      <img
        src="/payment/checkout-session-expired-icon.png"
        alt=""
        className="mx-auto mb-1.5 h-44 w-44 object-contain sm:h-48 sm:w-48"
        draggable={false}
      />
      <h2 className="-mt-1 text-[1.75rem] font-semibold tracking-tight text-gray-900 sm:text-[1.875rem]">
        Session expired
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
        This checkout expired for security reasons.
      </p>
      {retryHref ? (
        <Link to={retryHref} className={`${retryClassName} mt-7`}>
          Try again
        </Link>
      ) : onRetry ? (
        <button type="button" className={`${retryClassName} mt-7`} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
