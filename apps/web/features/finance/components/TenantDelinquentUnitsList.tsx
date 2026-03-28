'use client';

import Card from '@/shared/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/shared/components/ui/Table';
import EmptyState from '@/shared/components/ui/EmptyState';
import Skeleton from '@/shared/components/ui/Skeleton';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface TenantDelinquentUnitsListProps {
  delinquent: Array<{
    unitId: string;
    unitLabel: string;
    buildingId: string;
    buildingName: string;
    outstanding: number;
  }>;
  loading: boolean;
}

export const TenantDelinquentUnitsList = ({ delinquent, loading }: TenantDelinquentUnitsListProps) => {
  if (!loading && delinquent.length === 0) {
    return (
      <div className="bg-green-50 border-l-4 border-green-500 p-6">
        <div className="flex items-center space-x-3">
          <AlertCircle className="w-8 h-8 text-green-600" />
          <div>
            <p className="font-medium text-green-800">Excelente</p>
            <p className="text-sm text-green-600">Todas las unidades están al día</p>
          </div>
        </div>
      </div>
    );
  }

  // Sort by outstanding amount descending to show highest debt first
  const sortedDelinquent = [...delinquent].sort((a, b) => b.outstanding - a.outstanding);

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-800">Unidades con deuda pendiente</h2>
        <p className="text-sm text-gray-600">
          {delinquent.length} unidad{delinquent.length !== 1 ? 's' : ''} requiere atención
        </p>
      </div>
      
      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-3 py-2">
              <Skeleton className="w-20 h-20 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Table className="min-w-full divide-y divide-gray-200">
          <THead className="bg-gray-50">
            <TR>
              <TH className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Unidad
              </TH>
              <TH className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Edificio
              </TH>
              <TH className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Deuda Pendiente
              </TH>
              <TH className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Acción
              </TH>
            </TR>
          </THead>
          <TBody className="bg-white divide-y divide-gray-200">
            {sortedDelinquent.map((item, index) => (
              <TR key={item.unitId} className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-gray-100`}>
                <TD className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                  {item.unitLabel || item.unitId}
                </TD>
                <TD className="px-6 py-4 text-left text-sm font-medium text-gray-700">
                  {item.buildingName || '-'}
                </TD>
                <TD className="px-6 py-4 text-right text-sm font-medium">
                  <div className="flex items-center">
                    <div className="w-8 h-8 mr-2">
                      <TrendingUp className="text-red-600" />
                    </div>
                    <span className="font-semibold text-red-600">
                      {new Intl.NumberFormat('es-AR', {
                        style: 'currency',
                        currency: 'ARS',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(item.outstanding)}
                    </span>
                  </div>
                </TD>
                <TD className="px-6 py-4 text-center text-sm space-x-2">
                  <button
                    className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100"
                  >
                    Ver detalle
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
};
