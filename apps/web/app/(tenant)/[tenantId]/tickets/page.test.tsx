/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { useParams } from 'next/navigation';
import TicketsIndexPage from './page';
import * as buildingsHooks from '@/features/buildings/hooks';

jest.mock('next/navigation', () => ({
  useParams: jest.fn(),
}));

jest.mock('@/features/buildings/hooks', () => ({
  useBuildings: jest.fn(),
}));

const mockedUseParams = jest.mocked(useParams);
const mockedUseBuildings = jest.mocked(buildingsHooks.useBuildings);

describe('TicketsIndexPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseParams.mockReturnValue({ tenantId: 'tenant-1' } as never);
    mockedUseBuildings.mockReturnValue({
      buildings: [
        { id: 'building-1', name: 'Building One', address: 'Main 123' },
      ],
      loading: false,
      error: null,
      refetch: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as never);
  });

  it('renders the building selector and keeps support separate', () => {
    render(<TicketsIndexPage />);

    expect(mockedUseBuildings).toHaveBeenCalledWith('tenant-1');
    expect(screen.getByText('Tickets y reclamos')).toBeTruthy();
    expect(screen.getByText('Building One')).toBeTruthy();
    expect(screen.getByRole('link', { name: /abrir/i }).getAttribute('href')).toBe('/tenant-1/buildings/building-1/tickets');
    expect(screen.getByText('/support')).toBeTruthy();
  });
});
