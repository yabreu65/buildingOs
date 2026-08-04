/**
 * @jest-environment jsdom
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BankingUI from './banking.ui';
import { addBankAccount, listBankAccounts, removeBankAccount } from './banking.storage';
import type { BankAccount } from './banking.types';

let accountsByTenant: Record<string, BankAccount[]> = {};

jest.mock('./banking.storage', () => ({
  listBankAccounts: jest.fn(),
  addBankAccount: jest.fn(),
  removeBankAccount: jest.fn(),
}));

jest.mock('@/shared/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

jest.mock('@/shared/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

jest.mock('@/shared/components/ui/Input', () => ({
  __esModule: true,
  default: (() => {
    const React = jest.requireActual('react') as typeof import('react');
    const MockInput = React.forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => <input ref={ref} {...props} />,
    );
    MockInput.displayName = 'MockInput';
    return MockInput;
  })(),
}));

jest.mock('@/shared/components/ui/Table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
}));

const mockedListBankAccounts = jest.mocked(listBankAccounts);
const mockedAddBankAccount = jest.mocked(addBankAccount);
const mockedRemoveBankAccount = jest.mocked(removeBankAccount);

describe('BankingUI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountsByTenant = {
      'tenant-a': [
        {
          id: 'acc-a-1',
          bankName: 'Banco A',
          accountHolder: 'Consorcio A',
          accountNumber: '111',
          notes: 'Tenant A',
          createdAt: '2026-08-04T00:00:00.000Z',
        },
      ],
      'tenant-b': [
        {
          id: 'acc-b-1',
          bankName: 'Banco B',
          accountHolder: 'Consorcio B',
          accountNumber: '222',
          notes: 'Tenant B',
          createdAt: '2026-08-04T00:00:00.000Z',
        },
      ],
    };

    mockedListBankAccounts.mockImplementation((tenantId: string) => accountsByTenant[tenantId] ?? []);
    mockedAddBankAccount.mockImplementation(
      (tenantId: string, account: Omit<BankAccount, 'id' | 'createdAt'>) => {
        const newAccount: BankAccount = {
          ...account,
          id: `${tenantId}-new`,
          createdAt: '2026-08-04T00:00:00.000Z',
        };

        accountsByTenant[tenantId] = [...(accountsByTenant[tenantId] ?? []), newAccount];
        window.dispatchEvent(new Event('bo:storage'));
        return newAccount;
      },
    );
    mockedRemoveBankAccount.mockImplementation((tenantId: string, id: string) => {
      accountsByTenant[tenantId] = (accountsByTenant[tenantId] ?? []).filter(
        (account) => account.id !== id,
      );
      window.dispatchEvent(new Event('bo:storage'));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists accounts for the provided tenant only', () => {
    render(<BankingUI tenantId="tenant-a" />);

    expect(mockedListBankAccounts).toHaveBeenCalledWith('tenant-a');
    expect(screen.getByText('Banco A')).not.toBeNull();
    expect(screen.queryByText('Banco B')).toBeNull();
  });

  it('creates an account for the provided tenant', async () => {
    render(<BankingUI tenantId="tenant-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'Nueva Cuenta' }));
    fireEvent.change(screen.getByPlaceholderText('Ej: Banco Nacional'), {
      target: { value: 'Banco Nuevo' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ej: Consorcio Torre A'), {
      target: { value: 'Consorcio Nuevo' },
    });
    fireEvent.change(screen.getByPlaceholderText('0000...'), {
      target: { value: '999' },
    });
    fireEvent.change(screen.getByPlaceholderText('Cuenta principal...'), {
      target: { value: 'Cuenta de prueba' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Cuenta' }));

    await waitFor(() => {
      expect(mockedAddBankAccount).toHaveBeenCalledWith('tenant-a', {
        bankName: 'Banco Nuevo',
        accountHolder: 'Consorcio Nuevo',
        accountNumber: '999',
        notes: 'Cuenta de prueba',
      });
    });

    expect(screen.getByText('Banco Nuevo')).not.toBeNull();
  });

  it('deletes an account for the provided tenant', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<BankingUI tenantId="tenant-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => {
      expect(mockedRemoveBankAccount).toHaveBeenCalledWith('tenant-a', 'acc-a-1');
    });

    await waitFor(() => {
      expect(screen.queryByText('Banco A')).toBeNull();
    });
  });

  it('remounts cleanly when the tenant prop changes from A to B', () => {
    const { rerender } = render(<BankingUI tenantId="tenant-a" />);

    expect(screen.getByText('Banco A')).not.toBeNull();

    rerender(<BankingUI tenantId="tenant-b" />);

    expect(mockedListBankAccounts).toHaveBeenCalledWith('tenant-b');
    expect(screen.getByText('Banco B')).not.toBeNull();
    expect(screen.queryByText('Banco A')).toBeNull();
  });
});
