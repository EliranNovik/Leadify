import React, { useRef, useState } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { portalUploadContactProfile } from '../../../lib/portalApi';
import { EntityAvatar } from './portalTheme';

const ACCEPT = 'image/jpeg,image/jpg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp';

function isAllowedImage(file: File): boolean {
  if (file.type?.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
}

type Props = {
  contactId: number;
  name: string;
  imageUrl?: string | null;
  sizeClass?: string;
  onUpdated?: (storagePath: string) => void;
};

const PortalContactAvatar: React.FC<Props> = ({
  contactId,
  name,
  imageUrl,
  sizeClass = 'h-14 w-14 text-base',
  onUpdated,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isAllowedImage(file)) {
      toast.error('Please choose a JPG, PNG, GIF, or WebP image');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5MB or smaller');
      return;
    }
    setUploading(true);
    try {
      const result = await portalUploadContactProfile(contactId, file);
      if (!result.ok || !result.portal_profile_image_path) {
        throw new Error(result.error || 'Upload failed');
      }
      toast.success('Profile photo updated');
      onUpdated?.(result.portal_profile_image_path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="relative shrink-0 group">
      <EntityAvatar
        name={name}
        imageUrl={imageUrl}
        stableKey={`contact-avatar::${contactId}`}
        className={sizeClass}
      />
      <button
        type="button"
        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Change photo"
        aria-label="Change profile photo"
      >
        {uploading ? (
          <span className="loading loading-spinner loading-sm text-white" />
        ) : (
          <CameraIcon className="h-5 w-5 text-white" />
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  );
};

export default PortalContactAvatar;
