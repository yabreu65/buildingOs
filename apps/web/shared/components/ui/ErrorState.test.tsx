/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it('renders the error message', () => {
    render(<ErrorState message="Something failed" />);
    expect(screen.getByText('Something failed')).toBeTruthy();
  });

  it('renders the title', () => {
    render(<ErrorState message="Error" />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('applies dark mode classes on the card container', () => {
    const { container } = render(<ErrorState message="Error" />);
    const card = container.querySelector('.dark\\:border-red-900\\/60');
    expect(card).toBeTruthy();
  });

  it('applies dark mode classes on the icon', () => {
    const { container } = render(<ErrorState message="Error" />);
    const icon = container.querySelector('.dark\\:text-red-400');
    expect(icon).toBeTruthy();
  });

  it('applies dark mode classes on the title', () => {
    const { container } = render(<ErrorState message="Error" />);
    const title = container.querySelector('.dark\\:text-red-100');
    expect(title).toBeTruthy();
  });

  it('applies dark mode classes on the message', () => {
    const { container } = render(<ErrorState message="Error" />);
    const message = container.querySelector('.dark\\:text-red-200');
    expect(message).toBeTruthy();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState message="Error" />);
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: /try again/i });
    expect(button).toBeTruthy();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} />);
    const button = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Retrying... text and disables button when isRetrying is true', () => {
    const onRetry = jest.fn();
    render(<ErrorState message="Error" onRetry={onRetry} isRetrying />);
    const button = screen.getByRole('button', { name: /retrying/i });
    expect(button).toBeTruthy();
    expect(button.getAttribute('disabled')).not.toBeNull();
  });
});
