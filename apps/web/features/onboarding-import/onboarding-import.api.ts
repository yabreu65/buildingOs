export const onboardingImportApi = {
  async previewImport(file: File) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/onboarding-imports/preview', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to preview import');
    }

    return response.json();
  },

  async confirmImport(jobId: string) {
    const response = await fetch(`/api/onboarding-imports/${jobId}/confirm`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to confirm import');
    }

    return response.json();
  },
};
