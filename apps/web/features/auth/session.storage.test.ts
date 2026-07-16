import { emitBoStorageChange } from '@/shared/lib/storage/events';
import { clearLastTenant, getLastTenant, setLastTenant } from './session.storage';

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
});
