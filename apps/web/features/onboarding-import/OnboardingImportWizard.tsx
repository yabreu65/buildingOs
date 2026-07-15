'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';
import { onboardingImportApi } from './onboarding-import.api';

type WizardStep = 'upload' | 'preview' | 'confirm' | 'done';

export function OnboardingImportWizard() {
  const [step, setStep] = useState<WizardStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Array<{ email: string; firstName: string; lastName: string; apartment: string }>>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canUpload = useMemo(() => Boolean(file), [file]);

  const handlePreview = async () => {
    if (!file) {
      return;
    }

    setError(null);

    try {
      const response = await onboardingImportApi.previewImport(file);
      setJobId(response.jobId);
      setPreviewRows(response.rows);
      setWarnings(response.warnings);
      setStep('preview');
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Failed to preview import');
    }
  };

  const handleConfirm = async () => {
    if (!jobId) {
      return;
    }

    setError(null);

    try {
      await onboardingImportApi.confirmImport(jobId);
      setStep('done');
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to confirm import');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding Import</CardTitle>
        <CardDescription>Upload an Excel file to preview and confirm new tenants.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p role="alert">{error}</p> : null}
        {step === 'upload' ? (
          <div className="space-y-4">
            <Input aria-label="File" type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <Button disabled={!canUpload} onClick={handlePreview}>Upload file</Button>
          </div>
        ) : null}
        {step === 'preview' ? (
          <div className="space-y-4">
            {warnings.length ? <p>{warnings.length} warnings found</p> : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>First name</TableHead>
                  <TableHead>Last name</TableHead>
                  <TableHead>Apartment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row) => (
                  <TableRow key={row.email}>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{row.firstName}</TableCell>
                    <TableCell>{row.lastName}</TableCell>
                    <TableCell>{row.apartment}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Button onClick={handleConfirm}>Confirm import</Button>
          </div>
        ) : null}
        {step === 'done' ? <p>Import confirmed successfully.</p> : null}
      </CardContent>
    </Card>
  );
}
