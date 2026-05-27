import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

function extensionForMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { audioBase64, mimeType, language } = await req.json();

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      throw new Error('audioBase64 is required');
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const binary = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    if (binary.byteLength < 100) {
      throw new Error('Recording is too short to transcribe');
    }

    if (binary.byteLength > 24 * 1024 * 1024) {
      throw new Error('Recording is too large (max ~24MB). Try a shorter clip.');
    }

    const ext = extensionForMime(typeof mimeType === 'string' ? mimeType : 'audio/webm');
    const form = new FormData();
    form.append('file', new Blob([binary], { type: mimeType || 'audio/webm' }), `recording.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'json');
    if (language === 'he' || language === 'en') {
      form.append('language', language);
    }

    const whisperRes = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.json().catch(() => ({}));
      throw new Error(err.error?.message || whisperRes.statusText || 'Transcription failed');
    }

    const data = await whisperRes.json();
    const transcript = (data.text || '').trim();
    if (!transcript) {
      throw new Error('No speech detected in the recording');
    }

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
