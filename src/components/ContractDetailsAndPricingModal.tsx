import React from 'react';
import { PlusIcon, MinusIcon } from '@heroicons/react/24/solid';

interface ContractDetailsAndPricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract: any;
  customPricing: any;
  setCustomPricing: (pricing: any) => void;
  template: any;
  status: string;
  currencyType: 'USD' | 'NIS';
  setCurrencyType: (type: 'USD' | 'NIS') => void;
  subCurrency: 'USD' | 'GBP' | 'EUR';
  setSubCurrency: (currency: 'USD' | 'GBP' | 'EUR') => void;
  vatIncluded: boolean;
  setVatIncluded: (included: boolean) => void;
  handleApplicantCountChange: (count: number) => void;
  handleTierPriceChange: (tierKey: string, price: number) => void;
  handlePaymentPlanChange: (idx: number, field: string, value: any) => void;
  handleDeletePaymentRow: (idx: number) => void;
  handleAddPaymentRow: () => void;
  handleSaveCustomPricing: () => void;
  handleDeleteContract: () => void;
  isSaving: boolean;
  discountOptions: number[];
  updateCustomPricing: (updates: any) => void;
}

const ContractDetailsAndPricingModal: React.FC<ContractDetailsAndPricingModalProps> = ({
  isOpen,
  onClose,
  contract,
  customPricing,
  setCustomPricing,
  template,
  status,
  currencyType,
  setCurrencyType,
  subCurrency,
  setSubCurrency,
  vatIncluded,
  setVatIncluded,
  handleApplicantCountChange,
  handleTierPriceChange,
  handlePaymentPlanChange,
  handleDeletePaymentRow,
  handleAddPaymentRow,
  handleSaveCustomPricing,
  handleDeleteContract,
  isSaving,
  discountOptions,
  updateCustomPricing,
}) => {
  if (!isOpen) return null;

  const getCurrentTierKey = (count: number) => {
    if (count === 1) return '1';
    if (count === 2) return '2';
    if (count === 3) return '3';
    if (count >= 4 && count <= 7) return '4-7';
    if (count >= 8 && count <= 9) return '8-9';
    if (count >= 10 && count <= 15) return '10-15';
    return '16+';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-bold text-gray-900">Pricing & Payment Plan</h2>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle"
          >
            ✕
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-6">
          {/* Pricing & Payment Plan Section */}
          <div className="space-y-6">
            
            <>
                  {/* Currency Selection */}
                  {status !== 'signed' && (
                    <div className="space-y-3 pb-4 border-b border-gray-200">
                      <label className="font-medium text-gray-700">Currency Type:</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={`btn btn-sm flex-1 ${currencyType === 'USD' ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => {
                            setCurrencyType('USD');
                            setVatIncluded(false);
                            if (template?.default_pricing_tiers_usd) {
                              const pricingTiers = template.default_pricing_tiers_usd;
                              const currentTierKey = customPricing?.applicant_count 
                                ? getCurrentTierKey(customPricing.applicant_count)
                                : '1';
                              const currentPricePerApplicant = pricingTiers[currentTierKey] || 0;
                              const total = currentPricePerApplicant * (customPricing?.applicant_count || 1);
                              setCustomPricing((prev: any) => ({
                                ...prev,
                                pricing_tiers: pricingTiers,
                                currency: subCurrency === 'EUR' ? '€' : subCurrency === 'GBP' ? '£' : '$',
                                total_amount: total,
                                final_amount: total - (prev.discount_amount || 0)
                              }));
                            }
                          }}
                        >
                          USD/GBP/EUR
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm flex-1 ${currencyType === 'NIS' ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => {
                            setCurrencyType('NIS');
                            setVatIncluded(true);
                            if (template?.default_pricing_tiers_nis) {
                              const pricingTiers = template.default_pricing_tiers_nis;
                              const currentTierKey = customPricing?.applicant_count 
                                ? getCurrentTierKey(customPricing.applicant_count)
                                : '1';
                              const currentPricePerApplicant = pricingTiers[currentTierKey] || 0;
                              const total = currentPricePerApplicant * (customPricing?.applicant_count || 1);
                              setCustomPricing((prev: any) => ({
                                ...prev,
                                pricing_tiers: pricingTiers,
                                currency: '₪',
                                total_amount: total,
                                final_amount: total - (prev.discount_amount || 0)
                              }));
                            }
                          }}
                        >
                          NIS
                        </button>
                      </div>
                      
                      {currencyType === 'USD' && (
                        <div>
                          <label className="font-medium text-gray-700 text-sm mb-2 block">Select Currency:</label>
                          <select
                            className="select select-bordered select-sm w-full"
                            value={subCurrency}
                            onChange={(e) => {
                              const newSubCurrency = e.target.value as 'USD' | 'GBP' | 'EUR';
                              setSubCurrency(newSubCurrency);
                              const currencySymbol = newSubCurrency === 'EUR' ? '€' : newSubCurrency === 'GBP' ? '£' : '$';
                              setCustomPricing((prev: any) => ({
                                ...prev,
                                currency: currencySymbol
                              }));
                            }}
                          >
                            <option value="USD">USD ($)</option>
                            <option value="GBP">GBP (£)</option>
                            <option value="EUR">EUR (€)</option>
                          </select>
                        </div>
                      )}
                      
                      {(currencyType === 'NIS' || (currencyType === 'USD' && customPricing?.currency === '₪')) && (
                        <div className="mt-3">
                          <label className="font-medium text-gray-700 text-sm mb-2 block">VAT:</label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className={`btn btn-sm flex-1 ${vatIncluded ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => {
                                setVatIncluded(true);
                                const total = customPricing?.total_amount || 0;
                                const discountAmount = customPricing?.discount_amount || 0;
                                const archivalFee = customPricing?.archival_research_fee || 0;
                                const baseTotal = total + archivalFee;
                                const discountedBaseTotal = baseTotal - discountAmount;
                                
                                let paymentPlan = customPricing?.payment_plan || [];
                                if (paymentPlan.length > 0) {
                                  const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
                                  paymentPlan = paymentPlan.map((row: any) => {
                                    const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
                                    const vatForThisPercent = Math.round((baseValueForThisPercent * 0.18 * 100) / 100);
                                    return {
                                      ...row,
                                      value: `${baseValueForThisPercent} + ${vatForThisPercent}`,
                                    };
                                  });
                                }
                                
                                setCustomPricing((prev: any) => ({
                                  ...prev,
                                  payment_plan: paymentPlan
                                }));
                              }}
                            >
                              Included
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm flex-1 ${!vatIncluded ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => {
                                setVatIncluded(false);
                                const total = customPricing?.total_amount || 0;
                                const discountAmount = customPricing?.discount_amount || 0;
                                const archivalFee = customPricing?.archival_research_fee || 0;
                                const baseTotal = total + archivalFee;
                                const discountedBaseTotal = baseTotal - discountAmount;
                                
                                let paymentPlan = customPricing?.payment_plan || [];
                                if (paymentPlan.length > 0) {
                                  const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
                                  paymentPlan = paymentPlan.map((row: any) => {
                                    const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
                                    return {
                                      ...row,
                                      value: baseValueForThisPercent.toString(),
                                    };
                                  });
                                }
                                
                                setCustomPricing((prev: any) => ({
                                  ...prev,
                                  payment_plan: paymentPlan
                                }));
                              }}
                            >
                              Excluded
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {customPricing ? (
                    <>
                      {/* Applicant Count */}
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-gray-700">Number of Applicants:</label>
                        <div className="flex items-center gap-3">
                          <button
                            className="btn btn-circle btn-md bg-gray-200 border-none flex items-center justify-center"
                            style={{ width: 40, height: 40 }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#391BC8'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                            onClick={() => handleApplicantCountChange(Math.max(1, (customPricing.applicant_count || 1) - 1))}
                            aria-label="Decrease number of applicants"
                            type="button"
                            disabled={status === 'signed'}
                          >
                            <MinusIcon className="w-6 h-6" style={{ color: '#391BC8' }} />
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            className="input input-bordered input-lg w-28 text-center bg-white text-lg font-bold px-4 py-2 rounded-xl border-2 no-arrows"
                            style={{ height: 48, borderColor: '#391BC8' }}
                            value={customPricing.applicant_count || 1}
                            onChange={e => handleApplicantCountChange(Number(e.target.value))}
                            onFocus={(e) => e.target.style.borderColor = '#391BC8'}
                            onBlur={(e) => e.target.style.borderColor = '#391BC8'}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={status === 'signed'}
                          />
                          <button
                            className="btn btn-circle btn-md bg-gray-200 border-none flex items-center justify-center"
                            style={{ width: 40, height: 40 }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#391BC8'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                            onClick={() => handleApplicantCountChange(Math.min(50, (customPricing.applicant_count || 1) + 1))}
                            aria-label="Increase number of applicants"
                            type="button"
                            disabled={status === 'signed'}
                          >
                            <PlusIcon className="w-6 h-6" style={{ color: '#391BC8' }} />
                          </button>
                        </div>
                      </div>

                      {/* Pricing Tiers */}
                      <div>
                        <label className="block font-medium text-gray-700 mb-3">Pricing Tiers (Price per applicant):</label>
                        <div className="space-y-2">
                          {customPricing.pricing_tiers ? (() => {
                            const tierStructure = [
                              { key: '1', label: 'For one applicant' },
                              { key: '2', label: 'For 2 applicants' },
                              { key: '3', label: 'For 3 applicants' },
                              { key: '4-7', label: 'For 4-7 applicants' },
                              { key: '8-9', label: 'For 8-9 applicants' },
                              { key: '10-15', label: 'For 10-15 applicants' },
                              { key: '16+', label: 'For 16 applicants or more' }
                            ];

                            const currentTierKey = getCurrentTierKey(customPricing.applicant_count);

                            return tierStructure.map(tier => {
                              const price = customPricing.pricing_tiers[tier.key] || 0;
                              const isActive = tier.key === currentTierKey;
                              return (
                                <div key={tier.key} className={`flex items-center justify-between p-2 rounded-lg ${isActive
                                    ? 'bg-white border-2'
                                    : 'bg-white border border-gray-200'
                                  }`}
                                  style={isActive ? { borderColor: '#391BC8', backgroundColor: 'rgba(57, 27, 200, 0.05)' } : {}}
                                >
                                  <span className="text-base font-semibold text-gray-700">
                                    {tier.label}:
                                  </span>
                                  <div className="flex items-center gap-3">
                                    <button
                                      className="btn btn-circle btn-md bg-gray-200 border-none flex items-center justify-center"
                                      style={{ width: 40, height: 40 }}
                                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#391BC8'}
                                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                                      onClick={() => handleTierPriceChange(tier.key, Math.max(0, price - 100))}
                                      aria-label={`Decrease price for ${tier.label}`}
                                      type="button"
                                      disabled={status === 'signed'}
                                    >
                                      <MinusIcon className="w-6 h-6" style={{ color: '#391BC8' }} />
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      className="input input-bordered input-lg w-36 text-right bg-white text-lg font-bold px-4 py-2 rounded-xl border-2 no-arrows"
                                      style={{ height: 48, borderColor: '#391BC8' }}
                                      value={price}
                                      onChange={e => handleTierPriceChange(tier.key, Number(e.target.value))}
                                      onFocus={(e) => e.target.style.borderColor = '#391BC8'}
                                      onBlur={(e) => e.target.style.borderColor = '#391BC8'}
                                      disabled={status === 'signed'}
                                    />
                                    <button
                                      className="btn btn-circle btn-md bg-gray-200 border-none flex items-center justify-center"
                                      style={{ width: 40, height: 40 }}
                                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#391BC8'}
                                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                                      onClick={() => handleTierPriceChange(tier.key, price + 100)}
                                      aria-label={`Increase price for ${tier.label}`}
                                      type="button"
                                      disabled={status === 'signed'}
                                    >
                                      <PlusIcon className="w-6 h-6" style={{ color: '#391BC8' }} />
                                    </button>
                                    <span className="text-base font-semibold text-gray-600">{customPricing.currency}</span>
                                  </div>
                                </div>
                              );
                            });
                          })() : (
                            <div className="text-gray-500 text-sm p-4 text-center">
                              Loading pricing tiers...
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Discount */}
                      <div className="flex items-center justify-between">
                        <label className="font-medium text-gray-700">Discount:</label>
                        <select
                          className="select select-bordered select-md w-24 text-right bg-white"
                          value={customPricing.discount_percentage}
                          onChange={e => {
                            const discount = Number(e.target.value);
                            const currentTierKey = getCurrentTierKey(customPricing.applicant_count);
                            const currentTierPrice = customPricing.pricing_tiers?.[currentTierKey] || 0;
                            const total = currentTierPrice * (customPricing.applicant_count || 1);
                            const discountAmount = Math.round(total * (discount / 100));
                            const finalAmount = total - discountAmount;

                            const archivalFee = customPricing?.archival_research_fee || 0;
                            const baseTotal = total + archivalFee;
                            const isIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
                            const discountedBaseTotal = baseTotal - discountAmount;
                            const vatAmount = isIsraeli ? Math.round(discountedBaseTotal * 0.18 * 100) / 100 : 0;

                            let paymentPlan = customPricing.payment_plan || [];
                            if (paymentPlan.length > 0) {
                              const totalPercent = paymentPlan.reduce((sum: number, row: any) => sum + Number(row.percent), 0) || 1;
                              paymentPlan = paymentPlan.map((row: any) => {
                                const baseValueForThisPercent = Math.round((discountedBaseTotal * Number(row.percent)) / totalPercent);
                                const vatForThisPercent = isIsraeli ? Math.round((baseValueForThisPercent * 0.18 * 100) / 100) : 0;
                                return {
                                  ...row,
                                  value: (vatIncluded && isIsraeli && vatForThisPercent > 0) ? `${baseValueForThisPercent} + ${vatForThisPercent}` : baseValueForThisPercent.toString(),
                                };
                              });
                            }

                            updateCustomPricing({
                              discount_percentage: discount,
                              discount_amount: discountAmount,
                              final_amount: finalAmount,
                              payment_plan: paymentPlan,
                            });
                          }}
                          disabled={status === 'signed'}
                        >
                          {discountOptions.map(opt => (
                            <option key={opt} value={opt}>{opt}%</option>
                          ))}
                        </select>
                      </div>

                      {/* Totals */}
                      {(() => {
                        const desktopIsIsraeli = contract?.client_country === '₪' || customPricing?.currency === '₪';
                        const desktopArchivalFee = customPricing?.archival_research_fee || 0;
                        const desktopBaseTotal = (customPricing?.total_amount || 0) + desktopArchivalFee;
                        const desktopDiscountAmount = customPricing?.discount_amount || 0;
                        const desktopDiscountedBaseTotal = desktopBaseTotal - desktopDiscountAmount;
                        const desktopVatAmount = desktopIsIsraeli ? Math.round(desktopDiscountedBaseTotal * 0.18 * 100) / 100 : 0;
                        const desktopFinalAmountWithVat = vatIncluded && desktopIsIsraeli ? desktopDiscountedBaseTotal + desktopVatAmount : desktopDiscountedBaseTotal;
                        const desktopFinalAmountWithoutVat = desktopDiscountedBaseTotal;
                        
                        return (
                          <div className="space-y-2 pt-3 border-t border-gray-200">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Total:</span>
                              <span className="font-semibold text-gray-900">{customPricing.currency} {(customPricing.total_amount || 0).toLocaleString()}</span>
                            </div>
                            {customPricing?.archival_research_fee && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">Archival Research:</span>
                                <span className="font-semibold text-gray-900">{customPricing.currency} {customPricing.archival_research_fee.toLocaleString()}</span>
                              </div>
                            )}
                            {desktopIsIsraeli && (
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">VAT (18%):</span>
                                <span className="font-semibold text-gray-900">{customPricing.currency} {desktopVatAmount.toLocaleString()}</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <span className="text-gray-600">Discount:</span>
                              <span className="font-semibold text-gray-900">{customPricing.currency} {desktopDiscountAmount.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900">Final Amount:</span>
                              <span className="font-bold text-lg" style={{ color: '#391BC8' }}>
                                {customPricing.currency} {(vatIncluded && desktopIsIsraeli ? desktopFinalAmountWithVat : desktopFinalAmountWithoutVat).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Payment Plan Editor */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Payment Plan</h4>
                        {(() => {
                          const totalPercent = (customPricing.payment_plan || []).reduce((sum: number, row: any) => sum + Number(row.percent), 0);
                          if (totalPercent < 100) {
                            return (
                              <div className="flex items-center gap-3 p-4 mb-3 rounded-xl shadow-lg bg-gradient-to-tr from-pink-500 via-purple-500 to-purple-600 text-white">
                                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <span className="font-medium">Payment plan total is {totalPercent}%. Please ensure the total equals 100%.</span>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        <div className="space-y-3">
                          {(customPricing.payment_plan || []).map((row: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-3 bg-white p-4 rounded-lg border border-gray-200">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                className="input input-bordered w-24 text-center bg-white text-xl font-bold px-4 py-3 rounded-xl border-2 no-arrows"
                                style={{ borderColor: '#391BC8' }}
                                value={row.percent === 0 ? '' : row.percent}
                                onChange={e => {
                                  const value = e.target.value;
                                  const numValue = value === '' ? 0 : Number(value);
                                  handlePaymentPlanChange(idx, 'percent', numValue);
                                }}
                                onFocus={(e) => e.target.style.borderColor = '#391BC8'}
                                onBlur={(e) => e.target.style.borderColor = '#391BC8'}
                                placeholder="%"
                                disabled={status === 'signed'}
                              />
                              <span className="text-lg font-semibold text-gray-700">%</span>
                              <span className="text-lg font-semibold text-gray-700">=</span>
                              <input
                                type="text"
                                className="input input-bordered w-40 text-center bg-white text-xl font-bold px-4 py-3 rounded-xl border-2"
                                style={{ borderColor: '#391BC8' }}
                                value={row.value}
                                onChange={e => handlePaymentPlanChange(idx, 'value', e.target.value)}
                                onFocus={(e) => e.target.style.borderColor = '#391BC8'}
                                onBlur={(e) => e.target.style.borderColor = '#391BC8'}
                                placeholder="Value + VAT"
                                disabled={status === 'signed'}
                              />
                              <span className="text-lg font-semibold text-gray-700">{customPricing.currency}</span>
                              <button
                                className="btn btn-circle btn-ghost text-red-500 hover:bg-red-100 text-xl font-bold w-10 h-10"
                                onClick={() => handleDeletePaymentRow(idx)}
                                disabled={status === 'signed'}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button className="btn btn-outline btn-sm w-full" onClick={handleAddPaymentRow} disabled={status === 'signed'}>
                            + Add Payment
                          </button>
                        </div>
                      </div>
                      
                      {/* Save Button */}
                      {status !== 'signed' && (
                        <button
                          className="btn btn-primary btn-block mt-4"
                          onClick={handleSaveCustomPricing}
                          disabled={isSaving}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                      )}
                      
                      {/* Delete Contract Button */}
                      {status === 'signed' && (
                        <button
                          className="btn btn-error btn-block mt-4"
                          onClick={handleDeleteContract}
                        >
                          Delete Contract
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500">Loading pricing data...</div>
                  )}
            </>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContractDetailsAndPricingModal;
