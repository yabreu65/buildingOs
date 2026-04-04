'use client';

import { useEffect, useState } from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
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

function fmtUSD(minor: number): string {
  if (!minor) return '-';
  return (minor / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtVES(minor: number): string {
  if (!minor) return '-';
  return (minor / 100).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      {report.buildingIncomes.map((building, idx) => (
        <View key={building.buildingId}>
          <Text style={S.notaTitle}>NOTA NRO {idx + 1}</Text>
          <Text style={S.buildingTitle}>Ingresos {building.buildingName}</Text>
          <View style={S.table}>
            {/* Header */}
            <View style={S.headerRow}>
              <Text style={[S.cell, S.colIncomeDesc]} />
              <Text style={[S.cellBold, S.colIncomeVES, S.center]}>BOLÍVARES</Text>
              <Text style={[S.cellBold, S.colIncomeUSD, S.center]}>DÓLARES</Text>
              <Text style={[S.cellBold, S.colIncomePesos, S.center]}>PESOS</Text>
            </View>
            {/* Rows */}
            {building.entries.map((entry, i) => (
              <View key={i} style={S.row}>
                <Text style={[S.cell, S.colIncomeDesc]}>{entry.description}</Text>
                <Text style={[S.cell, S.colIncomeVES]}>
                  {entry.currencyCode === 'VES' ? fmtVES(entry.amountMinor) : '-'}
                </Text>
                <Text style={[S.cell, S.colIncomeUSD]}>
                  {entry.currencyCode === 'USD' ? fmtUSD(entry.amountMinor) : '-'}
                </Text>
                <Text style={[S.cell, S.colIncomePesos]}>
                  {!['USD', 'VES'].includes(entry.currencyCode) ? fmtUSD(entry.amountMinor) : '-'}
                </Text>
              </View>
            ))}
            {/* Total */}
            <View style={S.totalRow}>
              <Text style={[S.cellBold, S.colIncomeDesc]}>Total de Ingresos {building.buildingName}</Text>
              <Text style={[S.cellBold, S.colIncomeVES]}>{fmtVES(building.totalVES)}</Text>
              <Text style={[S.cellBold, S.colIncomeUSD]}>{fmtUSD(building.totalUSD)}</Text>
              <Text style={[S.cellBold, S.colIncomePesos]}>{building.totalPesos ? fmtUSD(building.totalPesos) : '-'}</Text>
            </View>
          </View>
        </View>
      ))}
    </>
  );
}

function CommonExpensesTable({
  items,
  totals,
  startNota,
}: {
  items: ExpenseLineItem[];
  totals: { usd: number; ves: number; pesos: number };
  startNota: number;
}) {
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
          <Text style={[S.cellBold, S.colUSD]}>DÓLARES</Text>
          <Text style={[S.cellBold, S.colVES]}>BOLÍVARES</Text>
          <Text style={[S.cellBold, S.colPesos]}>PESOS</Text>
        </View>
        {items.map((item) => (
          <View key={item.itemNumber} style={S.row}>
            <Text style={[S.cell, S.colNum, S.center]}>{item.itemNumber}</Text>
            <Text style={[S.cell, S.colDate]}>{item.date}</Text>
            <Text style={[S.cell, S.colDesc]}>{item.description}</Text>
            <Text style={[S.cell, S.colUSD]}>{item.usdAmount ? fmtUSD(item.usdAmount) : '-'}</Text>
            <Text style={[S.cell, S.colVES]}>{item.vesAmount ? fmtVES(item.vesAmount) : '-'}</Text>
            <Text style={[S.cell, S.colPesos]}>{item.pesosAmount ? fmtUSD(item.pesosAmount) : '-'}</Text>
          </View>
        ))}
        <View style={S.totalRow}>
          <Text style={[S.cellBold, S.colNum]} />
          <Text style={[S.cellBold, S.colDate]} />
          <Text style={[S.cellBold, S.colDesc]} />
          <Text style={[S.cellBold, S.colUSD]}>{fmtUSD(totals.usd)}</Text>
          <Text style={[S.cellBold, S.colVES]}>{fmtVES(totals.ves)}</Text>
          <Text style={[S.cellBold, S.colPesos]}>{totals.pesos ? fmtUSD(totals.pesos) : '-'}</Text>
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
      {buildings.map((b, idx) => (
        <View key={b.buildingId}>
          <Text style={S.sectionTitle}>GASTOS PROPIOS {b.buildingName.toUpperCase()}</Text>
          <Text style={S.notaTitle}>NOTA NRO {startNota + idx}</Text>
          <View style={S.table}>
            <View style={S.headerRow}>
              <Text style={[S.cellBold, S.colNum, S.center]}>#</Text>
              <Text style={[S.cellBold, S.colDate, S.center]}>FECHA</Text>
              <Text style={[S.cellBold, S.colDesc]}>DESCRIPCIÓN</Text>
              <Text style={[S.cellBold, S.colUSD]}>DÓLARES</Text>
              <Text style={[S.cellBold, S.colVES]}>BOLÍVARES</Text>
              <Text style={[S.cellBold, S.colPesos]}>PESOS</Text>
            </View>
            {b.items.map((item) => (
              <View key={item.itemNumber} style={S.row}>
                <Text style={[S.cell, S.colNum, S.center]}>{item.itemNumber}</Text>
                <Text style={[S.cell, S.colDate]}>{item.date}</Text>
                <Text style={[S.cell, S.colDesc]}>{item.description}</Text>
                <Text style={[S.cell, S.colUSD]}>{item.usdAmount ? fmtUSD(item.usdAmount) : '-'}</Text>
                <Text style={[S.cell, S.colVES]}>{item.vesAmount ? fmtVES(item.vesAmount) : '-'}</Text>
                <Text style={[S.cell, S.colPesos]}>{item.pesosAmount ? fmtUSD(item.pesosAmount) : '-'}</Text>
              </View>
            ))}
            <View style={S.totalRow}>
              <Text style={[S.cellBold, S.colNum]} />
              <Text style={[S.cellBold, S.colDate]} />
              <Text style={[S.cellBold, S.colDesc]} />
              <Text style={[S.cellBold, S.colUSD]}>{fmtUSD(b.totalUSD)}</Text>
              <Text style={[S.cellBold, S.colVES]}>{fmtVES(b.totalVES)}</Text>
              <Text style={[S.cellBold, S.colPesos]}>{b.totalPesos ? fmtUSD(b.totalPesos) : '-'}</Text>
            </View>
          </View>
        </View>
      ))}
    </>
  );
}

function ReservaLegalSection({
  reservaLegal,
  startNota,
}: {
  reservaLegal: { buildingName: string; usd: number; ves: number }[];
  startNota: number;
}) {
  return (
    <>
      <Text style={S.sectionTitle}>RESERVA LEGAL</Text>
      {reservaLegal.map((r, idx) => (
        <View key={r.buildingName}>
          <Text style={S.notaTitle}>NOTA NRO {startNota + idx}</Text>
          <Text style={[S.buildingTitle, { textAlign: 'center' }]}>
            RESERVA LEGAL {r.buildingName.toUpperCase()}
          </Text>
          <View style={[S.table, { marginBottom: 6 }]}>
            <View style={S.totalRow}>
              <Text style={[S.cellBold, S.colIncomeDesc]} />
              <Text style={[S.cellBold, S.colIncomeVES]}>{fmtVES(r.ves)}</Text>
              <Text style={[S.cellBold, S.colIncomeUSD]}>{fmtUSD(r.usd)}</Text>
              <Text style={[S.cellBold, S.colIncomePesos]}>-</Text>
            </View>
          </View>
        </View>
      ))}
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
            <Text style={[S.cell, S.colAliComunes]}>{fmtUSD(row.gastosComunesPerUnit)}</Text>
            <Text style={[S.cell, S.colAliPropios]}>{fmtUSD(row.gastosPropiosPerUnit)}</Text>
            <Text style={[S.cell, S.colAliReserva]}>{fmtUSD(row.reservaPerUnit)}</Text>
            <Text style={[S.cell, S.colAliTotal]}>{fmtUSD(row.totalPerUnit)}</Text>
            <Text style={[S.cell, S.colAliRecaudar]}>{fmtUSD(row.totalToRecaudar)}</Text>
          </View>
        ))}

        <View style={S.totalRow}>
          <Text style={[S.cellBold, S.colAliCat]} />
          <Text style={[S.cellBold, S.colAliCoef]} />
          <Text style={[S.cellBold, S.colAliComunes]} />
          <Text style={[S.cellBold, S.colAliPropios]} />
          <Text style={[S.cellBold, S.colAliReserva]} />
          <Text style={[S.cellBold, S.colAliTotal]}>TOTAL ALÍCUOTA</Text>
          <Text style={[S.cellBold, S.colAliRecaudar]}>{fmtUSD(building.grandTotal)}</Text>
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
