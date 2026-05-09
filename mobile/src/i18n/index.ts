import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getItem, setItem, StorageKeys } from '../utils/storage';

import tr from './tr.json';
import en from './en.json';

// i18next initial initialization (defaults to 'tr')
i18n
  .use(initReactI18next)
  .init({
    resources: {
      tr: { translation: tr },
      en: { translation: en },
    },
    lng: 'tr', // Default
    fallbackLng: 'tr',
    interpolation: {
      escapeValue: false,
    },
    compatibilityJSON: 'v4',
  });

/**
 * Loads the saved language from AsyncStorage and updates i18n.
 * Should be called in App.tsx.
 */
export const hydrateLanguage = async () => {
  try {
    const savedLanguage = await getItem(StorageKeys.LANGUAGE);
    if (savedLanguage) {
      await i18n.changeLanguage(savedLanguage);
    }
  } catch (e) {
    console.error('Failed to hydrate language', e);
  }
};

export const changeLanguage = async (lang: 'tr' | 'en') => {
  await i18n.changeLanguage(lang);
  await setItem(StorageKeys.LANGUAGE, lang);
};

export default i18n;
