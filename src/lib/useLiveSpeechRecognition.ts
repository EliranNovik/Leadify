import { useCallback, useRef, useState } from 'react';

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionResultEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionInstance)
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

export function isLiveSpeechRecognitionSupported(): boolean {
  return !!getSpeechRecognitionCtor();
}

export function useLiveSpeechRecognition() {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const shouldRestartRef = useRef(false);
  const onUpdateRef = useRef<(finalText: string, interimText: string) => void>(() => {});

  const emitUpdate = useCallback(() => {
    onUpdateRef.current(finalTranscriptRef.current, interimTranscriptRef.current);
  }, []);

  const stop = useCallback((): string => {
    shouldRestartRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          // ignore
        }
      }
    }
    recognitionRef.current = null;
    setIsListening(false);

    const combined = [finalTranscriptRef.current.trim(), interimTranscriptRef.current.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();

    finalTranscriptRef.current = combined;
    interimTranscriptRef.current = '';
    emitUpdate();
    return combined;
  }, [emitUpdate]);

  const reset = useCallback(() => {
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
    emitUpdate();
  }, [emitUpdate]);

  const start = useCallback(
    (options?: {
      lang?: string;
      onUpdate?: (finalText: string, interimText: string) => void;
    }) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        throw new Error('Live speech recognition is not supported in this browser');
      }

      stop();
      reset();

      onUpdateRef.current = options?.onUpdate || (() => {});
      shouldRestartRef.current = true;

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = options?.lang || 'he-IL';

      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const piece = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            finalTranscriptRef.current = `${finalTranscriptRef.current}${piece} `.trimStart();
          } else {
            interim += piece;
          }
        }
        interimTranscriptRef.current = interim.trim();
        emitUpdate();
      };

      recognition.onerror = () => {
        // Browser may stop after errors; onend handles restart when still recording.
      };

      recognition.onend = () => {
        if (!shouldRestartRef.current) {
          setIsListening(false);
          return;
        }
        try {
          recognition.start();
        } catch {
          setIsListening(false);
          shouldRestartRef.current = false;
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    },
    [emitUpdate, reset, stop],
  );

  const cancel = useCallback(() => {
    shouldRestartRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
    }
    recognitionRef.current = null;
    setIsListening(false);
    finalTranscriptRef.current = '';
    interimTranscriptRef.current = '';
  }, []);

  return {
    isSupported: isLiveSpeechRecognitionSupported(),
    isListening,
    start,
    stop,
    cancel,
    reset,
  };
}
