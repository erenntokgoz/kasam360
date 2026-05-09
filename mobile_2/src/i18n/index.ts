import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { storage } from '../utils/storage';

import tr from './tr.json';
import en from './en.json';

const LANGUAGE_KEY = 'app.language';

// MMKV'den seçili dili al (varsayılan: 'tr')
const savedLanguage = storage.getString(LANGUAGE_KEY) || 'tr';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      tr: { translation: tr },
      en: { translation: en },
    },
    lng: savedLanguage,
    fallbackLng: 'tr',
    interpolation: {
      escapeValue: false, // React zaten XSS koruması sağlıyor
    },
    compatibilityJSON: 'v4',
  });

export const changeLanguage = (lang: 'tr' | 'en') => {
  i18n.changeLanguage(lang);
  storage.set(LANGUAGE_KEY, lang);
};

export default i18n;
