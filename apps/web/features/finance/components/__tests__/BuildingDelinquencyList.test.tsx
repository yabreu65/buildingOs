import { fireEvent, render, screen } from '@testing-library/react';
import { BuildingDelinquencyList } from '../BuildingDelinquencyList';
import type { BuildingDelinquencyResponse } from '../../services/finance.api';

const replace = jest.fn();
const push = jest.fn();
const refetch = jest.fn();
const useBuildingDelinquencyMock = jest.fn();
let params = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => '/tenant-1/buildings/building-1/finance',
  useSearchParams: () => params,
}));

jest.mock('../../hooks/useBuildingDelinquency', () => ({
  useBuildingDelinquency: (...args: unknown[]) => useBuildingDelinquencyMock(...args),
}));

function buildData(overrides: Partial<BuildingDelinquencyResponse> = {}): BuildingDelinquencyResponse {
  return {
    items: Array.from({ length: 25 }, (_, index) => ({
      unitId: `unit-${index + 1}`,
      unitCode: `TS-01-${String(index + 1).padStart(2, '0')}`,
      unitLabel: `Apartamento ${index + 1}`,
      responsibleName: index === 0 ? 'Ana Pérez' : null,
      periodDebt: 6900000,
      accumulatedDebt: 75420000,
      overduePeriods: 4,
    })),
    page: 1,
    pageSize: 25,
    total: 96,
    totalPages: 4,
    totals: { periodDebt: 565800000, accumulatedDebt: 6426000000 },
    currency: 'ARS',
    ...overrides,
  };
}

function renderList() {
  return render(
    <BuildingDelinquencyList
      tenantId="tenant-1"
      buildingId="building-1"
      period="2026-07"
    />,
  );
}

describe('BuildingDelinquencyList', () => {
  beforeEach(() => {
    params = new URLSearchParams();
    replace.mockReset();
    push.mockReset();
    refetch.mockReset();
    useBuildingDelinquencyMock.mockReset();
    useBuildingDelinquencyMock.mockReturnValue({
      data: buildData(),
      isPending: false,
      isError: false,
      error: null,
      refetch,
    });
  });

  it('renders the complete page metadata without repeating the building column', () => {
    renderList();

    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('Mostrando 1–25 de 96 unidades')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Edificio' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Deuda del período' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Deuda acumulada' })).toBeTruthy();
  });

  it('requests the next server-side page', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));

    expect(replace).toHaveBeenCalledWith(
      '/tenant-1/buildings/building-1/finance?delinquencyPage=2',
      { scroll: false },
    );
  });

  it('resets pagination when the search changes', () => {
    params = new URLSearchParams('delinquencyPage=3');
    renderList();

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar por unidad o responsable' }), {
      target: { value: '07' },
    });

    expect(replace).toHaveBeenCalledWith(
      '/tenant-1/buildings/building-1/finance?delinquencySearch=07',
      { scroll: false },
    );
  });

  it('resets pagination when the aging filter changes', () => {
    params = new URLSearchParams('delinquencyPage=2');
    renderList();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por períodos vencidos' }), {
      target: { value: 'MORE_THAN_THREE_PERIODS' },
    });

    expect(replace).toHaveBeenCalledWith(
      '/tenant-1/buildings/building-1/finance?delinquencyAging=MORE_THAN_THREE_PERIODS',
      { scroll: false },
    );
  });

  it('uses an allowed server-side page size and resets pagination', () => {
    params = new URLSearchParams('delinquencyPage=3');
    renderList();

    fireEvent.change(screen.getByRole('combobox', { name: 'Resultados por página' }), {
      target: { value: '50' },
    });

    expect(replace).toHaveBeenCalledWith(
      '/tenant-1/buildings/building-1/finance?delinquencyPageSize=50',
      { scroll: false },
    );
  });

  it('navigates to the existing unit account with its finance tab selected', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: 'Ver cuenta de Apartamento 1' }));

    expect(push).toHaveBeenCalledWith('/tenant-1/buildings/building-1/units/unit-1?tab=finance');
  });

  it('shows the filtered empty state', () => {
    params = new URLSearchParams('delinquencySearch=ZZ');
    useBuildingDelinquencyMock.mockReturnValue({
      data: buildData({ items: [], total: 0, totalPages: 0 }),
      isPending: false,
      isError: false,
      error: null,
      refetch,
    });

    renderList();

    expect(screen.getByText('No encontramos unidades que coincidan con los filtros aplicados.')).toBeTruthy();
  });

  it('keeps an error visible and allows an explicit retry', () => {
    useBuildingDelinquencyMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('Network failed'),
      refetch,
    });

    renderList();

    expect(screen.getByText('No pudimos cargar la morosidad. Intenta nuevamente.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
