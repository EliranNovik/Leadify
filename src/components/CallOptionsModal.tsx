import React, { useState, useEffect } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface CallOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  phoneNumber: string;
  leadName?: string;
}

const CallOptionsModal: React.FC<CallOptionsModalProps> = ({
  isOpen,
  onClose,
  phoneNumber,
  leadName
}) => {
  const [onecomCode, setOnecomCode] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOnecomCode = async () => {
      if (!isOpen) return;

      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user?.email) {
          setLoading(false);
          return;
        }

        // Fetch user's employee data with onecom_code
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select(`
            id,
            email,
            employee_id,
            tenants_employee!employee_id(
              id,
              onecom_code
            )
          `)
          .eq('email', user.email)
          .single();

        if (!userError && userData?.tenants_employee) {
          const empData = Array.isArray(userData.tenants_employee)
            ? userData.tenants_employee[0]
            : userData.tenants_employee;

          if (empData?.onecom_code) {
            setOnecomCode(empData.onecom_code);
          }
        }
      } catch (error) {
        console.error('Error fetching onecom_code:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchOnecomCode();
  }, [isOpen]);

  const formatPhoneNumber = (phone: string, useOnecomCode: boolean): string => {
    if (!phone) return '';

    // Normalize phone: remove spaces, dashes, parentheses
    const normalized = phone.replace(/[\s\-\(\)]/g, '');

    // If phone already starts with +, extract country code and number
    if (normalized.startsWith('+')) {
      // Find where country code ends (usually 1-3 digits after +)
      // Common patterns: +1 (US/Canada), +44 (UK), +972 (Israel), +33 (France), +49 (Germany), etc.
      let countryCodeEnd = 1;

      // Check for known 3-digit country codes first
      if (normalized.length > 4) {
        const threeDigit = normalized.substring(1, 4);
        // Common 3-digit country codes: 972 (Israel), 351 (Portugal), 353 (Ireland), etc.
        if (/^97[0-9]$/.test(threeDigit) || /^35[0-9]$/.test(threeDigit) || /^90[0-9]$/.test(threeDigit)) {
          countryCodeEnd = 4; // +XXX
        }
      }

      // Check for 2-digit country codes
      if (countryCodeEnd === 1 && normalized.length > 3) {
        const twoDigit = normalized.substring(1, 3);
        // Common 2-digit country codes: 44 (UK), 61 (Australia), 27 (South Africa), 33 (France), 49 (Germany), 39 (Italy), etc.
        if (/^[2-9][0-9]$/.test(twoDigit)) {
          countryCodeEnd = 3; // +XX
        }
      }

      // US/Canada: +1
      if (normalized.startsWith('+1') && normalized.length > 2) {
        countryCodeEnd = 2; // +1
      }

      // Extract country code digits (without the +)
      const countryCodeDigits = normalized.substring(1, countryCodeEnd + 1);
      const restOfNumber = normalized.substring(countryCodeEnd + 1);

      // Convert country code to 00 format (e.g., +1 -> 001, +44 -> 0044, +972 -> 00972)
      const countryCodeWith00 = `00${countryCodeDigits}`;

      if (useOnecomCode && onecomCode) {
        // Place onecom_code BEFORE the country code
        return `${onecomCode}${countryCodeWith00}${restOfNumber}`;
      }
      // If not using onecom_code, convert + to 00 format
      return `${countryCodeWith00}${restOfNumber}`;
    }

    // If phone doesn't start with +, assume it's a local number
    // In this case, we can't reliably add onecom_code without country code
    return phone;
  };

  const handleCall = (useOnecomCode: boolean) => {
    const formattedNumber = formatPhoneNumber(phoneNumber, useOnecomCode);
    window.open(`tel:${formattedNumber}`, '_self');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md mx-4 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold">Call Options</h3>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {leadName && (
          <p className="mb-2 text-sm text-gray-600">
            Calling: <span className="font-semibold">{leadName}</span>
          </p>
        )}

        <p className="mb-4 text-sm text-gray-600">
          Phone: <span className="font-mono">{phoneNumber}</span>
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="loading loading-spinner loading-md"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Option 1: Call without onecom_code */}
            <button
              onClick={() => handleCall(false)}
              className="btn btn-outline btn-primary w-full justify-start"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call Directly
              <span className="ml-auto text-xs text-gray-500 font-mono">
                {formatPhoneNumber(phoneNumber, false)}
              </span>
            </button>

            {/* Option 2: Call with onecom_code */}
            {onecomCode ? (
              <button
                onClick={() => handleCall(true)}
                className="btn btn-primary w-full justify-start"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call with OneCom Code ({onecomCode})
                <span className="ml-auto text-xs text-white/80">
                  {formatPhoneNumber(phoneNumber, true)}
                </span>
              </button>
            ) : (
              <div className="alert alert-info">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span className="text-sm">No OneCom code found for your account</span>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CallOptionsModal;

