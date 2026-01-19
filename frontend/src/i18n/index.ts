import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import { getDefaultLanguage, getStoredLanguage, setStoredLanguage } from "../utils/preferences";
import { SUPPORTED_LANGUAGES, type Language } from "./languages";

const initialLanguage = getStoredLanguage() ?? getDefaultLanguage();
const fallbackLanguage: Language = "fr";

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    es: { translation: es },
  },
  lng: initialLanguage,
  fallbackLng: fallbackLanguage,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  if (SUPPORTED_LANGUAGES.includes(language as Language)) {
    setStoredLanguage(language as Language);
  }
});

export default i18n;
