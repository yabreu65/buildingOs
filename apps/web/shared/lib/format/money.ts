 export function formatMoney(amount: number, currency = "USD", locale = "en-US") {
   return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
 }
