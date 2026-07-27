/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('applies default variant classes', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge.className).toContain('bg-muted');
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('applies success variant classes', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-green-100');
    expect(badge.className).toContain('text-green-800');
    expect(badge.className).toContain('dark:bg-green-950/40');
    expect(badge.className).toContain('dark:text-green-300');
  });

  it('applies warning variant classes', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-amber-100');
    expect(badge.className).toContain('text-amber-800');
    expect(badge.className).toContain('dark:bg-amber-950/40');
    expect(badge.className).toContain('dark:text-amber-300');
  });

  it('applies danger variant classes', () => {
    render(<Badge variant="danger">Danger</Badge>);
    const badge = screen.getByText('Danger');
    expect(badge.className).toContain('bg-red-100');
    expect(badge.className).toContain('text-red-800');
    expect(badge.className).toContain('dark:bg-red-950/40');
    expect(badge.className).toContain('dark:text-red-300');
  });

  it('applies info variant classes', () => {
    render(<Badge variant="info">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-800');
    expect(badge.className).toContain('dark:bg-blue-950/40');
    expect(badge.className).toContain('dark:text-blue-300');
  });

  it('applies muted variant classes', () => {
    render(<Badge variant="muted">Muted</Badge>);
    const badge = screen.getByText('Muted');
    expect(badge.className).toContain('bg-muted');
    expect(badge.className).toContain('text-muted-foreground');
  });

  it('merges additional className without adding default variant classes', () => {
    render(<Badge className="extra-class">Extra</Badge>);
    const badge = screen.getByText('Extra');
    expect(badge.className).toContain('extra-class');
    expect(badge.className).toContain('inline-flex');
    expect(badge.className).not.toContain('bg-muted');
    expect(badge.className).not.toContain('text-muted-foreground');
  });

  it('does not add default variant classes when only className is provided (legacy behavior)', () => {
    render(<Badge className="bg-purple-100 text-purple-700">Legacy</Badge>);
    const badge = screen.getByText('Legacy');
    expect(badge.className).toContain('bg-purple-100');
    expect(badge.className).toContain('text-purple-700');
    expect(badge.className).not.toContain('bg-muted');
    expect(badge.className).not.toContain('text-muted-foreground');
    expect(badge.className).not.toContain('border-border');
  });

  it('applies variant classes and merges className when both are provided', () => {
    render(<Badge variant="info" className="whitespace-nowrap">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge.className).toContain('bg-blue-100');
    expect(badge.className).toContain('text-blue-800');
    expect(badge.className).toContain('dark:bg-blue-950/40');
    expect(badge.className).toContain('whitespace-nowrap');
  });

  it('renders as a span element', () => {
    render(<Badge>Span</Badge>);
    const badge = screen.getByText('Span');
    expect(badge.tagName).toBe('SPAN');
  });
});
