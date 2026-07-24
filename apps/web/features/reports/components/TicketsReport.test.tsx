/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TicketsReportComponent } from './TicketsReport';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('TicketsReportComponent', () => {
  it('links report tickets to the canonical ticket detail route', () => {
    render(
      <TicketsReportComponent
        tenantId="tenant-1"
        data={{
          byStatus: [],
          byPriority: [],
          topCategories: [],
          avgTimeToFirstResponseHours: 0,
          avgTimeToResolveHours: 0,
          tickets: [
            {
              id: 'ticket-1',
              title: 'Fuga de agua',
              description: 'Detalle',
              createdAt: '2025-01-01T00:00:00.000Z',
              status: 'OPEN',
              priority: 'MEDIUM',
              category: 'MAINTENANCE',
              buildingId: 'building-1',
              building: { id: 'building-1', name: 'Building One' },
              unitId: null,
              unit: null,
            },
          ],
        }}
        loading={false}
        error={null}
      />,
    );

    const link = screen.getByRole('link', { name: /ver reclamo fuga de agua/i });
    expect(link.getAttribute('href')).toBe('/tenant-1/tickets/ticket-1');
  });
});
