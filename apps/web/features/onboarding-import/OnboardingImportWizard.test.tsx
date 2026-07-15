import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createMockTenant } from '@/shared/testing/create-mock-tenant';
import { createMockUser } from '@/shared/testing/create-mock-user';
import { renderWithProviders } from '@/shared/testing/render-with-providers';
import { OnboardingImportWizard } from './OnboardingImportWizard';

const mockUpload = jest.fn();
const mockPreview = jest.fn();
const mockConfirm = jest.fn();

jest.mock('./onboarding-import.api', () => ({
  onboardingImportApi: {
    previewImport: (...args: unknown[]) => mockPreview(...args),
    confirmImport: (...args: unknown[]) => mockConfirm(...args),
    uploadImportFile: (...args: unknown[]) => mockUpload(...args),
  },
}));

describe('OnboardingImportWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the onboarding import flow', () => {
    render(
      renderWithProviders(<OnboardingImportWizard />, {
        tenant: createMockTenant(),
        user: createMockUser(),
      }),
    );

    expect(screen.getByRole('heading', { name: /onboarding import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload file/i })).toBeInTheDocument();
  });

  it('shows preview data after upload', async () => {
    mockUpload.mockResolvedValue({
      jobId: 'job-1',
      rows: [{ email: 'user@example.com', firstName: 'User', lastName: 'Example', apartment: '101' }],
      warnings: [],
    });

    render(
      renderWithProviders(<OnboardingImportWizard />, {
        tenant: createMockTenant(),
        user: createMockUser(),
      }),
    );

    await userEvent.upload(screen.getByLabelText(/file/i), new File(['a,b'], 'imports.csv', { type: 'text/csv' }));
    await userEvent.click(screen.getByRole('button', { name: /upload file/i }));

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalled();
      expect(screen.getByText('user@example.com')).toBeInTheDocument();
    });
  });
});
