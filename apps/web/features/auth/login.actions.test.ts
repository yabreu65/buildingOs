import { logout } from './login.actions';
import { apiLogout } from './auth.service';
import { clearAuth } from './session.storage';
import { clearAllImpersonationData } from '../impersonation/impersonation.storage';

jest.mock('./auth.service', () => ({
  apiLogout: jest.fn(),
}));

jest.mock('./session.storage', () => ({
  clearAuth: jest.fn(),
}));

jest.mock('../impersonation/impersonation.storage', () => ({
  clearAllImpersonationData: jest.fn(),
}));

const mockedApiLogout = jest.mocked(apiLogout);
const mockedClearAuth = jest.mocked(clearAuth);
const mockedClearAllImpersonationData = jest.mocked(clearAllImpersonationData);

describe('login.actions.logout', () => {
  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    mockedApiLogout.mockReset();
    mockedClearAuth.mockReset();
    mockedClearAllImpersonationData.mockReset();
    consoleWarnSpy.mockClear();
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  it('calls apiLogout before clearing local state', async () => {
    mockedApiLogout.mockResolvedValue({ ok: true });

    await logout();

    expect(mockedApiLogout).toHaveBeenCalledTimes(1);
    expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
    expect(mockedClearAuth).toHaveBeenCalledTimes(1);
    expect(mockedApiLogout.mock.invocationCallOrder[0]).toBeLessThan(
      mockedClearAllImpersonationData.mock.invocationCallOrder[0],
    );
    expect(mockedClearAllImpersonationData.mock.invocationCallOrder[0]).toBeLessThan(
      mockedClearAuth.mock.invocationCallOrder[0],
    );
  });

  it('clears local state and warns when apiLogout fails', async () => {
    mockedApiLogout.mockRejectedValue(new Error('network down'));

    await expect(logout()).resolves.toBeUndefined();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(mockedClearAllImpersonationData).toHaveBeenCalledTimes(1);
    expect(mockedClearAuth).toHaveBeenCalledTimes(1);
  });
});
