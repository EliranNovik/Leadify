import React, { useState, useEffect } from 'react';
import { 
  XMarkIcon, 
  EyeIcon, 
  ArrowDownTrayIcon, 
  DocumentIcon,
  PhotoIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import { createPortal } from 'react-dom';

interface Document {
  id: string;
  name: string;
  size: number;
  lastModified: string;
  downloadUrl: string;
  webUrl: string;
  fileType: string;
}

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadNumber: string;
  clientName: string;
  onDocumentCountChange?: (count: number) => void;
}

const DocumentModal: React.FC<DocumentModalProps> = ({ isOpen, onClose, leadNumber, clientName, onDocumentCountChange }) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const [downloading, setDownloading] = useState<string[]>([]);

  // Fetch documents when modal opens
  useEffect(() => {
    if (isOpen && leadNumber) {
      fetchDocuments();
    }
  }, [isOpen, leadNumber]);

  useEffect(() => {
    if (onDocumentCountChange) {
      onDocumentCountChange(documents.length);
    }
  }, [documents, onDocumentCountChange]);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Fetching documents for lead:', leadNumber);
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { leadNumber }
      });

      console.log('Function response:', { data, error });

      if (error) {
        console.error('Supabase function error:', error);
        setError(`Function error: ${error.message}`);
        return;
      }

      if (data && data.success) {
        console.log('Documents fetched successfully:', data.files);
        setDocuments(data.files || []);
      } else if (data && !data.success) {
        console.error('Function returned error:', data);
        // Handle specific 404 case (folder not found)
        if (data.error && data.error.includes('not found')) {
          setError(`No documents found for lead ${leadNumber}. Documents may not have been uploaded yet.`);
        } else {
          setError(data.error || 'Failed to fetch documents');
        }
      } else {
        console.error('Unexpected response format:', data);
        setError('Unexpected response format from server');
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError(`Failed to fetch documents: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (document: Document) => {
    if (downloading.includes(document.id)) return;
    
    setDownloading(prev => [...prev, document.id]);
    try {
      const response = await fetch(document.downloadUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(prev => prev.filter(id => id !== document.id));
    }
  };

  const handleDownloadAll = async () => {
    if (documents.length === 0) return;
    
    setDownloading(prev => [...prev, 'all']);
    try {
      for (const doc of documents) {
        await handleDownload(doc);
        // Small delay between downloads to avoid overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error('Bulk download error:', err);
    } finally {
      setDownloading(prev => prev.filter(id => id !== 'all'));
    }
  };

  const handlePreview = (document: Document) => {
    setPreviewDocument(document);
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('image/')) return PhotoIcon;
    if (fileType.includes('pdf')) return DocumentTextIcon;
    if (fileType.includes('text/') || fileType.includes('document')) return DocumentTextIcon;
    if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return ArchiveBoxIcon;
    return DocumentIcon;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className={`fixed inset-0 z-[1000] flex items-end justify-end bg-black bg-opacity-40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} style={{ top: 0, left: 0 }}>
      <div className={`fixed right-0 top-0 h-full bg-white rounded-l-2xl shadow-2xl p-10 w-full max-w-2xl min-h-[350px] max-h-full flex flex-col relative overflow-y-auto transition-transform duration-500 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ boxShadow: '0 0 40px 0 rgba(0,0,0,0.2)' }}>
        {/* Modal Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold mb-1">Documents</h2>
            <p className="text-base-content/70 text-sm">Lead: {clientName} ({leadNumber})</p>
          </div>
          <div className="flex gap-2 items-center">
            <button className="btn btn-primary btn-sm" onClick={handleDownloadAll} disabled={documents.length === 0 || loading}>
              <ArrowDownTrayIcon className="w-5 h-5 mr-1" />
              Download All
            </button>
            <button className="btn btn-ghost btn-circle" onClick={onClose}>
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
        {/* Modal Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="loading loading-spinner loading-lg"></div>
              <span className="ml-3">Loading documents...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-error">
              <ExclamationTriangleIcon className="w-8 h-8 mr-3" />
              <span>{error}</span>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-base-content/70">
              <DocumentIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>No documents found for this lead.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => {
                const FileIcon = getFileIcon(doc.fileType);
                const isDownloading = downloading.includes(doc.id);
                
                return (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-4 bg-base-200 rounded-lg hover:bg-base-300 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileIcon className="w-8 h-8 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{doc.name}</p>
                        <div className="flex items-center gap-4 text-sm text-base-content/70">
                          <span>{formatFileSize(doc.size)}</span>
                          <span>•</span>
                          <span>{formatDate(doc.lastModified)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handlePreview(doc)}
                        className="btn btn-ghost btn-sm"
                        title="Preview"
                      >
                        <EyeIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        disabled={isDownloading}
                        className="btn btn-primary btn-sm gap-2"
                        title="Download"
                      >
                        {isDownloading ? (
                          <div className="loading loading-spinner loading-xs"></div>
                        ) : (
                          <ArrowDownTrayIcon className="w-4 h-4" />
                        )}
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewDocument && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-75" onClick={() => setPreviewDocument(null)} />
          <div className="relative bg-base-100 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-base-300">
              <h3 className="text-lg font-semibold">{previewDocument.name}</h3>
              <button
                onClick={() => setPreviewDocument(null)}
                className="btn btn-ghost btn-circle"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-4 h-[calc(90vh-120px)] overflow-auto">
              {previewDocument.fileType.includes('image/') ? (
                <img
                  src={previewDocument.downloadUrl}
                  alt={previewDocument.name}
                  className="max-w-full h-auto mx-auto"
                />
              ) : previewDocument.fileType.includes('pdf') ? (
                <iframe
                  src={previewDocument.downloadUrl}
                  className="w-full h-full border-0"
                  title={previewDocument.name}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-base-content/70">
                  <DocumentIcon className="w-16 h-16 mr-4" />
                  <p>Preview not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    window.document.body
  );
};

export default DocumentModal; 