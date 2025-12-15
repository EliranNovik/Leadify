import React, { useEffect, useRef, useState } from 'react';
import { XMarkIcon, PlayIcon, PauseIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';

interface AudioPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioUrl: string;
  callId: string;
  employeeName?: string;
}

const AudioPlayerModal: React.FC<AudioPlayerModalProps> = ({
  isOpen,
  onClose,
  audioUrl,
  callId,
  employeeName
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (isOpen && audioUrl) {
      // Reset state when modal opens
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      
      // Initialize audio and wait for it to be ready
      initializeAudio().then(() => {
        // Test canvas and start visualization after audio is initialized
        setTimeout(() => {
          if (canvasRef.current) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              console.log('🧪 Testing canvas with simple drawing...');
              ctx.fillStyle = '#3f2bcd';
              ctx.fillRect(10, 10, 50, 50);
              ctx.fillStyle = '#6366f1';
              ctx.fillRect(70, 10, 50, 50);
              ctx.fillStyle = '#8b5cf6';
              ctx.fillRect(130, 10, 50, 50);
              console.log('✅ Canvas test drawing completed');
              
              // Start visualization immediately
              console.log('🎨 Starting initial visualization...');
              visualize();
              
              // Auto-play after audio is ready (with user interaction context)
              if (audioRef.current && audioRef.current.readyState >= HTMLMediaElement.HAVE_METADATA) {
                setTimeout(async () => {
                  console.log('🎵 Auto-playing audio...');
                  try {
                    // Set up audio context if not already done
                    if (!audioContextRef.current) {
                      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
                      const audioContext = new AudioContext();
                      audioContextRef.current = audioContext;
                      
                      if (audioContext.state === 'suspended') {
                        await audioContext.resume();
                        console.log('🔊 Audio context resumed for auto-play');
                      }
                    }
                    
                    // Only auto-play if audio is ready
                    if (audioRef.current && audioRef.current.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                      await togglePlayPause();
                    }
                  } catch (error) {
                    console.error('❌ Auto-play failed:', error);
                    // Don't show alert for auto-play failures, user can click play manually
                  }
                }, 500);
              }
            }
          }
        }, 100);
      }).catch((error) => {
        console.error('❌ Failed to initialize audio:', error);
      });
    }

    return () => {
      cleanup();
    };
  }, [isOpen, audioUrl]);

  const initializeAudio = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        // Clean up any existing audio first
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        // Create audio element
        const audio = new Audio();
        audio.crossOrigin = 'anonymous'; // Enable CORS
        audio.src = audioUrl;
        audioRef.current = audio;

        let hasResolved = false;

        // Audio event listeners
        audio.addEventListener('loadedmetadata', () => {
          console.log('Audio metadata loaded, duration:', audio.duration);
          setDuration(audio.duration);
        });

        audio.addEventListener('timeupdate', () => {
          setCurrentTime(audio.currentTime);
        });

        audio.addEventListener('ended', () => {
          console.log('Audio playback ended');
          setIsPlaying(false);
          setCurrentTime(0);
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
          }
        });

        audio.addEventListener('error', (e) => {
          console.error('Audio error:', e);
          const errorDetails = {
            error: audio.error,
            src: audio.src,
            networkState: audio.networkState,
            readyState: audio.readyState
          };
          console.error('Audio error details:', errorDetails);
          
          // Handle 404 errors gracefully
          if (audio.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || 
              audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
            console.warn('⚠️ Recording not available (404 or unsupported format)');
            // Don't reject, just resolve so UI can still show
            if (!hasResolved) {
              hasResolved = true;
              resolve();
            }
          } else {
            if (!hasResolved) {
              hasResolved = true;
              reject(new Error(`Audio load failed: ${audio.error?.message || 'Unknown error'}`));
            }
          }
        });

        audio.addEventListener('canplay', () => {
          console.log('Audio can play');
          if (!hasResolved) {
            hasResolved = true;
            resolve();
          }
        });

        audio.addEventListener('canplaythrough', () => {
          console.log('Audio can play through');
          if (!hasResolved) {
            hasResolved = true;
            resolve();
          }
        });

        audio.addEventListener('playing', () => {
          console.log('Audio is playing');
        });

        audio.volume = volume;

        // Load the audio
        audio.load();
        
        // Timeout fallback - resolve after 3 seconds even if canplay doesn't fire
        setTimeout(() => {
          if (!hasResolved) {
            console.warn('⚠️ Audio initialization timeout, proceeding anyway');
            hasResolved = true;
            resolve();
          }
        }, 3000);
      } catch (error) {
        console.error('Error initializing audio:', error);
        reject(error);
      }
    });
  };

  const cleanup = () => {
    console.log('🧹 Cleaning up audio player...');
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current.load();
      } catch (error) {
        console.warn('Error cleaning up audio:', error);
      }
      audioRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      audioContextRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  const togglePlayPause = async () => {
    if (!audioRef.current) {
      console.error('No audio reference found');
      // Try to reinitialize if audio ref is missing
      if (isOpen && audioUrl) {
        console.log('Attempting to reinitialize audio...');
        try {
          await initializeAudio();
          if (!audioRef.current) {
            console.error('Failed to reinitialize audio');
            return;
          }
        } catch (error) {
          console.error('Error reinitializing audio:', error);
          return;
        }
      } else {
        return;
      }
    }

    if (isPlaying) {
      console.log('Pausing audio');
      audioRef.current.pause();
      setIsPlaying(false);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    } else {
      try {
        // Check if audio has already failed
        if (audioRef.current.error) {
          const errorCode = audioRef.current.error.code;
          if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || 
              errorCode === MediaError.MEDIA_ERR_NETWORK ||
              audioRef.current.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
            throw new Error('Recording not available (404 or network error)');
          }
        }
        
        // Check if audio is ready to play
        if (audioRef.current.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          console.log('Audio not ready, waiting for canplay...');
          await new Promise<void>((resolve, reject) => {
            // Check immediately if there's already an error
            if (audioRef.current?.error) {
              const errorCode = audioRef.current.error.code;
              if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || 
                  errorCode === MediaError.MEDIA_ERR_NETWORK) {
                reject(new Error('Recording not available'));
                return;
              }
            }
            
            const timeout = setTimeout(() => {
              // Check error state before rejecting
              if (audioRef.current?.error) {
                const errorCode = audioRef.current.error.code;
                if (errorCode === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || 
                    errorCode === MediaError.MEDIA_ERR_NETWORK) {
                  reject(new Error('Recording not available (timeout with error)'));
                } else {
                  reject(new Error('Audio load timeout'));
                }
              } else {
                reject(new Error('Audio load timeout'));
              }
            }, 3000); // Reduced timeout to 3 seconds
            
            const canPlayHandler = () => {
              clearTimeout(timeout);
              audioRef.current?.removeEventListener('canplay', canPlayHandler);
              audioRef.current?.removeEventListener('error', errorHandler);
              audioRef.current?.removeEventListener('loadstart', loadStartHandler);
              resolve();
            };
            
            const errorHandler = (e: Event) => {
              clearTimeout(timeout);
              audioRef.current?.removeEventListener('canplay', canPlayHandler);
              audioRef.current?.removeEventListener('error', errorHandler);
              audioRef.current?.removeEventListener('loadstart', loadStartHandler);
              
              const error = audioRef.current?.error;
              if (error) {
                if (error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || 
                    error.code === MediaError.MEDIA_ERR_NETWORK) {
                  reject(new Error('Recording not available (404 or network error)'));
                } else {
                  reject(new Error(`Audio load error: ${error.message || 'Unknown error'}`));
                }
              } else {
                reject(new Error('Audio load error'));
              }
            };
            
            const loadStartHandler = () => {
              console.log('Audio load started');
            };
            
            audioRef.current?.addEventListener('canplay', canPlayHandler);
            audioRef.current?.addEventListener('error', errorHandler);
            audioRef.current?.addEventListener('loadstart', loadStartHandler);
          });
        }
        
        console.log('Attempting to play audio from:', audioRef.current.src);
        
        // Set up audio context for visualization only when playing
        if (!audioContextRef.current) {
          const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;

          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 512; // Higher resolution for better visualization
          analyser.smoothingTimeConstant = 0.1; // Less smoothing for more responsive visualization
          analyser.minDecibels = -90;
          analyser.maxDecibels = -10;
          analyserRef.current = analyser;

          try {
            const source = audioContext.createMediaElementSource(audioRef.current);
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            console.log('🎵 Audio context and analyser set up successfully for frequency analysis');
            
            // Test the analyser immediately
            setTimeout(() => {
              const testArray = new Uint8Array(analyser.frequencyBinCount);
              analyser.getByteFrequencyData(testArray);
              const hasData = testArray.some(value => value > 0);
              console.log('🧪 Analyser test:', {
                frequencyBinCount: analyser.frequencyBinCount,
                hasData,
                maxValue: Math.max(...testArray),
                sampleData: Array.from(testArray.slice(0, 10))
              });
            }, 100);
          } catch (error) {
            console.warn('⚠️ Could not create audio visualization, playing without it:', error);
          }
        }
        
        // Resume audio context if suspended
        if (audioContextRef.current?.state === 'suspended') {
          await audioContextRef.current.resume();
        }
        
        await audioRef.current.play();
        console.log('Audio playing successfully');
        setIsPlaying(true);
        visualize();
      } catch (error) {
        console.error('Error playing audio:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Check if it's a 404 or media error
        if (errorMessage.includes('404') || 
            errorMessage.includes('not suitable') ||
            errorMessage.includes('not available') ||
            errorMessage.includes('MEDIA_ERR_SRC_NOT_SUPPORTED') ||
            errorMessage.includes('network error')) {
          alert('This recording is not available. It may have been deleted or is from an older system.');
        } else if (errorMessage.includes('timeout')) {
          // Check if there's an actual error in the audio element
          if (audioRef.current?.error) {
            alert('This recording is not available. It may have been deleted or is from an older system.');
          } else {
            alert('Failed to load recording. Please try again.');
          }
        } else {
          alert('Failed to play recording. Error: ' + errorMessage);
        }
      }
    }
  };

  const visualize = () => {
    console.log('🎨 Starting visualization...');
    
    if (!canvasRef.current) {
      console.error('❌ No canvas ref found');
      return;
    }

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) {
      console.error('❌ Could not get canvas context');
      return;
    }

    console.log('✅ Canvas ready, size:', canvas.width, 'x', canvas.height);

    const draw = () => {
      // Only continue animation if modal is still open
      if (!isOpen) {
        console.log('🚪 Modal closed, stopping animation');
        return;
      }
      
      animationRef.current = requestAnimationFrame(draw);

      // Clear canvas
      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      // Create gradient background
      const gradient = canvasCtx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, '#f8fafc');
      gradient.addColorStop(1, '#f1f5f9');
      canvasCtx.fillStyle = gradient;
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      if (isPlaying) {
        // Always show colorful animation when playing
        const time = Date.now() * 0.005;
        const barCount = 60;
        const barWidth = canvas.width / barCount;
        
        if (analyserRef.current) {
          // Try to get real frequency data
          const analyser = analyserRef.current;
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          
          // Get frequency data
          analyser.getByteFrequencyData(dataArray);

          // Check if we're getting actual frequency data
          const hasAudioData = dataArray.some(value => value > 0);
          const maxValue = Math.max(...dataArray);
          
          // Debug frequency data (log occasionally)
          if (Math.random() < 0.02) {
            console.log('🔍 Frequency analysis:', {
              hasAudioData,
              maxValue,
              sampleValues: dataArray.slice(0, 10)
            });
          }
          
          if (hasAudioData && maxValue > 10) {
            // Use real frequency data
            console.log('🎵 Using real frequency data, max value:', maxValue);
            let x = 0;
            for (let i = 0; i < barCount; i++) {
              const dataIndex = Math.floor((i / barCount) * bufferLength);
              const frequency = dataArray[dataIndex] || 0;
              
              // Scale the frequency data to fit canvas height with more dynamic range
              const barHeight = (frequency / 255) * canvas.height * 0.9;
              
              // Add some minimum height for visual effect
              const minHeight = 5;
              const finalHeight = Math.max(barHeight, minHeight);

              // Create gradient for bars
              const barGradient = canvasCtx.createLinearGradient(0, canvas.height - finalHeight, 0, canvas.height);
              barGradient.addColorStop(0, '#3f2bcd');
              barGradient.addColorStop(0.5, '#6366f1');
              barGradient.addColorStop(1, '#8b5cf6');
              
              canvasCtx.fillStyle = barGradient;
              canvasCtx.fillRect(x, canvas.height - finalHeight, barWidth - 1, finalHeight);

              x += barWidth;
            }
          } else {
            // Use animated fallback with audio-synced timing
            console.log('🎭 Using animated fallback, frequency data insufficient');
            for (let i = 0; i < barCount; i++) {
              const x = i * barWidth;
              // Create more dynamic animation with varying heights
              const height = Math.sin(time + i * 0.2) * 40 + 50 + Math.sin(time * 2 + i * 0.1) * 20;
              
              // Create gradient for bars
              const barGradient = canvasCtx.createLinearGradient(0, canvas.height - height, 0, canvas.height);
              barGradient.addColorStop(0, '#3f2bcd');
              barGradient.addColorStop(0.5, '#6366f1');
              barGradient.addColorStop(1, '#8b5cf6');
              
              canvasCtx.fillStyle = barGradient;
              canvasCtx.fillRect(x, canvas.height - height, barWidth - 1, height);
            }
          }
        } else {
          // No analyser, use pure animation
          console.log('🎨 Using pure animation, no analyser available');
          for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            // Create more dynamic animation with varying heights
            const height = Math.sin(time + i * 0.2) * 40 + 50 + Math.sin(time * 2 + i * 0.1) * 20;
            
            // Create gradient for bars
            const barGradient = canvasCtx.createLinearGradient(0, canvas.height - height, 0, canvas.height);
            barGradient.addColorStop(0, '#3f2bcd');
            barGradient.addColorStop(0.5, '#6366f1');
            barGradient.addColorStop(1, '#8b5cf6');
            
            canvasCtx.fillStyle = barGradient;
            canvasCtx.fillRect(x, canvas.height - height, barWidth - 1, height);
          }
        }
      } else {
        // Show static visualization when not playing
        if (duration > 0) {
          // Audio is loaded but not playing - show static bars
          const barCount = 50;
          const barWidth = canvas.width / barCount;
          const baseHeight = 20;
          
          for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            // Create some variation in height for visual interest
            const height = baseHeight + (Math.sin(i * 0.3) * 10);
            
            // Create gradient for bars
            const barGradient = canvasCtx.createLinearGradient(0, canvas.height - height, 0, canvas.height);
            barGradient.addColorStop(0, '#e5e7eb');
            barGradient.addColorStop(0.5, '#d1d5db');
            barGradient.addColorStop(1, '#9ca3af');
            
            canvasCtx.fillStyle = barGradient;
            canvasCtx.fillRect(x, canvas.height - height, barWidth - 2, height);
          }
          
          console.log('📊 Static visualization (audio loaded but not playing)');
        } else {
          // No audio loaded yet - show minimal animation
          const time = Date.now() * 0.003; // Slower animation
          const barCount = 30; // Fewer bars
          const barWidth = canvas.width / barCount;
          
          for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            const height = Math.sin(time + i * 0.3) * 15 + 25; // Smaller, slower animation
            
            // Create gradient for bars
            const barGradient = canvasCtx.createLinearGradient(0, canvas.height - height, 0, canvas.height);
            barGradient.addColorStop(0, '#f3f4f6');
            barGradient.addColorStop(0.5, '#e5e7eb');
            barGradient.addColorStop(1, '#d1d5db');
            
            canvasCtx.fillStyle = barGradient;
            canvasCtx.fillRect(x, canvas.height - height, barWidth - 2, height);
          }
          
          console.log('🎭 Minimal animation (no audio loaded)');
        }
      }
    };

    console.log('🚀 Starting draw loop...');
    draw();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
    }
  };

  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white bg-opacity-20 flex items-center justify-center">
              <SpeakerWaveIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Recording Player</h3>
              <p className="text-sm text-white text-opacity-90">
                {employeeName ? `${employeeName} - ` : ''}Call ID: {callId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm btn-circle text-white hover:bg-white hover:bg-opacity-20"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Waveform Visualization */}
          <div className="relative">
            <canvas
              ref={canvasRef}
              width={600}
              height={150}
              className="w-full rounded-xl shadow-inner border border-gray-200"
              style={{ width: '100%', height: '150px' }}
            />
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="range range-primary range-sm w-full"
              style={{
                background: `linear-gradient(to right, #3f2bcd 0%, #3f2bcd ${(currentTime / duration) * 100}%, #e5e7eb ${(currentTime / duration) * 100}%, #e5e7eb 100%)`
              }}
            />
            <div className="flex justify-between text-sm text-gray-500">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            {/* Play/Pause Button */}
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlayPause}
                className="btn btn-circle btn-lg"
                style={{ backgroundColor: '#3f2bcd', borderColor: '#3f2bcd' }}
                disabled={!audioRef.current}
              >
                {isPlaying ? (
                  <PauseIcon className="w-6 h-6 text-white" />
                ) : (
                  <PlayIcon className="w-6 h-6 text-white ml-1" />
                )}
              </button>

              {/* Status Indicator */}
              <div className="flex items-center gap-2">
                {isPlaying && (
                  <>
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-sm font-medium text-gray-700">Playing</span>
                  </>
                )}
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-3">
              <SpeakerWaveIcon className="w-5 h-5 text-gray-400" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                className="range range-primary range-xs w-24"
              />
              <span className="text-sm text-gray-500 w-10">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPlayerModal;