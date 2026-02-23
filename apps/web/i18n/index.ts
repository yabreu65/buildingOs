/**
 * i18n Module for BuildingOS
 * Centralized translation system with support for multiple languages
 * Default language: es-419 (Spanish LATAM)
 *
 * Usage:
 *   import { t } from '@/i18n'
 *   t('common.save') => "Guardar"
 *   t('common.save', { ns: 'en' }) => "Save"
 */

import es419 from './es-419.json';
import en from './en.json';

// Type definitions
export type Language = 'es-419' | 'en';
export type TranslationNamespace = typeof es419;

interface TranslateOptions {
  lang?: Language;
  ns?: Language; // Alias for lang (for clarity)
  fallback?: string;
}

// Translation store
const translations: Record<Language, TranslationNamespace> = {
  'es-419': es419,
  'en': en as TranslationNamespace,
};

// Default language
const DEFAULT_LANGUAGE: Language = 'es-419';

/**
 * Translate a key using dot notation
 *
 * @param key - Translation key using dot notation (e.g., "common.save")
 * @param options - Options: { lang?: 'es-419'|'en', fallback?: string }
 * @returns Translated string or fallback
 *
 * @example
 *   t('common.save') // "Guardar" (default es-419)
 *   t('common.save', { lang: 'en' }) // "Save"
 *   t('nonexistent.key', { fallback: 'N/A' }) // "N/A"
 */
export function t(key: string, options: TranslateOptions = {}): string {
  const lang = options.lang || options.ns || DEFAULT_LANGUAGE;
  const fallback = options.fallback || key;

  try {
    // Navigate through the translation object using dot notation
    const keys = key.split('.');
    let value: any = translations[lang];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // Key not found in target language
        console.warn(`[i18n] Missing translation: ${key} for language ${lang}`);

        // Try to fallback to default language if not already using it
        if (lang !== DEFAULT_LANGUAGE) {
          let fallbackValue: any = translations[DEFAULT_LANGUAGE];
          for (const k of keys) {
            if (fallbackValue && typeof fallbackValue === 'object' && k in fallbackValue) {
              fallbackValue = fallbackValue[k];
            } else {
              return fallback;
            }
          }
          if (typeof fallbackValue === 'string') {
            return fallbackValue;
          }
        }

        return fallback;
      }
    }

    // Ensure we return a string
    if (typeof value === 'string') {
      return value;
    }

    console.warn(`[i18n] Translation key ${key} is not a string`);
    return fallback;
  } catch (error) {
    console.error(`[i18n] Error translating key ${key}:`, error);
    return fallback;
  }
}

/**
 * Get all translations for a specific language
 *
 * @param lang - Language code (defaults to 'es-419')
 * @returns Complete translation object
 */
export function getTranslations(lang: Language = DEFAULT_LANGUAGE): TranslationNamespace {
  return translations[lang];
}

/**
 * Check if a language is supported
 */
export function isSupportedLanguage(lang: any): lang is Language {
  return lang === 'es-419' || lang === 'en';
}

/**
 * Get supported languages
 */
export function getSupportedLanguages(): Language[] {
  return ['es-419', 'en'];
}

/**
 * Get the default language
 */
export function getDefaultLanguage(): Language {
  return DEFAULT_LANGUAGE;
}

/**
 * Create a scoped translator for a specific namespace
 *
 * @param namespace - Namespace prefix (e.g., "superAdmin.leads")
 * @param lang - Optional language override
 * @returns Translator function for that namespace
 *
 * @example
 *   const tLeads = createScopedTranslator('superAdmin.leads');
 *   tLeads('title') // "Prospectos"
 *   tLeads('create') // "Nuevo prospecto"
 */
export function createScopedTranslator(namespace: string, lang?: Language) {
  return (key: string, options: TranslateOptions = {}): string => {
    const fullKey = `${namespace}.${key}`;
    return t(fullKey, { ...options, lang: lang || options.lang });
  };
}

// Export as default
export default { t, getTranslations, isSupportedLanguage, getSupportedLanguages, getDefaultLanguage, createScopedTranslator };
