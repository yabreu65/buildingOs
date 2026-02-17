 export function formatDate(value: Date, locale = "en-US") {
   return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "2-digit" }).format(value);
 }
