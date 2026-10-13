// WhatsApp message-template locale codes. Keep this list centralized so the
// builder and future locale filters use the exact API value, not UI labels.
export const META_TEMPLATE_LANGUAGES = [
  ["af", "Afrikaans"], ["sq", "Albanian"], ["ar", "Arabic"],
  ["ar_EG", "Arabic (Egypt)"], ["ar_AE", "Arabic (UAE)"], ["ar_LB", "Arabic (Lebanon)"],
  ["ar_MA", "Arabic (Morocco)"], ["ar_QA", "Arabic (Qatar)"], ["az", "Azerbaijani"],
  ["be_BY", "Belarusian"], ["bn", "Bengali"], ["bg", "Bulgarian"], ["ca", "Catalan"],
  ["zh_CN", "Chinese (China)"], ["zh_HK", "Chinese (Hong Kong)"], ["zh_TW", "Chinese (Taiwan)"],
  ["hr", "Croatian"], ["cs", "Czech"], ["da", "Danish"], ["nl", "Dutch"],
  ["en", "English"], ["en_GB", "English (UK)"], ["en_US", "English (US)"],
  ["et", "Estonian"], ["fil", "Filipino"], ["fi", "Finnish"], ["fr", "French"],
  ["de", "German"], ["el", "Greek"], ["gu", "Gujarati"], ["ha", "Hausa"],
  ["he", "Hebrew"], ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Bahasa Indonesia"],
  ["ga", "Irish"], ["it", "Italian"], ["ja", "Japanese"], ["kn", "Kannada"],
  ["kk", "Kazakh"], ["ko", "Korean"], ["lo", "Lao"], ["lv", "Latvian"],
  ["lt", "Lithuanian"], ["mk", "Macedonian"], ["ms", "Malay"], ["ml", "Malayalam"],
  ["mr", "Marathi"], ["nb", "Norwegian"], ["fa", "Persian"], ["pl", "Polish"],
  ["pt_BR", "Portuguese (Brazil)"], ["pt_PT", "Portuguese (Portugal)"], ["pa", "Punjabi"],
  ["ro", "Romanian"], ["ru", "Russian"], ["sr", "Serbian"], ["sk", "Slovak"],
  ["sl", "Slovenian"], ["es", "Spanish"], ["es_AR", "Spanish (Argentina)"],
  ["es_ES", "Spanish (Spain)"], ["es_MX", "Spanish (Mexico)"], ["sw", "Swahili"],
  ["sv", "Swedish"], ["ta", "Tamil"], ["te", "Telugu"], ["th", "Thai"],
  ["tr", "Turkish"], ["uk", "Ukrainian"], ["ur", "Urdu"], ["uz", "Uzbek"],
  ["vi", "Vietnamese"], ["zu", "Zulu"],
] as const;

export type MetaTemplateLanguageCode = (typeof META_TEMPLATE_LANGUAGES)[number][0];

export const META_TEMPLATE_LANGUAGE_CODES = new Set<string>(
  META_TEMPLATE_LANGUAGES.map(([code]) => code),
);
