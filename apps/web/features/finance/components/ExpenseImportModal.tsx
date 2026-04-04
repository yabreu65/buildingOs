'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import Card from '@/shared/components/ui/Card';
import Button from '@/shared/components/ui/Button';
import { Skeleton } from '@/shared/components/ui';
import { cn } from '@/shared/lib/utils';
import { apiClient } from '@/shared/lib/http/client';

interface ImportRow {
  fecha: string;
  descripcion: string;
  monto: number;
  moneda: string;
  edificio: string;
  categoria: string;
  proveedor?: string;
}

interface ImportResult {
  totalRows: number;
  successCount: number;
  failureCount: number;
  createdExpenses: string[];
  errors: { rowIndex: number; reason: string }[];
}

interface Props {
  tenantId: string;
  period: string;
  isOpen: boolean;
  onClose: () => void;
  buildingNames?: string[];
  categoryNames?: string[];
}

export function ExpenseImportModal({
  tenantId,
  period,
  isOpen,
  onClose,
  buildingNames = [],
  categoryNames = [],
}: Props) {
  const [step, setStep] = useState<'file' | 'preview' | 'result'>('file');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const downloadTemplate = () => {
    const exampleData: ImportRow[] = [
      {
        fecha: '01/02/2026',
        descripcion: 'Ejemplo: Electricidad febrero',
        monto: 6831.19,
        moneda: 'VES',
        edificio: buildingNames[0] || 'Torre A',
        categoria: categoryNames[0] || 'Electricidad',
        proveedor: 'CORPOELEC',
      },
      {
        fecha: '05/02/2026',
        descripcion: 'Ejemplo: Servicios de agua',
        monto: 100.5,
        moneda: 'USD',
        edificio: buildingNames[0] || 'Torre A',
        categoria: categoryNames[1] || 'Agua',
        proveedor: '',
      },
    ];

    // Headers
    const headers = ['Fecha', 'Descripción', 'Monto', 'Moneda', 'Edificio', 'Categoría', 'Proveedor'];

    // Convert to sheet data
    const sheetData = [
      headers,
      ...exampleData.map((row) => [
        row.fecha,
        row.descripcion,
        row.monto,
        row.moneda,
        row.edificio,
        row.categoria,
        row.proveedor || '',
      ]),
    ];

    try {
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Gastos');
      XLSX.writeFile(wb, `gastos-${period}.xlsx`);
    } catch (err) {
      console.error('Error al generar template:', err);
      alert('Error al descargar el template');
    }
  };

  const importMutation = useMutation({
    mutationFn: () =>
      apiClient<ImportResult, { period: string; rows: ImportRow[] }>({
        path: `/tenants/${tenantId}/finance/expenses/import/from-excel`,
        method: 'POST',
        body: { period, rows },
      }),
    onSuccess: (data) => {
      setResult(data);
      setStep('result');
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
    },
  });

  const handleFileUpload = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Convertir a JSON manteniendo los encabezados de la primera fila
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      // Primera fila = encabezados
      if (data.length < 2) {
        alert('El archivo debe tener encabezados y al menos una fila de datos');
        return;
      }

      const headers = (data[0] as (string | number | undefined)[])
        .map((h) => String(h ?? '').toLowerCase().trim());
      const parsedRows: ImportRow[] = [];

      for (let i = 1; i < data.length; i++) {
        const row = data[i] as (string | number | undefined)[];
        const obj: Record<string, unknown> = {};

        headers.forEach((header, idx) => {
          const value = row[idx];
          // Convertir monto a número si es necesario
          if (header === 'monto' && (typeof value === 'string' || typeof value === 'number')) {
            obj[header] = typeof value === 'number' ? value : parseFloat(value);
          } else {
            obj[header] = value;
          }
        });

        // Validar que tenga los campos mínimos
        if (
          obj.fecha &&
          obj.descripcion &&
          obj.monto &&
          obj.moneda &&
          obj.edificio &&
          obj.categoria
        ) {
          parsedRows.push({
            fecha: String(obj.fecha),
            descripcion: String(obj.descripcion),
            monto: Number(obj.monto),
            moneda: String(obj.moneda),
            edificio: String(obj.edificio),
            categoria: String(obj.categoria),
            proveedor: obj.proveedor ? String(obj.proveedor) : undefined,
          });
        }
      }

      if (parsedRows.length === 0) {
        alert('No se encontraron filas válidas en el archivo');
        return;
      }

      setRows(parsedRows);
      setStep('preview');
    } catch (err) {
      alert('Error al leer el archivo: ' + (err instanceof Error ? err.message : 'desconocido'));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {step === 'file' && (
            <>
              <h2 className="text-lg font-semibold mb-4">Importar gastos desde Excel</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Preparate un Excel con las columnas: Fecha, Descripción, Monto, Moneda, Edificio, Categoría, Proveedor (opcional).
              </p>

              <div
                className={cn(
                  'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                  'hover:border-primary/50 hover:bg-primary/5',
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <p className="text-sm font-medium mb-1">Click para elegir archivo o arrastralo aquí</p>
                <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />

              <div className="flex gap-3 mt-6">
                <Button variant="secondary" onClick={onClose}>
                  Cancelar
                </Button>
                <Button onClick={downloadTemplate}>
                  Descargar template (Excel)
                </Button>
              </div>
            </>
          )}

          {step === 'preview' && (
            <>
              <h2 className="text-lg font-semibold mb-4">
                Vista previa: {rows.length} gastos a importar
              </h2>
              <p className="text-sm text-muted-foreground mb-4">Período: {period}</p>

              <div className="overflow-x-auto mb-6">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                      <th className="text-left px-3 py-2 font-semibold">Descripción</th>
                      <th className="text-right px-3 py-2 font-semibold">Monto</th>
                      <th className="text-left px-3 py-2 font-semibold">Moneda</th>
                      <th className="text-left px-3 py-2 font-semibold">Edificio</th>
                      <th className="text-left px-3 py-2 font-semibold">Categoría</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 text-xs">{row.fecha}</td>
                        <td className="px-3 py-2 text-xs truncate max-w-[200px]">{row.descripcion}</td>
                        <td className="px-3 py-2 text-right text-xs">{row.monto}</td>
                        <td className="px-3 py-2 text-xs">{row.moneda}</td>
                        <td className="px-3 py-2 text-xs">{row.edificio}</td>
                        <td className="px-3 py-2 text-xs">{row.categoria}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {rows.length > 10 && (
                <p className="text-xs text-muted-foreground mb-4">
                  Mostrando 10 de {rows.length} gastos...
                </p>
              )}

              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep('file');
                    setRows([]);
                  }}
                >
                  Volver
                </Button>
                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending}
                >
                  {importMutation.isPending ? 'Importando...' : 'Confirmar importación'}
                </Button>
              </div>
            </>
          )}

          {step === 'result' && result && (
            <>
              <h2 className="text-lg font-semibold mb-4">Resultado de importación</h2>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <Card className="p-4 bg-green-50 border-green-200">
                  <p className="text-sm text-muted-foreground">Exitosos</p>
                  <p className="text-2xl font-bold text-green-700">{result.successCount}</p>
                </Card>
                <Card className="p-4 bg-red-50 border-red-200">
                  <p className="text-sm text-muted-foreground">Con error</p>
                  <p className="text-2xl font-bold text-red-700">{result.failureCount}</p>
                </Card>
              </div>

              {result.errors.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-semibold text-sm mb-2">Errores</h3>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-40 overflow-y-auto">
                    {result.errors.map((err, idx) => (
                      <p key={idx} className="text-xs text-red-700 mb-1">
                        <strong>Fila {err.rowIndex}:</strong> {err.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={onClose}>Cerrar</Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
