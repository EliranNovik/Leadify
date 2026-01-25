import React, { useState, useEffect } from 'react';
import { XMarkIcon, ArrowDownTrayIcon, ShareIcon } from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';

interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentUrl: string;
  documentName: string;
  employeeName?: string;
  uploadedAt?: string;
  sickDaysReason?: string;
  bucketName?: string; // Optional bucket name, defaults to 'employee-unavailability-documents'
}

const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  isOpen,
  onClose,
  documentUrl,
  documentName,
  employeeName,
  uploadedAt,
  sickDaysReason,
  bucketName = 'employee-unavailability-documents',
}) => {
  const [imageError, setImageError] = useState(false);
  const [pdfError, setPdfError] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  // Generate signed URL for private bucket
  useEffect(() => {
    if (isOpen && documentUrl) {
      setLoadingUrl(true);
      setImageError(false);
      setPdfError(false);
      
      // Extract file path from URL if it's a full URL, otherwise use as-is
      const generateSignedUrl = async () => {
        try {
          let filePath = documentUrl;
          
          // If it's a Supabase storage URL, extract the path
          if (documentUrl.includes('/storage/v1/object/')) {
            // Format: https://...supabase.co/storage/v1/object/public|sign/bucket-name/path/to/file
            const urlParts = documentUrl.split('/storage/v1/object/');
            if (urlParts.length > 1) {
              const afterStorage = urlParts[1];
              // Remove bucket name and public/sign prefix
              const pathParts = afterStorage.split('/');
              if (pathParts.length > 1) {
                // Skip 'public' or 'sign' and bucket name, get the rest
                filePath = pathParts.slice(2).join('/');
              }
            }
          } else if (documentUrl.startsWith('http://') || documentUrl.startsWith('https://')) {
            // Try to extract path from any HTTP URL
            try {
              const url = new URL(documentUrl);
              // Remove leading slash and bucket name if present
              let pathname = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
              // If pathname starts with bucket name, remove it
              if (pathname.startsWith(bucketName + '/')) {
                pathname = pathname.substring(bucketName.length + 1);
              }
              filePath = pathname;
            } catch (e) {
              // If URL parsing fails, use the original documentUrl
              filePath = documentUrl;
            }
          }

          console.log('Generating signed URL for bucket:', bucketName, 'path:', filePath);

          const { data, error } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(filePath, 3600); // 1 hour expiry

          if (error) {
            console.error('Error generating signed URL:', error);
            setImageError(true);
            setPdfError(true);
            setLoadingUrl(false);
            return;
          }

          setSignedUrl(data.signedUrl);
        } catch (error) {
          console.error('Error generating signed URL:', error);
          setImageError(true);
          setPdfError(true);
        } finally {
          setLoadingUrl(false);
        }
      };

      generateSignedUrl();
    }
  }, [isOpen, documentUrl, bucketName]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    try {
      const urlToUse = signedUrl || documentUrl;
      if (!urlToUse) {
        alert('Document URL not available');
        return;
      }

      const response = await fetch(urlToUse);
      if (!response.ok) {
        throw new Error('Failed to fetch document');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = documentName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      alert('Failed to download document');
    }
  };

  const handleShare = async () => {
    const urlToUse = signedUrl || documentUrl;
    if (!urlToUse) {
      alert('Document URL not available');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: documentName,
          text: employeeName ? `Document from ${employeeName}` : 'Document',
          url: urlToUse,
        });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Error sharing document:', error);
        }
      }
    } else {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(urlToUse);
        alert('Document URL copied to clipboard');
      } catch (error) {
        console.error('Error copying to clipboard:', error);
        alert('Failed to share document');
      }
    }
  };

  const isImage = documentName.match(/\.(jpg|jpeg|png|gif|webp)$/i) || documentUrl.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isPdf = documentName.match(/\.pdf$/i) || documentUrl.match(/\.pdf$/i);

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-white m-0 p-0" style={{ margin: 0, padding: 0 }}>
      {/* Modal Container - Full Screen */}
      <div className="relative w-full h-full flex flex-col bg-white m-0 p-0" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
        {/* Header */}
        <div className="bg-white border-b border-gray-200 shadow-sm px-6 py-4 flex items-center justify-between z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold truncate">{documentName}</h2>
            <div className="flex flex-col gap-1 mt-1">
              {employeeName && (
                <p className="text-sm text-gray-600 truncate">From: {employeeName}</p>
              )}
              {uploadedAt && (
                <p className="text-sm text-gray-500 truncate">Uploaded: {formatDateTime(uploadedAt)}</p>
              )}
              {sickDaysReason && (
                <p className="text-sm text-gray-600 truncate">Reason: {sickDaysReason}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={handleDownload}
              className="btn btn-sm btn-ghost"
              title="Download"
            >
              <ArrowDownTrayIcon className="w-5 h-5" />
              <span className="hidden sm:inline ml-2">Download</span>
            </button>
            <button
              onClick={handleShare}
              className="btn btn-sm btn-ghost"
              title="Share"
            >
              <ShareIcon className="w-5 h-5" />
              <span className="hidden sm:inline ml-2">Share</span>
            </button>
            <button
              onClick={onClose}
              className="btn btn-sm btn-ghost btn-circle"
              title="Close"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto bg-white flex items-center justify-center" style={{ width: '100%', height: '100%' }}>
          {loadingUrl ? (
            <div className="text-gray-700 text-center">
              <span className="loading loading-spinner loading-lg"></span>
              <p className="mt-4 text-gray-600">Loading document...</p>
            </div>
          ) : !signedUrl && !documentUrl.startsWith('http') ? (
            <div className="text-gray-700 text-center max-w-2xl">
              <p className="text-xl mb-2 font-semibold">Failed to load document</p>
              <p className="text-gray-600 mb-6">
                Unable to generate access URL for the document.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={handleDownload}
                  className="btn btn-primary"
                >
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                  Try Download
                </button>
                {documentUrl && (
                  <a
                    href={documentUrl.startsWith('http') ? documentUrl : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline btn-primary"
                    onClick={(e) => {
                      if (!documentUrl.startsWith('http')) {
                        e.preventDefault();
                        alert('Document URL not available. Please try downloading.');
                      }
                    }}
                  >
                    Open in New Tab
                  </a>
                )}
              </div>
            </div>
          ) : isImage && !imageError && signedUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-white" style={{ width: '100%', height: '100%' }}>
              <img
                src={signedUrl}
                alt={documentName}
                className="max-w-full max-h-full object-contain"
                style={{ maxWidth: '100%', maxHeight: '100%' }}
                onError={() => {
                  setImageError(true);
                }}
              />
            </div>
          ) : isPdf && !pdfError && signedUrl ? (
            <iframe
              src={signedUrl}
              className="w-full h-full border-0 bg-white"
              style={{ width: '100%', height: '100%' }}
              title={documentName}
              onError={() => {
                setPdfError(true);
              }}
            />
          ) : imageError || pdfError ? (
            <div className="text-gray-700 text-center max-w-2xl">
              <p className="text-xl mb-2 font-semibold">Failed to load document</p>
              <p className="text-gray-600 mb-6">
                The document could not be loaded. Please try downloading it or opening it in a new tab.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={handleDownload}
                  className="btn btn-primary"
                >
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                  Download Document
                </button>
                <a
                  href={signedUrl || (documentUrl.startsWith('http') ? documentUrl : '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-primary"
                  onClick={(e) => {
                    if (!signedUrl && !documentUrl.startsWith('http')) {
                      e.preventDefault();
                      alert('Document URL not available. Please try downloading.');
                    }
                  }}
                >
                  Open in New Tab
                </a>
              </div>
            </div>
          ) : (
            <div className="text-gray-700 text-center max-w-2xl">
              <p className="text-xl mb-4 font-semibold">Document Preview Not Available</p>
              <p className="text-gray-600 mb-6">
                This document type cannot be previewed in the browser.
              </p>
              <div className="flex gap-4 justify-center">
                <button
                  onClick={handleDownload}
                  className="btn btn-primary"
                >
                  <ArrowDownTrayIcon className="w-5 h-5 mr-2" />
                  Download Document
                </button>
                <a
                  href={signedUrl || documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-primary"
                >
                  Open in New Tab
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentViewerModal;
