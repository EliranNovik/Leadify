import React, { useState, useRef, useEffect } from 'react';
import { PlayIcon } from '@heroicons/react/24/solid';
import WhatsAppAvatar from './WhatsAppAvatar';

interface VoiceMessagePlayerProps {
  audioUrl: string;
  className?: string;
  variant?: 'incoming' | 'outgoing';
  rightAvatar?: React.ReactNode;
  /** @deprecated Pass `rightAvatar` instead */
  senderName?: string;
  /** @deprecated Pass `rightAvatar` instead */
  profilePictureUrl?: string | null;
  /** @deprecated Pass `rightAvatar` instead */
  showAvatar?: boolean;
}

const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  audioUrl,
  className = '',
  variant = 'incoming',
  rightAvatar,
  senderName = 'User',
  profilePictureUrl = null,
  showAvatar = false,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const handleError = (e: Event) => {
      setIsLoading(false);
      setHasError(true);
      const audio = e.target as HTMLAudioElement;
      if (audio?.error) {
        console.log('Audio unavailable (may have expired):', audioUrl);
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const isOutgoing = variant === 'outgoing';

  const resolvedRightAvatar =
    rightAvatar ??
    (showAvatar ? (
      <WhatsAppAvatar name={senderName} profilePictureUrl={profilePictureUrl} size="md" />
    ) : null);

  const playButtonClass = isOutgoing
    ? 'text-gray-300 hover:text-white'
    : 'text-gray-500 hover:text-gray-700';

  const playControl = (
    <button
      type="button"
      onClick={togglePlay}
      disabled={isLoading || hasError}
      className={`flex h-9 w-9 shrink-0 items-center justify-center border-0 bg-transparent p-0 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${playButtonClass}`}
      aria-label={isPlaying ? 'Pause' : 'Play'}
    >
      {isLoading ? (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : isPlaying ? (
        <span className="flex h-6 w-6 items-center justify-center gap-[3px]" aria-hidden>
          <span className="h-[18px] w-[5px] rounded-[2px] bg-current" />
          <span className="h-[18px] w-[5px] rounded-[2px] bg-current" />
        </span>
      ) : (
        <PlayIcon className="h-7 w-7" />
      )}
    </button>
  );

  if (hasError) {
    return (
      <div
        className={`flex w-full min-w-[300px] max-w-full items-center gap-2 rounded-lg bg-transparent p-2 sm:min-w-[380px] ${className}`}
      >
        {playControl}
        <div className="min-w-0 flex-1">
          <p className="text-sm italic text-gray-500">Voice message unavailable (may have expired)</p>
        </div>
        {resolvedRightAvatar ? <div className="shrink-0">{resolvedRightAvatar}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={`flex w-full min-w-[300px] max-w-full items-center gap-2 rounded-lg bg-transparent p-2 sm:min-w-[380px] ${className}`}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {playControl}

      <div className="min-w-0 flex-1">
        <div
          className={`relative h-2 overflow-hidden rounded-full ${
            isOutgoing ? 'bg-white/25' : 'bg-black/[0.06]'
          }`}
        >
          <div
            className={`absolute left-0 top-0 h-full transition-all duration-100 ${
              isOutgoing ? 'bg-white' : 'bg-gray-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          className={`mt-1 flex items-center justify-between text-xs ${
            isOutgoing ? 'text-white/80' : 'text-gray-600'
          }`}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {resolvedRightAvatar ? <div className="shrink-0">{resolvedRightAvatar}</div> : null}
    </div>
  );
};

export default VoiceMessagePlayer;
