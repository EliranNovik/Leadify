import React, { useState, useRef, useEffect } from 'react';
import { MicrophoneIcon, StopIcon, XMarkIcon } from '@heroicons/react/24/solid';
import OpusMediaRecorder from 'opus-media-recorder';

interface VoiceMessageRecorderProps {
  onRecorded: (audioBlob: Blob) => void;
  onCancel: () => void;
  className?: string;
}

const VoiceMessageRecorder: React.FC<VoiceMessageRecorderProps> = ({
  onRecorded,
  onCancel,
  className = ''
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | OpusMediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const mimeTypeRef = useRef<string>('audio/ogg;codecs=opus');

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Check if browser natively supports OGG/Opus
      const nativeOggSupported = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') || 
                                   MediaRecorder.isTypeSupported('audio/ogg');
      
      let mediaRecorder: MediaRecorder | OpusMediaRecorder;
      let mimeType: string;
      
      if (nativeOggSupported) {
        // Use native MediaRecorder with OGG
        mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') 
          ? 'audio/ogg;codecs=opus' 
          : 'audio/ogg';
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mimeTypeRef.current = mimeType;
        console.log('✅ Using native OGG/Opus recording');
      } else {
        // Use OpusMediaRecorder polyfill to record in OGG/Opus format
        // This works even in browsers that only support WebM natively
        try {
          // Configure OpusMediaRecorder with worker and WASM paths
          mediaRecorder = new OpusMediaRecorder(
            stream,
            { mimeType: 'audio/ogg;codecs=opus' },
            {
              encoderWorkerFactory: () => {
                return new Worker('/encoderWorker.umd.js', { type: 'module' });
              },
              OggOpusEncoderWasmPath: '/OggOpusEncoder.wasm'
            }
          );
          mimeType = 'audio/ogg;codecs=opus';
          mimeTypeRef.current = mimeType;
          console.log('✅ Using OpusMediaRecorder polyfill for OGG/Opus recording');
        } catch (error) {
          console.error('Failed to initialize OpusMediaRecorder:', error);
          // Fallback to native MediaRecorder (will be WebM, but we'll handle the error)
          mimeType = 'audio/webm;codecs=opus';
          mimeTypeRef.current = mimeType;
          mediaRecorder = new MediaRecorder(stream, { mimeType });
          console.warn('⚠️ Falling back to WebM recording (may not work with WhatsApp)');
        }
      }

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Create blob with the MIME type we used for recording
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach(track => track.stop());
        // Notify parent that recording is complete
        onRecorded(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Microphone access denied. Please allow microphone access to record voice messages.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleCancel = () => {
    stopRecording();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingTime(0);
    onCancel();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (audioBlob && audioUrl) {
    // Show preview with cancel option (send button is in parent)
    return (
      <div className={`flex items-center gap-3 p-3 bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
        <audio src={audioUrl} controls className="flex-1" />
        <button
          onClick={handleCancel}
          className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center justify-center transition-colors"
          aria-label="Cancel"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 p-3 bg-white rounded-lg shadow-sm border border-gray-200 ${className}`}>
      {!isRecording ? (
        <>
          <button
            onClick={startRecording}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors animate-pulse"
            aria-label="Start recording"
          >
            <MicrophoneIcon className="w-5 h-5" />
          </button>
          <span className="text-sm text-gray-600">Tap to record voice message</span>
          <button
            onClick={onCancel}
            className="ml-auto flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center justify-center transition-colors"
            aria-label="Cancel"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </>
      ) : (
        <>
          <button
            onClick={stopRecording}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors"
            aria-label="Stop recording"
          >
            <StopIcon className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-gray-700">Recording...</span>
              <span className="text-sm text-gray-500">{formatTime(recordingTime)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default VoiceMessageRecorder;

