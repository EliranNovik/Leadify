import React, { useState, useRef, useEffect } from 'react';
import {
    XMarkIcon,
    CloudArrowUpIcon,
    DocumentArrowUpIcon,
    CheckCircleIcon
} from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface HandlerLead {
    id: string;
    lead_number: string;
    name: string;
}

interface Contact {
    id: string;
    name: string;
    lead_id: string;
}

interface UploadDocumentModalProps {
    isOpen: boolean;
    onClose: () => void;
    contact: Contact | null;
    lead: HandlerLead | null;
    uploadFiles: (lead: HandlerLead, files: File[]) => Promise<void>;
    isUploading?: boolean;
    onDocumentAdded?: () => void;
    currentUser?: { id: string; full_name: string } | null;
}

const UploadDocumentModal: React.FC<UploadDocumentModalProps> = ({
    isOpen,
    onClose,
    contact,
    lead,
    uploadFiles,
    isUploading = false,
    onDocumentAdded,
    currentUser
}) => {
    const [draggedFiles, setDraggedFiles] = useState<File[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isUploadingLocal, setIsUploadingLocal] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Document form fields
    const [documentName, setDocumentName] = useState('');
    const [documentType, setDocumentType] = useState('identity');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');
    const [isRequired, setIsRequired] = useState(true);
    const [requestedFrom, setRequestedFrom] = useState('');

    // Reset form when modal closes
    useEffect(() => {
        if (!isOpen) {
            setDraggedFiles([]);
            setDocumentName('');
            setDocumentType('identity');
            setDueDate('');
            setNotes('');
            setIsRequired(true);
            setRequestedFrom('');
        }
    }, [isOpen]);

    if (!isOpen || !lead) return null;

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            setDraggedFiles(prev => [...prev, ...files]);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setDraggedFiles(prev => [...prev, ...files]);
        }
        // Reset input so same file can be selected again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const removeFile = (index: number) => {
        setDraggedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleUpload = async () => {
        if (draggedFiles.length === 0) {
            toast.error('Please select at least one file to upload');
            return;
        }

        if (!documentName.trim()) {
            toast.error('Document name is required');
            return;
        }

        if (!lead) {
            toast.error('Lead is required');
            return;
        }

        // Check if this is a legacy lead
        const isLegacyLead = lead.id.startsWith('legacy_');

        try {
            // For new leads (UUID), create the document requirement in the database
            // For legacy leads, skip document requirement creation and just upload files
            if (!isLegacyLead) {
                const documentData = {
                    document_name: documentName,
                    document_type: documentType,
                    lead_id: lead.id,
                    contact_id: contact?.id || null,
                    due_date: dueDate || null,
                    notes: notes || null,
                    is_required: isRequired,
                    requested_from: requestedFrom || null,
                    status: 'pending',
                    requested_by: currentUser?.id || currentUser?.full_name || 'System User'
                };

                const { data: insertedDocument, error: docError } = await supabase
                    .from('lead_required_documents')
                    .insert(documentData)
                    .select()
                    .single();

                if (docError) {
                    toast.error('Error creating document requirement: ' + docError.message);
                    console.error('Error creating document:', docError);
                    return;
                }
            }

            // Upload the files using the same mechanism as DocumentModal (Supabase function)
            setIsUploadingLocal(true);
            let successCount = 0;
            let errorCount = 0;

            for (const file of draggedFiles) {
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('leadNumber', lead.lead_number);

                    const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
                        body: formData,
                    });

                    if (error) throw new Error(error.message);
                    if (!data || !data.success) {
                        throw new Error(data?.error || 'Upload function returned an error.');
                    }

                    successCount++;
                } catch (err) {
                    console.error(`Error uploading ${file.name}:`, err);
                    errorCount++;
                }
            }

            setIsUploadingLocal(false);

            if (errorCount > 0) {
                toast.error(`Failed to upload ${errorCount} file(s). ${successCount > 0 ? `${successCount} file(s) uploaded successfully.` : ''}`);
            } else {
                if (isLegacyLead) {
                    toast.success(`Successfully uploaded ${successCount} file(s) for legacy lead`);
                } else {
                    toast.success(`Successfully uploaded ${successCount} file(s) and created document requirement`);
                }
            }

            // Reset form
            setDraggedFiles([]);
            setDocumentName('');
            setDocumentType('identity');
            setDueDate('');
            setNotes('');
            setIsRequired(true);
            setRequestedFrom('');

            // Callback to refresh documents list
            if (onDocumentAdded) {
                onDocumentAdded();
            }

            onClose();
        } catch (error) {
            console.error('Error uploading files:', error);
            toast.error('Failed to upload files');
        }
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30">
            <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Upload Documents</h3>
                        <p className="text-sm text-gray-600 mt-1">
                            Upload documents{contact ? ` for ${contact.name}` : ''}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn btn-ghost btn-circle btn-sm"
                        disabled={isUploading}
                    >
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Drag and Drop Area */}
                <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${isDragOver
                        ? 'border-primary bg-primary/10 scale-105'
                        : 'border-gray-300 hover:border-gray-400'
                        }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <CloudArrowUpIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-lg font-medium text-gray-700 mb-2">
                        Drag and drop files here
                    </p>
                    <p className="text-sm text-gray-500 mb-4">or</p>
                    <label className="btn btn-primary gap-2 cursor-pointer">
                        <DocumentArrowUpIcon className="w-5 h-5" />
                        Select Files
                        <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            multiple
                            onChange={handleFileInput}
                            disabled={isUploading || isUploadingLocal}
                        />
                    </label>
                    <p className="text-xs text-gray-400 mt-4">
                        Supported formats: PDF, DOC, DOCX, JPG, PNG, etc.
                    </p>
                </div>

                {/* Selected Files List */}
                {draggedFiles.length > 0 && (
                    <div className="mt-6">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">
                            Selected Files ({draggedFiles.length})
                        </h4>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {draggedFiles.map((file, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                                >
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <DocumentArrowUpIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                                {file.name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {formatFileSize(file.size)}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFile(index)}
                                        className="btn btn-ghost btn-xs text-red-600 hover:bg-red-600 hover:text-white"
                                        disabled={isUploading || isUploadingLocal}
                                    >
                                        <XMarkIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Document Information Form */}
                <div className="mt-6 space-y-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Document Information</h4>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Document Name *</label>
                        <input
                            type="text"
                            className="input input-bordered w-full"
                            value={documentName}
                            onChange={(e) => setDocumentName(e.target.value)}
                            placeholder="Enter document name..."
                            disabled={isUploading || isUploadingLocal}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select
                            className="select select-bordered w-full"
                            value={documentType}
                            onChange={(e) => setDocumentType(e.target.value)}
                            disabled={isUploading || isUploadingLocal}
                        >
                            <option value="identity">Identity</option>
                            <option value="civil_status">Civil Status</option>
                            <option value="legal">Legal</option>
                            <option value="financial">Financial</option>
                            <option value="professional">Professional</option>
                            <option value="health">Health</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                        <input
                            type="date"
                            className="input input-bordered w-full"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            disabled={isUploading || isUploadingLocal}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Requested From</label>
                        <select
                            className="select select-bordered w-full"
                            value={requestedFrom}
                            onChange={(e) => setRequestedFrom(e.target.value)}
                            disabled={isUploading || isUploadingLocal}
                        >
                            <option value="">Select source...</option>
                            <option value="Ministry of Interior">Ministry of Interior</option>
                            <option value="Rabbinical Office">Rabbinical Office</option>
                            <option value="Foreign Ministry">Foreign Ministry</option>
                            <option value="Client">Client</option>
                            <option value="Police">Police</option>
                            <option value="Embassy">Embassy</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                            className="textarea textarea-bordered w-full h-20 resize-none"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Instructions or notes for this document..."
                            disabled={isUploading || isUploadingLocal}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            className="checkbox checkbox-primary"
                            checked={isRequired}
                            onChange={(e) => setIsRequired(e.target.checked)}
                            disabled={isUploading || isUploadingLocal}
                        />
                        <label className="text-sm font-medium text-gray-700">Required document</label>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 mt-6">
                    <button
                        className="btn btn-outline flex-1"
                        onClick={onClose}
                        disabled={isUploading}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary flex-1 gap-2"
                        onClick={handleUpload}
                        disabled={isUploading || isUploadingLocal || draggedFiles.length === 0 || !documentName.trim()}
                    >
                        {(isUploading || isUploadingLocal) ? (
                            <>
                                <span className="loading loading-spinner loading-sm"></span>
                                Uploading...
                            </>
                        ) : (
                            <>
                                <CloudArrowUpIcon className="w-5 h-5" />
                                Upload & Save {draggedFiles.length > 0 && `(${draggedFiles.length})`}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UploadDocumentModal;
