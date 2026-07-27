import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContextSelector } from './ContextSelector';
import type { ContextOption, UserContext } from '../context.types';

describe('ContextSelector', () => {
  it('auto-selects the first unit when changing building with the resident mode enabled', async () => {
    const context: UserContext = {
      tenantId: 'tenant-1',
      activeBuildingId: 'building-1',
      activeUnitId: 'unit-1',
    };

    const options: ContextOption[] = [
      { id: 'building-1', name: 'Edificio A' },
      { id: 'building-2', name: 'Edificio B' },
    ];

    const unitsByBuilding = {
      'building-1': [
        { id: 'unit-1', label: 'A-01' },
        { id: 'unit-2', label: 'A-02' },
      ],
      'building-2': [
        { id: 'unit-3', label: 'B-01' },
        { id: 'unit-4', label: 'B-02' },
      ],
    };

    const onBuildingChange = jest.fn().mockResolvedValue(undefined);
    const onUnitChange = jest.fn().mockResolvedValue(undefined);

    render(
      <ContextSelector
        tenantId="tenant-1"
        context={context}
        options={options}
        unitsByBuilding={unitsByBuilding}
        onBuildingChange={onBuildingChange}
        onUnitChange={onUnitChange}
        autoSelectFirstUnitOnBuildingChange
      />,
    );

    expect(screen.getByLabelText('Edificio')).toBeTruthy();
    expect(screen.getByLabelText('Unidad')).toBeTruthy();
    expect(screen.getByText('Todos los edificios')).toBeTruthy();
    expect(screen.getByText('Todas las unidades')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Edificio'), {
      target: { value: 'building-2' },
    });

    await waitFor(() => {
      expect(onBuildingChange).toHaveBeenCalledWith('building-2');
      expect(onUnitChange).toHaveBeenCalledWith('building-2', 'unit-3');
    });
  });

  it('keeps mobile controls contained and preserves callbacks with long labels', async () => {
    const onBuildingChange = jest.fn().mockResolvedValue(undefined);
    const onUnitChange = jest.fn().mockResolvedValue(undefined);
    const longBuildingName = 'Edificio Residencial con una denominación muy larga para una pantalla móvil';

    const { container } = render(
      <ContextSelector
        tenantId="tenant-1"
        context={{ tenantId: 'tenant-1', activeBuildingId: 'building-1', activeUnitId: 'unit-1' }}
        options={[{ id: 'building-1', name: longBuildingName }, { id: 'building-2', name: 'Edificio B' }]}
        unitsByBuilding={{
          'building-1': [{ id: 'unit-1', label: 'Unidad con una referencia extensa para móvil' }],
          'building-2': [{ id: 'unit-2', label: 'B-01' }],
        }}
        onBuildingChange={onBuildingChange}
        onUnitChange={onUnitChange}
      />,
    );

    const root = container.firstElementChild;
    const buildingSelect = screen.getByLabelText('Edificio');
    const unitSelect = screen.getByLabelText('Unidad');

    expect(root?.className).toContain('min-w-0');
    expect(root?.className).toContain('sm:flex-row');
    expect(buildingSelect.className).toContain('w-full');
    expect(buildingSelect.className).toContain('min-h-11');
    expect(unitSelect.className).toContain('w-full');
    const longUnitLabel = 'Unidad con una referencia extensa para móvil';
    const unitSummary = container.querySelector(`[title="${longUnitLabel}"]`);

    expect(container.querySelector(`[title="${longBuildingName}"]`)?.getAttribute('title')).toBe(longBuildingName);
    expect(unitSummary?.className).toContain('truncate');
    expect(unitSummary?.className).toContain('min-w-0');
    expect(unitSummary?.className).not.toContain('shrink-0');
    expect(unitSummary?.textContent).toBe(longUnitLabel);

    fireEvent.change(unitSelect, { target: { value: 'unit-1' } });

    await waitFor(() => {
      expect(onUnitChange).toHaveBeenCalledWith('building-1', 'unit-1');
    });
  });
});
