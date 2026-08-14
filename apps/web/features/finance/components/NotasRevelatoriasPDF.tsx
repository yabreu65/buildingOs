'use client';

import { useState } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
} from '@react-pdf/renderer';
import type {
  NotasRevelatoriasReport,
  ExpenseLineItem,
  BuildingExpenseSection,
  BuildingAlicuota,
} from '../services/expense-ledger.api';

// ── Styles ──────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 7,
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 35,
    color: '#000',
  },
  // Header
  headerTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 2 },
  headerSub: { fontSize: 8, textAlign: 'center', marginBottom: 2 },
  headerPeriod: { fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 10 },

  // Sections
  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 8, marginBottom: 2 },
  notaTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 4 },
  buildingTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', marginBottom: 2 },

  // Table
  table: { width: '100%', borderTop: '1px solid #000', marginBottom: 8 },
  headerRow: { flexDirection: 'row', borderBottom: '1px solid #000', backgroundColor: '#f0f0f0' },
  row: { flexDirection: 'row', borderBottom: '0.5px solid #ccc' },
  totalRow: { flexDirection: 'row', borderTop: '1px solid #000', borderBottom: '1px solid #000', backgroundColor: '#f0f0f0' },

  // Cells
  cell: { paddingVertical: 2, paddingHorizontal: 3 },
  cellBold: { paddingVertical: 2, paddingHorizontal: 3, fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },

  // Column widths — expense table
  colNum: { width: '4%' },
  colDate: { width: '7%' },
  colDesc: { width: '55%' },
  colUSD: { width: '11.3%', textAlign: 'right' },
  colVES: { width: '11.3%', textAlign: 'right' },
  colPesos: { width: '11.3%', textAlign: 'right' },

  // Income table columns
  colIncomeDesc: { width: '65%' },
  colIncomeUSD: { width: '11.6%', textAlign: 'right' },
  colIncomeVES: { width: '11.6%', textAlign: 'right' },
  colIncomePesos: { width: '11.6%', textAlign: 'right' },

  // Alícuota table
  colAliCat: { width: '30%' },
  colAliCoef: { width: '10%', textAlign: 'right' },
  colAliComunes: { width: '13%', textAlign: 'right' },
  colAliPropios: { width: '13%', textAlign: 'right' },
  colAliReserva: { width: '10%', textAlign: 'right' },
  colAliTotal: { width: '12%', textAlign: 'right' },
  colAliRecaudar: { width: '12%', textAlign: 'right' },

  observaciones: { marginTop: 10, fontSize: 6.5 },
  obsBold: { fontFamily: 'Helvetica-Bold', fontSize: 6.5 },
  spacer: { height: 6 },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(minor: number, currency: string): string {
  if (!minor) return '-';
  try {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return (minor / 100).toFixed(2) + ' ' + currency;
  }
}

const CURRENCY_LABEL: Record<string, string> = {
  USD: 'DÓLARES',
  VES: 'BOLÍVARES',
};

function currencyLabel(currency: string): string {
  return CURRENCY_LABEL[currency] ?? currency;
}

function bucketAmount(
  buckets: ReadonlyArray<{ currency: string; amountMinor: number }> | undefined,
  currency: string,
): number {
  return buckets?.find((b) => b.currency === currency)?.amountMinor ?? 0;
}

// Dynamic per-currency column widths: description keeps a base width, the
// remaining space is split among the currencies present.
function currencyCols(currencies: string[]): Array<{ currency: string; width: string }> {
  const per = Math.max(8, Math.floor((100 - 55) / Math.max(currencies.length, 1)));
  return currencies.map((currency) => ({ currency, width: per + '%' }));
}

function nextMonth(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, month, 1); // next month
  const months = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ── PDF Sub-components ────────────────────────────────────────────────────────

function PageHeader({ report }: { report: NotasRevelatoriasReport }) {
  return (
    <>
      <Text style={S.headerTitle}>NOTAS REVELATORIAS</Text>
      <Text style={S.headerSub}>{report.tenantName.toUpperCase()}</Text>
      <Text style={S.headerSub}>
        DESDE EL 01-{report.period.split('-')[1]}-{report.period.split('-')[0]}{' '}
        AL {lastDayOf(report.period)}-{report.period.split('-')[1]}-{report.period.split('-')[0]}
      </Text>
      <Text style={S.headerPeriod}>EXPRESADA DE DÓLARES AMERICANOS Y BOLIVARES</Text>
    </>
  );
}

function lastDayOf(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return String(new Date(y, m, 0).getDate());
}

function IncomeTable({ report }: { report: NotasRevelatoriasReport }) {
  return (
    <>
      <Text style={S.sectionTitle}>INGRESOS ORDINARIOS</Text>
      {report.buildingIncomes.map((building, idx) => {
        const currencies = building.totalByCurrency.map((b) => b.currency);
        const cols = currencyCols(currencies);
        return (
          <View key={building.buildingId}>
            <Text style={S.notaTitle}>NOTA NRO {idx + 1}</Text>
            <Text style={S.buildingTitle}>Ingresos {building.buildingName}</Text>
            <View style={S.table}>
              <View style={S.headerRow}>
                <Text style={[S.cellBold, S.colIncomeDesc]} />
                {cols.map((c) => (
                  <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }, S.center]}>
                    {currencyLabel(c.currency)}
                  </Text>
                ))}
              </View>
              {building.entries.map((entry, i) => (
                <View key={i} style={S.row}>
                  <Text style={[S.cell, S.colIncomeDesc]}>{entry.description}</Text>
                  {cols.map((c) => (
                    <Text key={c.currency} style={[S.cell, { width: c.width, textAlign: 'right' }]}>
                      {entry.currencyCode === c.currency ? fmt(entry.amountMinor, c.currency) : '-'}
                    </Text>
                  ))}
                </View>
              ))}
              <View style={S.totalRow}>
                <Text style={[S.cellBold, S.colIncomeDesc]}>Total de Ingresos {building.buildingName}</Text>
                {cols.map((c) => (
                  <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
                    {fmt(bucketAmount(building.totalByCurrency, c.currency), c.currency)}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </>
  );
}

function CommonExpensesTable({
  items,
  totals,
  startNota,
}: {
  items: ExpenseLineItem[];
  totals: { byCurrency: Array<{ currency: string; amountMinor: number }> };
  startNota: number;
}) {
  const currencies = totals.byCurrency.map((b) => b.currency);
  const cols = currencyCols(currencies);
  return (
    <>
      <Text style={S.sectionTitle}>GASTOS</Text>
      <Text style={S.sectionTitle}>GASTOS COMUNES</Text>
      <Text style={S.notaTitle}>NOTA NRO {startNota}</Text>
      <View style={S.table}>
        <View style={S.headerRow}>
          <Text style={[S.cellBold, S.colNum, S.center]}>#</Text>
          <Text style={[S.cellBold, S.colDate, S.center]}>FECHA</Text>
          <Text style={[S.cellBold, S.colDesc]}>DESCRIPCIÓN</Text>
          {cols.map((c) => (
            <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
              {currencyLabel(c.currency)}
            </Text>
          ))}
        </View>
        {items.map((item) => (
          <View key={item.itemNumber} style={S.row}>
            <Text style={[S.cell, S.colNum, S.center]}>{item.itemNumber}</Text>
            <Text style={[S.cell, S.colDate]}>{item.date}</Text>
            <Text style={[S.cell, S.colDesc]}>{item.description}</Text>
            {cols.map((c) => (
              <Text key={c.currency} style={[S.cell, { width: c.width, textAlign: 'right' }]}>
                {bucketAmount(item.amountByCurrency, c.currency)
                  ? fmt(bucketAmount(item.amountByCurrency, c.currency), c.currency)
                  : '-'}
              </Text>
            ))}
          </View>
        ))}
        <View style={S.totalRow}>
          <Text style={[S.cellBold, S.colNum]} />
          <Text style={[S.cellBold, S.colDate]} />
          <Text style={[S.cellBold, S.colDesc]} />
          {cols.map((c) => (
            <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
              {fmt(bucketAmount(totals.byCurrency, c.currency), c.currency)}
            </Text>
          ))}
        </View>
      </View>
    </>
  );
}

function BuildingExpenseTables({
  buildings,
  startNota,
}: {
  buildings: BuildingExpenseSection[];
  startNota: number;
}) {
  return (
    <>
      <Text style={S.sectionTitle}>GASTOS PROPIOS</Text>
      {buildings.map((b, idx) => {
        const currencies = b.totalByCurrency.map((x) => x.currency);
        const cols = currencyCols(currencies);
        return (
          <View key={b.buildingId}>
            <Text style={S.sectionTitle}>GASTOS PROPIOS {b.buildingName.toUpperCase()}</Text>
            <Text style={S.notaTitle}>NOTA NRO {startNota + idx}</Text>
            <View style={S.table}>
              <View style={S.headerRow}>
                <Text style={[S.cellBold, S.colNum, S.center]}>#</Text>
                <Text style={[S.cellBold, S.colDate, S.center]}>FECHA</Text>
                <Text style={[S.cellBold, S.colDesc]}>DESCRIPCIÓN</Text>
                {cols.map((c) => (
                  <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
                    {currencyLabel(c.currency)}
                  </Text>
                ))}
              </View>
              {b.items.map((item) => (
                <View key={item.itemNumber} style={S.row}>
                  <Text style={[S.cell, S.colNum, S.center]}>{item.itemNumber}</Text>
                  <Text style={[S.cell, S.colDate]}>{item.date}</Text>
                  <Text style={[S.cell, S.colDesc]}>{item.description}</Text>
                  {cols.map((c) => (
                    <Text key={c.currency} style={[S.cell, { width: c.width, textAlign: 'right' }]}>
                      {bucketAmount(item.amountByCurrency, c.currency)
                        ? fmt(bucketAmount(item.amountByCurrency, c.currency), c.currency)
                        : '-'}
                    </Text>
                  ))}
                </View>
              ))}
              <View style={S.totalRow}>
                <Text style={[S.cellBold, S.colNum]} />
                <Text style={[S.cellBold, S.colDate]} />
                <Text style={[S.cellBold, S.colDesc]} />
                {cols.map((c) => (
                  <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
                    {fmt(bucketAmount(b.totalByCurrency, c.currency), c.currency)}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </>
  );
}

function ReservaLegalSection({
  reservaLegal,
  startNota,
}: {
  reservaLegal: Array<{ buildingName: string; byCurrency: Array<{ currency: string; amountMinor: number }> }>;
  startNota: number;
}) {
  return (
    <>
      <Text style={S.sectionTitle}>RESERVA LEGAL</Text>
      {reservaLegal.map((r, idx) => {
        const cols = currencyCols(r.byCurrency.map((b) => b.currency));
        return (
          <View key={r.buildingName}>
            <Text style={S.notaTitle}>NOTA NRO {startNota + idx}</Text>
            <Text style={[S.buildingTitle, { textAlign: 'center' }]}>
              RESERVA LEGAL {r.buildingName.toUpperCase()}
            </Text>
            <View style={[S.table, { marginBottom: 6 }]}>
              <View style={S.totalRow}>
                <Text style={[S.cellBold, S.colIncomeDesc]} />
                {cols.map((c) => (
                  <Text key={c.currency} style={[S.cellBold, { width: c.width, textAlign: 'right' }]}>
                    {fmt(bucketAmount(r.byCurrency, c.currency), c.currency)}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        );
      })}
    </>
  );
}

function AlicuotaPage({
  building,
  report,
}: {
  building: BuildingAlicuota;
  report: NotasRevelatoriasReport;
}) {
  const nextMonthLabel = nextMonth(report.period);
  return (
    <Page size="A4" orientation="landscape" style={S.page}>
      <Text style={S.headerTitle}>{report.tenantName.toUpperCase()}</Text>
      <Text style={S.headerTitle}>
        ALÍCUOTA {building.buildingName.toUpperCase()} MES DE {nextMonthLabel}
      </Text>
      <Text style={S.headerPeriod}>EXPRESADA DE DÓLARES AMERICANOS</Text>
      <Text style={S.spacer} />

      <View style={S.table}>
        <View style={S.headerRow}>
          <Text style={[S.cellBold, S.colAliCat]}>ALÍCUOTAS {building.buildingName.toUpperCase()}</Text>
          <Text style={[S.cellBold, S.colAliCoef]}>%</Text>
          <Text style={[S.cellBold, S.colAliComunes]}>GASTOS COMUNES</Text>
          <Text style={[S.cellBold, S.colAliPropios]}>GASTOS PROPIOS</Text>
          <Text style={[S.cellBold, S.colAliReserva]}>RESERVA</Text>
          <Text style={[S.cellBold, S.colAliTotal]}>TOTAL ALÍCUOTA</Text>
          <Text style={[S.cellBold, S.colAliRecaudar]}>TOTAL A RECAUDAR</Text>
        </View>

        {building.rows.map((row) => (
          <View key={row.categoryName} style={S.row}>
            <Text style={[S.cell, S.colAliCat]}>Alícuota {row.categoryName}</Text>
            <Text style={[S.cell, S.colAliCoef]}>{row.coefficient.toFixed(6)}</Text>
            <Text style={[S.cell, S.colAliComunes]}>{fmt(row.gastosComunesPerUnit, 'USD')}</Text>
            <Text style={[S.cell, S.colAliPropios]}>{fmt(row.gastosPropiosPerUnit, 'USD')}</Text>
            <Text style={[S.cell, S.colAliReserva]}>{fmt(row.reservaPerUnit, 'USD')}</Text>
            <Text style={[S.cell, S.colAliTotal]}>{fmt(row.totalPerUnit, 'USD')}</Text>
            <Text style={[S.cell, S.colAliRecaudar]}>{fmt(row.totalToRecaudar, 'USD')}</Text>
          </View>
        ))}

        <View style={S.totalRow}>
          <Text style={[S.cellBold, S.colAliCat]} />
          <Text style={[S.cellBold, S.colAliCoef]} />
          <Text style={[S.cellBold, S.colAliComunes]} />
          <Text style={[S.cellBold, S.colAliPropios]} />
          <Text style={[S.cellBold, S.colAliReserva]} />
          <Text style={[S.cellBold, S.colAliTotal]}>TOTAL ALÍCUOTA</Text>
          <Text style={[S.cellBold, S.colAliRecaudar]}>{fmt(building.grandTotal, 'USD')}</Text>
        </View>
      </View>

      <View style={S.observaciones}>
        <Text style={S.obsBold}>OBSERVACIONES:</Text>
        <Text>
          1.- LOS GASTOS CAUSADOS PARA EL MES DE {report.periodLabel} EXPRESADO EN DÓLARES AMERICANOS
        </Text>
        <Text>2.- LOS NÚMEROS DE CUENTA PARA EL RESPECTIVO PAGO</Text>
      </View>
    </Page>
  );
}

// ── Main PDF Document ─────────────────────────────────────────────────────────

function NotasRevelatoriasDocument({ report }: { report: NotasRevelatoriasReport }) {
  const incomeNotasCount = report.buildingIncomes.length;
  const commonNota = incomeNotasCount + 1;
  const buildingExpStartNota = commonNota + 1;
  const reservaStartNota = buildingExpStartNota + report.buildingExpenses.length;

  return (
    <Document>
      {/* Pages 1-N: Notas Revelatorias */}
      <Page size="A4" style={S.page}>
        <PageHeader report={report} />
        <IncomeTable report={report} />
        <CommonExpensesTable
          items={report.commonExpenses}
          totals={report.commonTotals}
          startNota={commonNota}
        />
        <BuildingExpenseTables
          buildings={report.buildingExpenses}
          startNota={buildingExpStartNota}
        />
        <ReservaLegalSection
          reservaLegal={report.reservaLegal}
          startNota={reservaStartNota}
        />
      </Page>

      {/* Alícuota page per building */}
      {report.alicuotas
        .filter((a) => a.rows.length > 0)
        .map((building) => (
          <AlicuotaPage key={building.buildingId} building={building} report={report} />
        ))}
    </Document>
  );
}

// ── Download Button Component ─────────────────────────────────────────────────

interface Props {
  report: NotasRevelatoriasReport;
  className?: string;
}

export function NotasRevelatoriasPDF({ report, className }: Props) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const blob = await pdf(<NotasRevelatoriasDocument report={report} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notas-revelatorias-${report.period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className={
        className ??
        'px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors'
      }
    >
      {loading ? 'Generando PDF...' : 'Descargar Notas Revelatorias'}
    </button>
  );
}
