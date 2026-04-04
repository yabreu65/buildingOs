export interface ImportExpensesDto {
  period: string; // YYYY-MM — si no viene en el Excel, usar este
  columnMapping?: string; // JSON stringificado { fecha: 0, descripcion: 1, ... }
}

export interface ExpenseImportRow {
  fecha: string;          // DD/MM/YYYY or similar
  descripcion: string;
  monto: number;
  moneda: string;         // USD, VES, ARS
  edificio: string;       // "Torre A" o "Comunes"
  categoria: string;      // "Electricidad", "Agua", etc.
  proveedor?: string;     // opcional
}

export interface ExpenseImportResult {
  totalRows: number;
  successCount: number;
  failureCount: number;
  createdExpenses: string[]; // Array de IDs creados
  errors: { rowIndex: number; reason: string }[];
}
