export const getCurrentAccountingPeriod = (referenceDate = new Date()): string => {
  return `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}`;
};

export const formatAccountingPeriodLabel = (period: string): string => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return period;
  }

  const [year, month] = period.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1));

  return label
    .replace(/\s+de\s+/i, ' ')
    .replace(/^./, (char) => char.toUpperCase());
};
