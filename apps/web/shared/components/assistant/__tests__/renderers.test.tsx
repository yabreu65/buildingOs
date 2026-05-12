/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AssistantTextResponse,
  AssistantTableResponse,
  AssistantKpiResponse,
  AssistantClarificationResponse,
  AssistantActionListResponse,
  AssistantResponseRenderer,
} from '../renderers';

describe('AssistantTextResponse', () => {
  it('renders text content', () => {
    const { container } = render(<AssistantTextResponse content="Hello, World!" />);
    expect(container.querySelector('p')?.textContent).toBe('Hello, World!');
  });

  it('preserves whitespace in content', () => {
    const { container } = render(<AssistantTextResponse content="Line 1\nLine 2" />);
    expect(container.querySelector('p')?.textContent).toContain('Line 1');
  });
});

describe('AssistantTableResponse', () => {
  const mockData = [
    { Name: 'John', Age: 30 },
    { Name: 'Jane', Age: 25 },
  ];

  it('renders table with data', () => {
    const { container } = render(<AssistantTableResponse data={mockData} />);
    const table = container.querySelector('table');
    expect(table).toBeTruthy();
    expect(table?.textContent).toContain('John');
    expect(table?.textContent).toContain('Jane');
  });

  it('renders with custom columns', () => {
    const { container } = render(<AssistantTableResponse data={mockData} columns={['Name']} />);
    const table = container.querySelector('table');
    expect(table?.textContent).toContain('Name');
    expect(table?.textContent).not.toContain('Age');
  });

  it('shows empty message when no data', () => {
    const { container } = render(<AssistantTableResponse data={[]} />);
    expect(container.textContent).toContain('No data available');
  });
});

describe('AssistantKpiResponse', () => {
  it('renders KPI with title, value, and subtitle', () => {
    const { container } = render(
      <AssistantKpiResponse title="Total Debt" value="$10,000" subtitle="As of May 2026" />
    );
    expect(container.textContent).toContain('Total Debt');
    expect(container.textContent).toContain('$10,000');
    expect(container.textContent).toContain('As of May 2026');
  });

  it('renders without subtitle', () => {
    const { container } = render(<AssistantKpiResponse title="Count" value={42} />);
    expect(container.textContent).toContain('Count');
    expect(container.textContent).toContain('42');
  });

  it('handles numeric value', () => {
    const { container } = render(<AssistantKpiResponse title="Users" value={100} />);
    expect(container.textContent).toContain('100');
  });
});

describe('AssistantClarificationResponse', () => {
  it('renders message and options', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <AssistantClarificationResponse
        message="Which building?"
        options={[
          { label: 'Torre A', value: 'building-a' },
          { label: 'Torre B', value: 'building-b' },
        ]}
        onSelect={onSelect}
      />
    );

    expect(container.textContent).toContain('Which building?');
    expect(container.textContent).toContain('Torre A');
    expect(container.textContent).toContain('Torre B');
  });

  it('calls onSelect with correct value when option clicked', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <AssistantClarificationResponse
        message="Which building?"
        options={[
          { label: 'Torre A', value: 'building-a' },
          { label: 'Torre B', value: 'building-b' },
        ]}
        onSelect={onSelect}
      />
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith('building-a');
  });
});

describe('AssistantActionListResponse', () => {
  it('renders action buttons', () => {
    const onAction = jest.fn();
    const { container } = render(
      <AssistantActionListResponse
        actions={[
          { label: 'View Details', action: 'view-details' },
          { label: 'Edit', action: 'edit' },
        ]}
        onAction={onAction}
      />
    );

    expect(container.textContent).toContain('View Details');
    expect(container.textContent).toContain('Edit');
  });

  it('calls onAction with correct action and payload when clicked', () => {
    const onAction = jest.fn();
    const { container } = render(
      <AssistantActionListResponse
        actions={[
          { label: 'View Details', action: 'view-details', payload: { id: '123' } },
        ]}
        onAction={onAction}
      />
    );

    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledWith('view-details', { id: '123' });
  });
});

describe('AssistantResponseRenderer', () => {
  it('dispatches text type to AssistantTextResponse', () => {
    const { container } = render(
      <AssistantResponseRenderer response={{ type: 'text', title: '', summary: 'Hello text' }} />
    );
    expect(container.textContent).toContain('Hello text');
  });

  it('dispatches table type to AssistantTableResponse', () => {
    const data = [{ Name: 'Test' }];
    const { container } = render(
      <AssistantResponseRenderer response={{ type: 'table', title: '', summary: '', data }} />
    );
    expect(container.textContent).toContain('Name');
  });

  it('dispatches kpi type to AssistantKpiResponse', () => {
    const { container } = render(
      <AssistantResponseRenderer response={{ type: 'kpi', title: 'Total', summary: '100' }} />
    );
    expect(container.textContent).toContain('Total');
    expect(container.textContent).toContain('100');
  });

  it('dispatches clarification type with onClarificationSelect', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <AssistantResponseRenderer
        response={{
          type: 'clarification',
          title: '',
          summary: 'Which one?',
          data: [{ label: 'A', value: 'a' }],
        }}
        onClarificationSelect={onSelect}
      />
    );
    expect(container.textContent).toContain('Which one?');
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('dispatches action_list type with onAction', () => {
    const onAction = jest.fn();
    const { container } = render(
      <AssistantResponseRenderer
        response={{
          type: 'action_list',
          title: '',
          summary: '',
          actions: [{ label: 'Go', action: 'go-action' }],
        }}
        onAction={onAction}
      />
    );
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledWith('go-action', undefined);
  });

  it('defaults to text for unknown types', () => {
    const { container } = render(
      <AssistantResponseRenderer
        response={{ type: 'unknown' as any, title: '', summary: 'Default text' }}
      />
    );
    expect(container.textContent).toContain('Default text');
  });
});
