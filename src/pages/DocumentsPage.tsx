import React, { useState, useEffect, useRef } from 'react';
import { 
  DocumentArrowUpIcon, 
  MagnifyingGlassIcon, 
  FolderIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  XMarkIcon,
  PaperClipIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { useMsal } from '@azure/msal-react';

interface UploadedFile {
  name: string;
  status: 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface FolderItem {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
  size?: number;
  folder?: {
    childCount: number;
  };
}

interface DocumentItem {
  id: string;
  name: string;
  webUrl: string;
  downloadUrl: string;
  lastModifiedDateTime: string;
  size: number;
  file?: {
    mimeType: string;
  };
}

const DocumentsPage: React.FC = () => {
  // Upload state
  const [folderName, setFolderName] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lastUploadedFolderUrl, setLastUploadedFolderUrl] = useState<string>('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FolderItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [allFolders, setAllFolders] = useState<FolderItem[]>([]);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<FolderItem | null>(null);
  const [folderDocuments, setFolderDocuments] = useState<DocumentItem[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  
  // Upload to existing folder state
  const [isUploadingToFolder, setIsUploadingToFolder] = useState(false);
  const [showUploadSection, setShowUploadSection] = useState(false);

  // MSAL and Graph API setup
  const { accounts, instance } = useMsal();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  
  // Immediate authentication check based on MSAL accounts
  const hasActiveAccounts = accounts.length > 0;

  // Helper function to get current user's name from MSAL
  const getCurrentUserName = (): string => {
    try {
      if (accounts.length > 0) {
        return accounts[0].name || accounts[0].username || 'Unknown User';
      }
      return 'Unknown User';
    } catch (error) {
      console.error('Error getting user name:', error);
      return 'Unknown User';
    }
  };

  // Initialize MSAL authentication
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Only consider user authenticated if they have active MSAL accounts
        if (accounts.length > 0) {
          setIsAuthenticated(true);
          // Try to get a fresh token
          try {
            const tokenResponse = await instance.acquireTokenSilent({
              scopes: ['https://graph.microsoft.com/.default'],
              account: accounts[0]
            });
            setAccessToken(tokenResponse.accessToken);
          } catch (tokenError) {
            console.log('talk not acquire token silently, user may need to re-authenticate');
          }
        } else {
          setIsAuthenticated(false);
          setAccessToken(null);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        setIsAuthenticated(false);
        setAccessToken(null);
      }
    };

    initializeAuth();
  }, [accounts, instance]);

  // Handle file drop
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (!folderName.trim()) {
      toast.error('Please enter a folder name first');
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(Array.from(files));
    }
  };

  // Handle file input change
  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (!folderName.trim()) {
        toast.error('Please enter a folder name first');
        return;
      }
      await uploadFiles(Array.from(files));
    }
  };

  // Main upload function
  const uploadFiles = async (files: File[]) => {
    if (!folderName.trim()) {
      toast.error('Please enter a folder name first');
      return;
    }

    setIsUploading(true);
    setLastUploadedFolderUrl(''); // Clear previous folder URL
    const newUploads = files.map(file => ({ 
      name: file.name, 
      status: 'uploading' as const, 
      progress: 0 
    }));
    setUploadedFiles(prev => [...prev, ...newUploads]);

    const currentUser = await getCurrentUserName();

    for (const file of files) {
      try {
        // Check file size (Microsoft Graph has a 100MB limit for direct uploads)
        if (file.size > 100 * 1024 * 1024) { // 100MB
          throw new Error(`File ${file.name} is too large. Maximum size is 100MB.`);
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderName', folderName);
        formData.append('uploadedBy', currentUser);
        formData.append('isGeneralDocument', 'true');

        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
          body: formData,
        });

        if (error) throw new Error(error.message);
        if (!data || !data.success) {
          throw new Error(data.error || 'Upload function returned an error.');
        }

        // Store the folder URL for the copy link button
        if (data.folderUrl) {
          setLastUploadedFolderUrl(data.folderUrl);
        }

        // Update file status to success
        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'success', progress: 100 } 
            : f
        ));
        
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        // Update file status to error
        setUploadedFiles(prev => prev.map(f => 
          f.name === file.name 
            ? { ...f, status: 'error', error: errorMessage } 
            : f
        ));
        console.error(`Error uploading ${file.name}:`, err);
        // Removed individual file error toast
      }
    }
    setIsUploading(false);
    
    // Show single success toast if all files uploaded successfully
    const successCount = uploadedFiles.filter(f => f.status === 'success').length;
    if (successCount === files.length && files.length > 0) {
      toast.success(`All ${files.length} document${files.length > 1 ? 's' : ''} uploaded successfully!`);
    }
  };

  // Fetch all folders for dropdown
  const fetchAllFolders = async () => {
    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { query: '', searchType: 'general' }
      });

      if (error) {
        console.error('Supabase function error:', error);
        throw new Error(error.message);
      }
      
      if (data && data.success) {
        setAllFolders(data.folders || []);
        setShowDropdown(true);
      } else {
        setAllFolders([]);
      }
    } catch (error) {
      console.error('Error fetching all folders:', error);
      toast.error('Failed to fetch folders');
      setAllFolders([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Search folders in OneDrive
  const searchFolders = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { query: searchQuery, searchType: 'general' }
      });

      if (error) {
        console.error('Supabase function error:', error);
        throw new Error(error.message);
      }
      
      if (data && data.success) {
        setSearchResults(data.folders || []);
      } else {
        console.error('Search failed:', data);
        throw new Error(data?.error || 'Search failed');
      }
    } catch (error) {
      console.error('Error searching folders:', error);
      toast.error('Failed to search folders');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle search input change with debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        searchFolders();
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Don't close if clicking on the dropdown itself
      if (target.closest('.search-dropdown-container')) {
        return;
      }
      setShowDropdown(false);
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);


  // Open folder and load documents
  const openFolder = async (folder: FolderItem) => {
    setSelectedFolder(folder);
    setIsModalOpen(true);
    setIsLoadingDocuments(true);

    try {
      const { data, error } = await supabase.functions.invoke('list-onedrive-files', {
        body: { folderId: folder.id, searchType: 'folderContents' }
      });

      if (error) throw new Error(error.message);
      
      if (data && data.success) {
        setFolderDocuments(data.documents || []);
      } else {
        throw new Error(data?.error || 'Failed to load folder contents');
      }
    } catch (error) {
      console.error('Error loading folder contents:', error);
      toast.error('Failed to load folder contents');
      setFolderDocuments([]);
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  // Download document
  const downloadDocument = async (doc: DocumentItem) => {
    try {
      // Use the downloadUrl directly from the document
      if (doc.downloadUrl) {
        // Create a temporary link to download the file
        const link = document.createElement('a');
        link.href = doc.downloadUrl;
        link.download = doc.name;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast.success(`${doc.name} downloaded successfully`);
      } else {
        throw new Error('Download URL not available');
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error(`Failed to download ${doc.name}`);
    }
  };

  // Download all documents in folder
  const downloadAllDocuments = async () => {
    if (!selectedFolder || folderDocuments.length === 0) return;

    toast.loading(`Downloading ${folderDocuments.length} documents...`, { id: 'download-all' });

    try {
      let successCount = 0;
      let errorCount = 0;

      // Download each document individually
      for (const doc of folderDocuments) {
        try {
          if (doc.downloadUrl) {
            // Create a temporary link to download the file
            const link = document.createElement('a');
            link.href = doc.downloadUrl;
            link.download = doc.name;
            link.target = '_blank';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            successCount++;
          } else {
            console.warn(`No download URL for ${doc.name}`);
            errorCount++;
          }
        } catch (error) {
          console.error(`Error downloading ${doc.name}:`, error);
          errorCount++;
        }
      }

      // Show result toast
      if (successCount > 0 && errorCount === 0) {
        toast.success(`Successfully downloaded ${successCount} documents!`, { id: 'download-all' });
      } else if (successCount > 0 && errorCount > 0) {
        toast.success(`Downloaded ${successCount} documents, ${errorCount} failed`, { id: 'download-all' });
      } else {
        toast.error('Failed to download any documents', { id: 'download-all' });
      }
    } catch (error) {
      console.error('Error downloading documents:', error);
      toast.error('Failed to download documents', { id: 'download-all' });
    }
  };

  // Upload files to existing folder
  const uploadToExistingFolder = async (files: File[]) => {
    if (!selectedFolder) {
      toast.error('No folder selected');
      return;
    }

    setIsUploadingToFolder(true);
    
    try {
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderId', selectedFolder.id);
        formData.append('isExistingFolder', 'true');

        const { data, error } = await supabase.functions.invoke('upload-to-onedrive', {
          body: formData
        });

        if (error) {
          console.error('Upload error:', error);
          throw new Error(error.message);
        }

        if (data && data.success) {
          return { file, status: 'success' };
        } else {
          throw new Error(data?.error || 'Upload failed');
        }
      });

      const results = await Promise.allSettled(uploadPromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      if (successful > 0) {
        toast.success(`${successful} file${successful !== 1 ? 's' : ''} uploaded successfully!`);
        // Refresh the folder documents
        if (selectedFolder) {
          fetchDocuments(selectedFolder);
        }
      }

      if (failed > 0) {
        // Removed failed upload count toast
      }
    } catch (error) {
      console.error('Error uploading files:', error);
      toast.error('Failed to upload files');
    } finally {
      setIsUploadingToFolder(false);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date
  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Copy folder link to clipboard
  const copyFolderLink = async () => {
    if (!lastUploadedFolderUrl) return;
    
    try {
      await navigator.clipboard.writeText(lastUploadedFolderUrl);
      toast.success('Folder link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast.error('Failed to copy link to clipboard');
    }
  };

  // Copy current folder link to clipboard
  const copyCurrentFolderLink = async () => {
    if (!selectedFolder?.webUrl) return;
    
    try {
      await navigator.clipboard.writeText(selectedFolder.webUrl);
      toast.success('Folder link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast.error('Failed to copy link to clipboard');
    }
  };


  // Show sign-in message if not authenticated - use immediate check
  if (!hasActiveAccounts) {
    return (
      <div className="p-6 w-full">
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="bg-white/20 backdrop-blur-lg border border-white/30 rounded-2xl shadow-xl p-12 text-center max-w-md">
            <div className="mb-6">
              <svg className="w-16 h-16 mx-auto text-white/70 mb-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z"/>
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">Authentication Required</h2>
            <p className="text-white/80 mb-6">
              Please sign in with your Microsoft account to access and manage documents.
            </p>
            <p className="text-sm text-white/60">
              Click the "Microsoft Login" button in the header to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 w-full">

      <div className={`grid grid-cols-1 gap-8 ${lastUploadedFolderUrl ? 'lg:grid-cols-2 lg:grid-rows-2' : 'lg:grid-cols-2'}`}>
        {/* Upload Section */}
        <div className="bg-white/20 backdrop-blur-lg border border-white/30 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 overflow-hidden">
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Upload Documents</h2>
              <button
                onClick={() => window.location.reload()}
                className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30 flex items-center gap-2"
                title="Start fresh upload to new folder"
              >
                <PlusIcon className="w-4 h-4" />
                New
              </button>
            </div>
            <div className="border-b border-white/30 mt-2"></div>
          </div>
          <div className="p-6">
            <div className="space-y-6">
              {/* Folder Name Input */}
              <div className="space-y-2">
                <label className="text-base font-medium text-white">Folder Name</label>
                <input
                  type="text"
                  className="input input-bordered w-full bg-white/20 backdrop-blur-sm border-white/30 text-white placeholder-white/70"
                  placeholder="Enter folder name..."
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  disabled={isUploading}
                />
              </div>

              {/* Upload Area */}
              <div 
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ${
                  isDragOver 
                    ? 'border-white/60 bg-white/30 backdrop-blur-sm' 
                    : 'border-white/40 bg-white/10 backdrop-blur-sm'
                }`}
                onDragOver={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  setIsDragOver(false);
                }}
                onDrop={handleFileDrop}
              >
                <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-white/70 mb-4" />
                <div className="text-base text-white mb-4">
                  {isUploading 
                    ? 'Processing files...' 
                    : 'Drag and drop files here, or click to select files'
                  }
                </div>
                <input
                  type="file"
                  className="hidden"
                  id="file-upload"
                  multiple
                  onChange={handleFileInput}
                  disabled={isUploading}
                />
                <label
                  htmlFor="file-upload"
                  className={`btn bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30 ${isUploading ? 'btn-disabled' : ''}`}
                >
                  <PaperClipIcon className="w-5 h-5" />
                  Choose Files
                </label>
              </div>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-medium text-white">Uploaded Files</h3>
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30">
                      <div className="flex items-center gap-3">
                        <PaperClipIcon className="w-5 h-5" style={{ color: 'white' }} />
                        <span className="text-base font-medium text-white">{file.name}</span>
                      </div>
                      <div>
                        {file.status === 'uploading' && (
                          <div className="flex items-center gap-2">
                            <div className="radial-progress" style={{ "--value": file.progress || 0, color: '#3b28c7' } as any}>
                              {file.progress || 0}%
                            </div>
                          </div>
                        )}
                        {file.status === 'success' && (
                          <CheckCircleIcon className="w-6 h-6" style={{ color: '#1e3a8a' }} />
                        )}
                        {file.status === 'error' && (
                          <div className="tooltip" data-tip={file.error}>
                            <XCircleIcon className="w-6 h-6 text-red-500" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Copy Folder Link Button */}
        {lastUploadedFolderUrl && (
          <div className="bg-white/20 backdrop-blur-lg border border-white/30 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-semibold text-white">Folder Uploaded Successfully!</h3>
                    <button
                      onClick={() => setLastUploadedFolderUrl('')}
                      className="btn btn-ghost btn-sm btn-circle text-white/70 hover:text-white hover:bg-white/20"
                      title="Close"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-white/80 mb-4">Click the button to copy the shareable link to your clipboard</p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={copyFolderLink}
                  className="btn flex items-center gap-2"
                  style={{ backgroundColor: '#1e3a8a', borderColor: '#1e3a8a', color: 'white' }}
                >
                  <PaperClipIcon className="w-5 h-5" style={{ color: 'white' }} />
                  Copy Folder Link
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Section */}
        <div className={`bg-white/20 backdrop-blur-lg border border-white/30 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 ${showDropdown ? 'overflow-visible' : 'overflow-hidden'} ${lastUploadedFolderUrl ? 'lg:col-span-2' : ''}`}>
          <div className="pl-6 pt-4 pb-2">
            <h2 className="text-xl font-semibold text-white">Search Documents</h2>
            <div className="border-b border-white/30 mt-2"></div>
          </div>
          <div className="p-6">
            <div className="space-y-6">
              {/* Search Input */}
              <div className="space-y-2 search-dropdown-container relative">
                <label className="text-base font-medium text-white">Search Folders</label>
                <div className="relative">
                  <input
                    type="text"
                    className="input input-bordered w-full pl-10 bg-white/20 backdrop-blur-sm border-white/30 text-white placeholder-white/70"
                    placeholder="Search for folders..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      // Close dropdown when user starts typing
                      if (e.target.value.trim()) {
                        setShowDropdown(false);
                      }
                    }}
                    onClick={() => fetchAllFolders()}
                  />
                  <MagnifyingGlassIcon className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-white/70" />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="loading loading-spinner loading-sm"></div>
                    </div>
                  )}
                  
                  {/* Dropdown with all folders - now positioned relative to the input */}
                  {showDropdown && allFolders.length > 0 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white/20 backdrop-blur-lg border border-white/30 rounded-lg shadow-xl max-h-[60vh] md:max-h-80 overflow-y-auto overscroll-contain">
                      <div className="p-2 text-xs text-white/60 border-b border-white/20 sticky top-0 bg-white/20 backdrop-blur-sm">
                        {searchQuery.trim() ? `Filtered Results (${allFolders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())).length})` : `All Folders (${allFolders.length})`}
                      </div>
                      <div className="overflow-y-auto max-h-[calc(60vh-40px)]">
                        {allFolders
                          .filter(folder => !searchQuery.trim() || folder.name.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map((folder) => (
                          <div 
                            key={folder.id}
                            className="flex items-center justify-between p-3 hover:bg-white/30 cursor-pointer transition-colors border-b border-white/20 last:border-b-0 touch-manipulation"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log('Dropdown folder clicked:', folder.name, folder.id);
                              setShowDropdown(false);
                              openFolder(folder);
                            }}
                          >
                          <div className="flex items-center gap-3">
                            <FolderIcon className="w-5 h-5" style={{ color: '#3b82f6' }} />
                            <div>
                              <div className="text-base font-medium text-white">{folder.name}</div>
                              <div className="text-sm text-white/70">
                                Modified: {formatDate(folder.lastModifiedDateTime)}
                              </div>
                            </div>
                          </div>
                          <EyeIcon className="w-5 h-5 text-white/70" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Search Results */}
              {!showDropdown && searchQuery.trim() && (
                <div className="space-y-2">
                  <h3 className="text-base font-medium text-white">Search Results</h3>
                  <div className="max-h-[60vh] md:max-h-96 overflow-y-auto space-y-2">
                    {searchResults.length > 0 ? (
                    searchResults.map((folder) => (
                      <div 
                        key={folder.id}
                        className="flex items-center justify-between p-3 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30 hover:bg-white/30 cursor-pointer transition-colors"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('Search result folder clicked:', folder.name);
                          openFolder(folder);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <FolderIcon className="w-5 h-5" style={{ color: '#3b82f6' }} />
                          <div>
                            <div className="text-base font-medium text-white">{folder.name}</div>
                            <div className="text-sm text-white/70">
                              Modified: {formatDate(folder.lastModifiedDateTime)}
                              {folder.folder?.childCount && ` • ${folder.folder.childCount} items`}
                            </div>
                          </div>
                        </div>
                        <EyeIcon className="w-5 h-5 text-white/70" />
                      </div>
                    ))
                  ) : searchQuery.trim() ? (
                    <div className="text-center py-8 text-white/70">
                      <FolderIcon className="w-12 h-12 mx-auto mb-2 text-white/50" />
                      <p>No folders found matching "{searchQuery}"</p>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-white/70">
                      <MagnifyingGlassIcon className="w-12 h-12 mx-auto mb-2 text-white/50" />
                      <p>Enter a search term to find folders</p>
                    </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Folder Contents Modal */}
      {isModalOpen && selectedFolder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
          <div className="bg-white/20 backdrop-blur-lg w-full max-w-2xl h-full shadow-2xl transform transition-transform border-l border-white/30">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/30">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FolderIcon className="w-6 h-6" style={{ color: '#3b82f6' }} />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-white truncate" title={selectedFolder.name}>
                    {selectedFolder.name}
                  </h2>
                  <p className="text-sm text-white/80">
                    {folderDocuments.length} document{folderDocuments.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <button
                  className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30"
                  onClick={() => setShowUploadSection(!showUploadSection)}
                >
                  <DocumentArrowUpIcon className="w-4 h-4" />
                  {showUploadSection ? 'Hide Upload' : 'Upload Files'}
                </button>
                <button
                  className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30 flex items-center gap-1"
                  onClick={copyCurrentFolderLink}
                  title="Copy folder link to clipboard"
                >
                  <PaperClipIcon className="w-4 h-4" />
                  Copy Link
                </button>
                {folderDocuments.length > 0 && (
                  <button
                    className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30"
                    onClick={downloadAllDocuments}
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                    Download All
                  </button>
                )}
                <button
                  className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30"
                  onClick={() => setIsModalOpen(false)}
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Upload Section */}
            {showUploadSection && (
              <div className="p-6 border-b border-white/30">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Upload Files to {selectedFolder?.name}</h3>
                    <button
                      className="btn btn-sm btn-ghost text-white/70 hover:text-white"
                      onClick={() => setShowUploadSection(false)}
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div 
                    className="border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 bg-white/10 backdrop-blur-sm border-white/40"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const files = Array.from(e.dataTransfer.files);
                      if (files.length > 0) {
                        uploadToExistingFolder(files);
                      }
                    }}
                  >
                    <DocumentArrowUpIcon className="w-12 h-12 mx-auto text-white/70 mb-4" />
                    <div className="text-base text-white mb-4">
                      Drag and drop files here, or click to select files
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      id="folder-file-upload"
                      multiple
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                          uploadToExistingFolder(files);
                        }
                      }}
                      disabled={isUploadingToFolder}
                    />
                    <label
                      htmlFor="folder-file-upload"
                      className="btn bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30"
                    >
                      <PaperClipIcon className="w-5 h-5" />
                      Choose Files
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto" style={{ height: 'calc(100% - 80px)' }}>
              {isLoadingDocuments ? (
                <div className="flex items-center justify-center py-12">
                  <div className="loading loading-spinner loading-lg"></div>
                </div>
              ) : folderDocuments.length > 0 ? (
                <div className="space-y-3">
                  {folderDocuments.map((document) => (
                    <div 
                      key={document.id}
                      className="flex items-center justify-between p-4 bg-white/20 backdrop-blur-sm rounded-lg border border-white/30 hover:bg-white/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <PaperClipIcon className="w-5 h-5" style={{ color: 'white' }} />
                        <div>
                          <div className="text-base font-medium text-white">{document.name}</div>
                          <div className="text-sm text-white/70">
                            {formatFileSize(document.size)} • {formatDate(document.lastModifiedDateTime)}
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn btn-sm bg-white/20 backdrop-blur-sm border-white/40 text-white hover:bg-white/30"
                        onClick={() => downloadDocument(document)}
                      >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-white/70">
                  <PaperClipIcon className="w-12 h-12 mx-auto mb-2 text-white/50" />
                  <p>No documents found in this folder</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsPage;
