import { emitBoStorageChange } from '@/shared/lib/storage/events';
import {
  clearAuth,
  clearLastPortal,
  clearLastTenant,
  getLastPortal,
  getLastTenant,
  setLastPortal,
  setLastTenant,
} from './session.storage';

jest.mock('@/shared/lib/storage/events', () => ({
  emitBoStorageChange: jest.fn(),
}));

const mockedEmitBoStorageChange = jest.mocked(emitBoStorageChange);

describe('session.storage', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedEmitBoStorageChange.mockReset();
  });

  it('does not emit a storage change when setting the same last tenant twice', () => {
    setLastTenant('tenant-a');

    expect(getLastTenant()).toBe('tenant-a');
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(1);

    setLastTenant('tenant-a');

    expect(getLastTenant()).toBe('tenant-a');
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(1);
  });

  it('emits a storage change when the last tenant changes', () => {
    setLastTenant('tenant-a');
    setLastTenant('tenant-b');

    expect(getLastTenant()).toBe('tenant-b');
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(2);
  });

  it('clears the last tenant key and emits a storage change', () => {
    setLastTenant('tenant-a');
    clearLastTenant();

    expect(getLastTenant()).toBeNull();
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(2);
  });

  it('stores, reads, and clears the last portal context', () => {
    setLastPortal('resident');

    expect(getLastPortal()).toBe('resident');
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(1);

    clearLastPortal();

    expect(getLastPortal()).toBeNull();
    expect(mockedEmitBoStorageChange).toHaveBeenCalledTimes(2);
  });

  it('removes the portal key when clearing auth state', () => {
    setLastPortal('admin');
    clearAuth();

    expect(getLastPortal()).toBeNull();
  });
});
