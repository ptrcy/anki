const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');

const client = new textToSpeech.TextToSpeechClient();

const VOICE_MAP = {
  it: { languageCode: 'it-IT', name: 'it-IT-Wavenet-B' },
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
  es: { languageCode: 'es-ES', name: 'es-ES-Wavenet-C' },
  de: { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-C' },
  pt: { languageCode: 'pt-BR', name: 'pt-BR-Neural2-B' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-A' },
  ru: { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-A' },
};

async function synthesizeText(text, langCode, outPath) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('text must be a non-empty string');
  }
  if (typeof outPath !== 'string' || outPath === '') {
    throw new Error('outPath must be provided');
  }

  const voice = VOICE_MAP[langCode];
  if (!voice) {
    throw new Error(`Unsupported langCode: ${langCode}`);
  }
  
  try {
    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'MP3' },
    });
    if (!response || !response.audioContent) {
      throw new Error('Empty audio content received from TTS service');
    }
    await fs.promises.writeFile(outPath, response.audioContent);
    return true;
  } catch (err) {
    console.error(`TTS Error for "${text}":`, err.message);
    return false;
  }
}

module.exports = { synthesizeText, VOICE_MAP };
