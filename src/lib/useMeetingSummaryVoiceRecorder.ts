import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_RECORDING_SECONDS = 5 * 60;

export type VoiceRecordingResult = {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
};

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export type VoiceRecordingCompleteHandler = (result: VoiceRecordingResult) => void;

export function useMeetingSummaryVoiceRecorder(options?: {
  onRecordingComplete?: VoiceRecordingCompleteHandler;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const stopResolverRef = useRef<((result: VoiceRecordingResult) => void) | null>(null);
  const stopRejectRef = useRef<((err: Error) => void) | null>(null);
  const onRecordingCompleteRef = useRef(options?.onRecordingComplete);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  onRecordingCompleteRef.current = options?.onRecordingComplete;

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopAudioLevelMonitor = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const startAudioLevelMonitor = useCallback((stream: MediaStream) => {
    stopAudioLevelMonitor();
    try {
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const sampleLevel = () => {
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) {
          sum += buffer[i];
        }
        const average = sum / buffer.length / 255;
        setAudioLevel(Math.min(1, average * 2.2));
        levelRafRef.current = requestAnimationFrame(sampleLevel);
      };
      levelRafRef.current = requestAnimationFrame(sampleLevel);
    } catch {
      stopAudioLevelMonitor();
    }
  }, [stopAudioLevelMonitor]);

  const stopInternal = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    setIsRecording(false);
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      stopInternal();
      stopAudioLevelMonitor();
      cleanupStream();
    };
  }, [clearTimer, cleanupStream, stopAudioLevelMonitor, stopInternal]);

  const isSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    !!pickMimeType();

  const start = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Voice recording is not supported in this browser');
    }
    if (isRecording) return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      throw new Error('No supported audio recording format found');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    startAudioLevelMonitor(stream);
    chunksRef.current = [];
    mimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      stopAudioLevelMonitor();
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || mimeType });
      const result: VoiceRecordingResult = {
        blob,
        mimeType: mimeTypeRef.current || mimeType,
        durationSeconds: secondsRef.current,
      };
      recorderRef.current = null;
      chunksRef.current = [];
      if (stopResolverRef.current) {
        stopResolverRef.current(result);
        stopResolverRef.current = null;
        stopRejectRef.current = null;
      } else {
        onRecordingCompleteRef.current?.(result);
      }
    };

    recorder.onerror = () => {
      const err = new Error('Recording failed');
      stopRejectRef.current?.(err);
      stopRejectRef.current = null;
      stopResolverRef.current = null;
    };

    recorder.start(250);
    secondsRef.current = 0;
    setSeconds(0);
    setIsRecording(true);
    clearTimer();
    timerRef.current = setInterval(() => {
      secondsRef.current += 1;
      setSeconds(secondsRef.current);
      if (secondsRef.current >= MAX_RECORDING_SECONDS) {
        stopInternal();
      }
    }, 1000);
  }, [clearTimer, cleanupStream, isRecording, isSupported, startAudioLevelMonitor, stopAudioLevelMonitor, stopInternal]);

  const stop = useCallback((): Promise<VoiceRecordingResult> => {
    if (!isRecording || !recorderRef.current) {
      return Promise.reject(new Error('Not recording'));
    }

    return new Promise((resolve, reject) => {
      stopResolverRef.current = resolve;
      stopRejectRef.current = reject;
      stopInternal();
    });
  }, [isRecording, stopInternal]);

  const cancel = useCallback(() => {
    stopResolverRef.current = null;
    stopRejectRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = () => {
        stopAudioLevelMonitor();
        cleanupStream();
        recorderRef.current = null;
        chunksRef.current = [];
      };
      recorderRef.current.stop();
    } else {
      stopAudioLevelMonitor();
      cleanupStream();
    }
    setIsRecording(false);
    setSeconds(0);
    secondsRef.current = 0;
    clearTimer();
  }, [cleanupStream, clearTimer, stopAudioLevelMonitor]);

  return {
    isSupported,
    isRecording,
    seconds,
    audioLevel,
    maxSeconds: MAX_RECORDING_SECONDS,
    start,
    stop,
    cancel,
  };
}

export async function voiceBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read recording'));
        return;
      }
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Failed to encode recording'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read recording'));
    reader.readAsDataURL(blob);
  });
}

export function formatRecordingTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
