import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import {
  fetchActiveEmployeesForRmqShare,
  shareWhatsAppLeadViaRmq,
  type RmqShareEmployee,
  type WhatsAppShareLeadClient,
} from '../../lib/whatsappShareLeadViaRmq';

type WhatsAppShareLeadRmqModalProps = {
  isOpen: boolean;
  onClose: () => void;
  client: WhatsAppShareLeadClient | null;
  currentUserId: string | null;
};

const WhatsAppShareLeadRmqModal: React.FC<WhatsAppShareLeadRmqModalProps> = ({
  isOpen,
  onClose,
  client,
  currentUserId,
}) => {
  const [employees, setEmployees] = useState<RmqShareEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sendingToId, setSendingToId] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      const list = await fetchActiveEmployeesForRmqShare(currentUserId);
      setEmployees(list);
    } catch {
      toast.error('Failed to load employees');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSendingToId(null);
      return;
    }
    void loadEmployees();
  }, [isOpen, loadEmployees]);

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      const name = (emp.display_name || emp.full_name || '').toLowerCase();
      const email = (emp.email || '').toLowerCase();
      const dept = (emp.department_name || '').toLowerCase();
      return name.includes(q) || email.includes(q) || dept.includes(q);
    });
  }, [employees, searchTerm]);

  const handleSelectEmployee = async (employee: RmqShareEmployee) => {
    if (!currentUserId || !client) return;
    setSendingToId(employee.id);
    try {
      await shareWhatsAppLeadViaRmq({
        senderUserId: currentUserId,
        recipientUserId: employee.id,
        client,
      });
      toast.success(`Shared with ${employee.display_name || employee.full_name}`);
      onClose();
    } catch {
      toast.error('Failed to send RMQ message');
    } finally {
      setSendingToId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="whatsapp-share-rmq-title"
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="min-w-0">
            <h2 id="whatsapp-share-rmq-title" className="text-xl font-semibold text-gray-900">
              Share via RMQ
            </h2>
            {client && (
              <p className="text-sm text-gray-500 truncate mt-0.5">
                {client.name}
                {client.lead_number ? ` · ${client.lead_number}` : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm btn-circle" aria-label="Close">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg text-green-600" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <p className="text-sm">No active employees found</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {filteredEmployees.map((emp) => {
                const label = emp.display_name || emp.full_name;
                const initial = label.charAt(0).toUpperCase();
                const isSending = sendingToId === emp.id;
                return (
                  <li key={emp.id}>
                    <button
                      type="button"
                      disabled={!!sendingToId}
                      onClick={() => void handleSelectEmployee(emp)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
                    >
                      {emp.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0 border border-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-semibold flex-shrink-0">
                          {initial}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{label}</p>
                        {emp.department_name && (
                          <p className="text-xs text-gray-500 truncate">{emp.department_name}</p>
                        )}
                      </div>
                      {isSending && (
                        <div className="loading loading-spinner loading-sm text-green-600 flex-shrink-0" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default WhatsAppShareLeadRmqModal;
