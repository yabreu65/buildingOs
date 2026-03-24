/**
 * Storage library exports.
 * Provides centralized localStorage management with validation and event handling.
 */

// Core service
export { StorageService } from './storage.service';

// Validation and normalization
export {
  safeParseArray,
  safeParseObject,
  normalize,
  isValidString,
  isValidArray,
  hasRequiredKeys,
  isValidEmail,
  isValidUUID,
  isInRange,
} from './storage.validation';

// Events and hooks
export { emitBoStorageChange, subscribeBoStorageChange, BO_STORAGE_EVENT } from './events';
export { useBoStorageTick } from './useBoStorage';
