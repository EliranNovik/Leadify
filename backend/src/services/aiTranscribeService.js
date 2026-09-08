const axios = require('axios');
const FormData = require('form-data');

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

function getOpenAiKey() {
  return (process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || '').trim();
}

function extensionForMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  return 'wav';
}

function isHallucinatedTranscript(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/MBC\s*뉴스|이덕영|시청해\s*주셔서|Thanks for watching|Thank you for watching|Subscribe now|ご視聴|\[Music\]|\[Applause\]|♪/i.test(value)) {
    return true;
  }
  const hangul = (value.match(/[\uAC00-\uD7AF]/g) || []).length;
  const hebrew = (value.match(/[\u0590-\u05FF]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const cyrillic = (value.match(/[\u0400-\u04FF]/g) || []).length;
  return hangul >= 2 && hangul > hebrew + latin + cyrillic;
}

async function transcribeAudio({ audioBase64, mimeType, language, prompt } = {}) {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not set on the backend');
    error.code = 'NO_OPENAI_KEY';
    throw error;
  }
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new Error('audioBase64 is required');
  }

  const buffer = Buffer.from(audioBase64, 'base64');
  if (buffer.length < 200) {
    throw new Error('Recording is too short to transcribe');
  }

  const ext = extensionForMime(mimeType);
  const promptText = String(prompt || '').trim().slice(0, 800);
  const models = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];

  const postModel = async (model) => {
    const form = new FormData();
    form.append('file', buffer, {
      filename: `speech.${ext}`,
      contentType: mimeType || 'audio/webm',
    });
    form.append('model', model);
    form.append('response_format', 'json');
    if (model === 'whisper-1') {
      form.append('temperature', '0');
    }
    if (promptText) {
      form.append('prompt', promptText);
    }
    if (language === 'he' || language === 'en') {
      form.append('language', language);
    }
    return axios.post(WHISPER_URL, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 45000,
      validateStatus: () => true,
    });
  };

  let response = null;
  let lastError = 'Transcription failed';
  for (const model of models) {
    response = await postModel(model);
    if (response.status >= 200 && response.status < 300) break;
    lastError = response.data?.error?.message || response.statusText || lastError;
    response = null;
  }

  if (!response) {
    throw new Error(lastError);
  }

  const transcript = String(response.data?.text || '').trim();
  if (!transcript || isHallucinatedTranscript(transcript)) {
    throw new Error('No speech detected in the recording');
  }
  return { transcript };
}

module.exports = {
  getOpenAiKey,
  transcribeAudio,
};
