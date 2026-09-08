import { useCallback, useRef, useState } from 'react';
import { isHallucinatedTranscript, transcribeVoiceBlob } from './aiTranscribeApi';

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function useLiveBackendTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('');
  const contextRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const isRecordingRef = useRef(false);
  const stopPromiseRef = useRef<Promise<string> | null>(null);

  const cleanupAudio = useCallback(() => {
    if (levelRafRef.current != null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (contextRef.current) {
      void contextRef.current.close().catch(() => undefined);
      contextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setAudioLevel(0);
  }, []);

  const start = useCallback(
    async (_options?: { onUpdate?: (text: string) => void }) => {
      if (isRecordingRef.current || stopPromiseRef.current) return;
      const mimeType = pickMimeType();
      if (!navigator.mediaDevices?.getUserMedia || !mimeType) {
        throw new Error('Microphone is not supported in this browser');
      }
      chunksRef.current = [];
      mimeTypeRef.current = mimeType;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const context = new AudioCtx();
        if (context.state === 'suspended') {
          await context.resume();
        }
        contextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const sampleLevel = () => {
          analyser.getByteFrequencyData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) sum += buffer[i];
          setAudioLevel(Math.min(1, (sum / buffer.length / 255) * 2.2));
          levelRafRef.current = requestAnimationFrame(sampleLevel);
        };
        levelRafRef.current = requestAnimationFrame(sampleLevel);
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();

      isRecordingRef.current = true;
      setIsRecording(true);
    },
    [],
  );

  const stop = useCallback(async (): Promise<string> => {
    if (stopPromiseRef.current) return stopPromiseRef.current;

    const run = (async () => {
      isRecordingRef.current = false;
      const recorder = recorderRef.current;
      recorderRef.current = null;

      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        });
      }

      cleanupAudio();
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
      chunksRef.current = [];

      try {
        if (blob.size < 800) return '';
        const transcript = (await transcribeVoiceBlob(blob, mimeTypeRef.current || blob.type)).trim();
        if (!transcript || isHallucinatedTranscript(transcript)) return '';
        return transcript;
      } finally {
        setIsRecording(false);
      }
    })();

    stopPromiseRef.current = run;
    try {
      return await run;
    } finally {
      if (stopPromiseRef.current === run) stopPromiseRef.current = null;
    }
  }, [cleanupAudio]);

  const cancel = useCallback(() => {
    isRecordingRef.current = false;
    stopPromiseRef.current = null;
    chunksRef.current = [];
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupAudio();
    setIsRecording(false);
  }, [cleanupAudio]);

  return {
    isSupported: typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickMimeType(),
    isRecording,
    audioLevel,
    start,
    stop,
    cancel,
  };
}
