const express = require('express');
const { getOpenAiKey, transcribeAudio } = require('../services/aiTranscribeService');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    openaiConfigured: Boolean(getOpenAiKey()),
  });
});

router.post('/', async (req, res) => {
  try {
    const result = await transcribeAudio({
      audioBase64: req.body?.audioBase64,
      mimeType: req.body?.mimeType,
      language: req.body?.language,
      prompt: req.body?.prompt,
    });
    res.json({ success: true, transcript: result.transcript });
  } catch (error) {
    const status = error?.code === 'NO_OPENAI_KEY' ? 503 : 400;
    console.error('POST /api/ai/transcribe failed:', error.message || error);
    res.status(status).json({
      success: false,
      error: error.message || 'Transcription failed',
    });
  }
});

module.exports = router;
