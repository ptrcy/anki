const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const path = require('path');

const client = new textToSpeech.TextToSpeechClient();

const VOICE_MAP = {
  it: { languageCode: 'it-IT', name: 'it-IT-Wavenet-B' },
  en: { languageCode: 'en-US', name: 'en-US-Wavenet-F' },
  es: { languageCode: 'es-ES', name: 'es-ES-Wavenet-C' },
  de: { languageCode: 'de-DE', name: 'de-DE-Wavenet-F' },
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Wavenet-C' },
  pt: { languageCode: 'pt-PT', name: 'pt-PT-Wavenet-A' },
  ja: { languageCode: 'ja-JP', name: 'ja-JP-Wavenet-A' },
  ru: { languageCode: 'ru-RU', name: 'ru-RU-Wavenet-A' },
};

async function synthesizeText(text, langCode, outPath) {
  const voice = VOICE_MAP[langCode] || VOICE_MAP.it;
  
  try {
    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'MP3' },
    });
    fs.writeFileSync(outPath, response.audioContent, 'binary');
    return true;
  } catch (err) {
    console.error(`TTS Error for "${text}":`, err.message);
    return false;
  }
}

module.exports = { synthesizeText };
