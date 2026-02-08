import React, { useState, useEffect } from 'react';
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline';

interface NotesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (notes: string) => Promise<void>;
    notes: string;
    isSaving?: boolean;
    paymentId?: string | number;
}

// Helper function to detect Hebrew text and return RTL direction
const getTextDirection = (text: string): 'rtl' | 'ltr' => {
    if (!text) return 'ltr';
    // Check if text contains Hebrew characters (Unicode range 0590-05FF)
    const hebrewRegex = /[\u0590-\u05FF]/;
    return hebrewRegex.test(text) ? 'rtl' : 'ltr';
};

const NotesModal: React.FC<NotesModalProps> = ({
    isOpen,
    onClose,
    onSave,
    notes: initialNotes,
    isSaving = false,
    paymentId
}) => {
    const [notes, setNotes] = useState<string>(initialNotes || '');
    const [textDirection, setTextDirection] = useState<'rtl' | 'ltr'>('ltr');

    // Update notes when initialNotes changes
    useEffect(() => {
        setNotes(initialNotes || '');
        setTextDirection(getTextDirection(initialNotes || ''));
    }, [initialNotes]);

    // Update text direction when notes change
    useEffect(() => {
        setTextDirection(getTextDirection(notes));
    }, [notes]);

    // Reset form when modal closes
    useEffect(() => {
        if (!isOpen) {
            setNotes(initialNotes || '');
        }
    }, [isOpen, initialNotes]);

    const handleSave = async () => {
        await onSave(notes);
    };

    const handleCancel = () => {
        setNotes(initialNotes || '');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                {/* Header */}
                <div className="bg-white border-b border-gray-200 px-6 py-4 rounded-t-lg">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-gray-900">Edit Notes</h3>
                        <button
                            onClick={handleCancel}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            disabled={isSaving}
                        >
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-4">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Notes
                            </label>
                            <textarea
                                className="textarea textarea-bordered w-full h-32 resize-none"
                                placeholder="Enter notes..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                disabled={isSaving}
                                dir={textDirection}
                                style={{ textAlign: textDirection === 'rtl' ? 'right' : 'left' }}
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 rounded-b-lg flex justify-end gap-3">
                    <button
                        onClick={handleCancel}
                        className="btn btn-ghost"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn btn-primary"
                        disabled={isSaving}
                    >
                        {isSaving ? (
                            <>
                                <span className="loading loading-spinner loading-sm"></span>
                                Saving...
                            </>
                        ) : (
                            <>
                                <CheckIcon className="w-5 h-5" />
                                Save
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NotesModal;
