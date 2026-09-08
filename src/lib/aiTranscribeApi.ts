import { buildApiUrl } from './api';
import { transcribeMeetingSummaryAudio } from './meetingSummaryNotesApi';

const HALLUCINATION =
  /MBC\s*뉴스|이덕영|시청해\s*주셔서|Thanks for watching|Thank you for watching|Subscribe now|ご視聴|\[Music\]|\[Applause\]|♪/i;

export function isHallucinatedTranscript(text: string): boolean {
  const value = String(text || '').trim();
  if (!value) return true;
  if (HALLUCINATION.test(value)) return true;
  const hangul = (value.match(/[\uAC00-\uD7AF]/g) || []).length;
  const hebrew = (value.match(/[\u0590-\u05FF]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const cyrillic = (value.match(/[\u0400-\u04FF]/g) || []).length;
  return hangul >= 2 && hangul > hebrew + latin + cyrillic;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read recording'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read recording'));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.split(',')[1];
  if (!base64) throw new Error('Failed to encode recording');
  return base64;
}

function cleanTranscript(text: unknown): string {
  const transcript = typeof text === 'string' ? text.trim() : '';
  if (!transcript || isHallucinatedTranscript(transcript)) return '';
  return transcript;
}

export async function transcribeVoiceBlob(blob: Blob, mimeType?: string): Promise<string> {
  const audioBase64 = await blobToBase64(blob);
  const type = mimeType || blob.type || 'audio/webm';

  try {
    const response = await fetch(buildApiUrl('/api/ai/transcribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType: type }),
    });
    const data = await response.json().catch(() => ({}));
    const transcript = cleanTranscript(data?.transcript);
    if (response.ok && transcript) return transcript;
    if (response.status !== 503) {
      throw new Error(data?.error || 'Transcription failed');
    }
  } catch (error) {
    if (error instanceof Error && error.message !== 'Failed to fetch' && !/503|OPENAI_API_KEY/i.test(error.message)) {
      throw error;
    }
  }

  const fallback = await transcribeMeetingSummaryAudio({
    audioBase64,
    mimeType: type,
    language: 'auto',
  });
  return cleanTranscript(fallback.transcript);
}
