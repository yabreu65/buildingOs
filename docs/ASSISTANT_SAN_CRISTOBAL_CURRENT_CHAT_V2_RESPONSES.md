# Respuestas Actuales del Chat V2 - San Cristobal

Documento generado automaticamente desde la ruta oficial `/assistant/chat/v2` usando el seed actual de Residencia San Cristobal.
La idea es que puedas evaluar manualmente la respuesta estructurada real que hoy devuelve BuildingOS.

- Generado: 2026-05-13T17:56:53.007Z
- Ruta evaluada: `/assistant/chat/v2`
- Total de preguntas ejecutadas: 11
- Resueltas actualmente: 11
- No resueltas actualmente: 0

## Resumen por categoria

| Categoria | Total | Resueltas | No resueltas |
|---|---:|---:|---:|
| Residentes | 1 | 1 | 0 |
| Deuda-Unit | 1 | 1 | 0 |
| Documentos-Unit | 1 | 1 | 0 |
| Tickets-Unit | 1 | 1 | 0 |
| Pagos-Unit | 1 | 1 | 0 |
| Deuda-Building | 1 | 1 | 0 |
| Morosos | 1 | 1 | 0 |
| Documentos-Building | 1 | 1 | 0 |
| Tickets-Building | 1 | 1 | 0 |
| Pagos-Building | 1 | 1 | 0 |
| Estadisticas | 1 | 1 | 0 |

## Preguntas resueltas actualmente

### V2-1. Quien vive en el departamento A-0101

- Categoria: `Residentes`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `table`
- Intent esperado: `unit_residents`
- Intent actual: `unit_residents`
- Summary actual de BuildingOS:

> 1 resultado

- Data actual de BuildingOS:

```json
[
  {
    "name": "Residente 1",
    "role": "RESIDENT",
    "isPrimary": true
  }
]
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_REPORTS",
    "label": "View Reports",
    "payload": {}
  }
]
```

### V2-2. Cuanto debe el departamento A-0101

- Categoria: `Deuda-Unit`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `unit_debt`
- Intent actual: `unit_debt`
- Summary actual de BuildingOS:

> Deuda total: Bs.S 18,04 (3 meses adeudados)

- Data actual de BuildingOS:

```json
{
  "totalDebt": 1804,
  "overduePeriodCount": 3,
  "overduePeriods": [
    "2026-01",
    "2026-02",
    "2026-03"
  ],
  "currency": "VES",
  "charges": [
    {
      "period": "2026-01",
      "concept": "Expensas comunes 2026-01",
      "amount": 376,
      "remainingDebt": 376,
      "status": "PENDING",
      "dueDate": "2026-01-05T00:00:00.000Z"
    },
    {
      "period": "2026-02",
      "concept": "Expensas comunes 2026-02",
      "amount": 687,
      "remainingDebt": 687,
      "status": "PENDING",
      "dueDate": "2026-02-05T00:00:00.000Z"
    },
    {
      "period": "2026-03",
      "concept": "Expensas comunes 2026-03",
      "amount": 741,
      "remainingDebt": 741,
      "status": "PENDING",
      "dueDate": "2026-03-05T00:00:00.000Z"
    }
  ]
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_PAYMENTS",
    "label": "View Payments",
    "payload": {}
  }
]
```

### V2-3. Documentos del departamento A-0101

- Categoria: `Documentos-Unit`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `unit_documents`
- Intent actual: `unit_documents`
- Summary actual de BuildingOS:

> Respuesta

- Data actual de BuildingOS:

```json
[]
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_DOCUMENTS",
    "label": "View Documents",
    "payload": {}
  }
]
```

### V2-4. Tickets del departamento A-0101

- Categoria: `Tickets-Unit`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `unit_tickets`
- Intent actual: `unit_tickets`
- Summary actual de BuildingOS:

> Respuesta

- Data actual de BuildingOS:

```json
[]
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_TICKETS",
    "label": "View Tickets",
    "payload": {}
  }
]
```

### V2-5. Ultimos pagos del departamento A-0101

- Categoria: `Pagos-Unit`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `unit_payments`
- Intent actual: `unit_payments`
- Summary actual de BuildingOS:

> Respuesta

- Data actual de BuildingOS:

```json
[]
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_PAYMENTS",
    "label": "View Payments",
    "payload": {}
  }
]
```

### V2-6. Cuanto debe la Torre A

- Categoria: `Deuda-Building`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `kpi`
- Intent esperado: `building_debt`
- Intent actual: `building_debt`
- Summary actual de BuildingOS:

> Deuda total: Bs.S 2.112,87

- Data actual de BuildingOS:

```json
{
  "totalDebt": 211287,
  "currency": "VES",
  "totalUnits": 96,
  "byUnit": [
    {
      "unitCode": "A-0908",
      "label": "Torre A - Piso 9 - Depto 8",
      "totalAmount": 3317,
      "paidAmount": 0,
      "remainingDebt": 3317
    },
    {
      "unitCode": "A-1008",
      "label": "Torre A - Piso 10 - Depto 8",
      "totalAmount": 3317,
      "paidAmount": 0,
      "remainingDebt": 3317
    },
    {
      "unitCode": "A-0108",
      "label": "Torre A - Piso 1 - Depto 8",
      "totalAmount": 3317,
      "paidAmount": 0,
      "remainingDebt": 3317
    },
    {
      "unitCode": "A-0408",
      "label": "Torre A - Piso 4 - Depto 8",
      "totalAmount": 3317,
      "paidAmount": 0,
      "remainingDebt": 3317
    },
    {
      "unitCode": "A-0708",
      "label": "Torre A - Piso 7 - Depto 8",
      "totalAmount": 3288,
      "paidAmount": 0,
      "remainingDebt": 3288
    },
    {
      "unitCode": "A-0808",
      "label": "Torre A - Piso 8 - Depto 8",
      "totalAmount": 3259,
      "paidAmount": 0,
      "remainingDebt": 3259
    },
    {
      "unitCode": "A-0508",
      "label": "Torre A - Piso 5 - Depto 8",
      "totalAmount": 3229,
      "paidAmount": 0,
      "remainingDebt": 3229
    },
    {
      "unitCode": "A-0608",
      "label": "Torre A - Piso 6 - Depto 8",
      "totalAmount": 3229,
      "paidAmount": 0,
      "remainingDebt": 3229
    },
    {
      "unitCode": "A-1108",
      "label": "Torre A - Piso 11 - Depto 8",
      "totalAmount": 3229,
      "paidAmount": 0,
      "remainingDebt": 3229
    },
    {
      "unitCode": "A-0308",
      "label": "Torre A - Piso 3 - Depto 8",
      "totalAmount": 3229,
      "paidAmount": 0,
      "remainingDebt": 3229
    },
    {
      "unitCode": "A-1208",
      "label": "Torre A - Piso 12 - Depto 8",
      "totalAmount": 3229,
      "paidAmount": 0,
      "remainingDebt": 3229
    },
    {
      "unitCode": "A-0208",
      "label": "Torre A - Piso 2 - Depto 8",
      "totalAmount": 3199,
      "paidAmount": 0,
      "remainingDebt": 3199
    },
    {
      "unitCode": "A-0205",
      "label": "Torre A - Piso 2 - Depto 5",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-0207",
      "label": "Torre A - Piso 2 - Depto 7",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-0307",
      "label": "Torre A - Piso 3 - Depto 7",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-0606",
      "label": "Torre A - Piso 6 - Depto 6",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-0805",
      "label": "Torre A - Piso 8 - Depto 5",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-1106",
      "label": "Torre A - Piso 11 - Depto 6",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-1206",
      "label": "Torre A - Piso 12 - Depto 6",
      "totalAmount": 2443,
      "paidAmount": 0,
      "remainingDebt": 2443
    },
    {
      "unitCode": "A-0405",
      "label": "Torre A - Piso 4 - Depto 5",
      "totalAmount": 2414,
      "paidAmount": 0,
      "remainingDebt": 2414
    }
  ]
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_PAYMENTS",
    "label": "View Payments",
    "payload": {}
  }
]
```

### V2-7. Quienes son los morosos de la Torre A

- Categoria: `Morosos`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `building_delinquents`
- Intent actual: `building_delinquents`
- Summary actual de BuildingOS:

> 0 unidades con deuda pendiente

- Data actual de BuildingOS:

```json
{
  "delinquents": [],
  "totalUnitsWithDebt": 0,
  "currency": "VES"
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_PAYMENTS",
    "label": "View Payments",
    "payload": {}
  }
]
```

### V2-8. Documentos de la Torre A

- Categoria: `Documentos-Building`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `building_documents`
- Intent actual: `building_documents`
- Summary actual de BuildingOS:

> Respuesta

- Data actual de BuildingOS:

```json
[]
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_DOCUMENTS",
    "label": "View Documents",
    "payload": {}
  }
]
```

### V2-9. Tickets de la Torre A

- Categoria: `Tickets-Building`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `building_tickets`
- Intent actual: `building_tickets`
- Summary actual de BuildingOS:

> 0 tickets encontrados

- Data actual de BuildingOS:

```json
{
  "tickets": [],
  "statusSummary": {},
  "total": 0
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_TICKETS",
    "label": "View Tickets",
    "payload": {}
  }
]
```

### V2-10. Pagos de la Torre A

- Categoria: `Pagos-Building`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `kpi`
- Intent esperado: `building_payments`
- Intent actual: `building_payments`
- Summary actual de BuildingOS:

> 0 pagos encontrados. Monto total: ARS 0,00

- Data actual de BuildingOS:

```json
{
  "payments": [],
  "sumByMethod": {},
  "totalAmount": 0,
  "total": 0
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_PAYMENTS",
    "label": "View Payments",
    "payload": {}
  }
]
```

### V2-11. Estadisticas de la Torre A

- Categoria: `Estadisticas`
- Estado tecnico: `RESUELTA`
- HTTP: `201`
- Type actual: `text`
- Intent esperado: `building_stats`
- Intent actual: `building_stats`
- Summary actual de BuildingOS:

> Respuesta

- Data actual de BuildingOS:

```json
{
  "totalUnits": 192,
  "billableUnits": 96,
  "unitTypeCounts": {
    "APARTAMENTO": 96,
    "ESTACIONAMIENTO": 96
  },
  "occupancyCounts": {
    "UNKNOWN": 192
  },
  "openTickets": 0,
  "totalTickets": 0,
  "totalDebt": 211287,
  "averageDebt": 1100.453125,
  "currency": "VES"
}
```

- Actions actuales:

```json
[
  {
    "action": "VIEW_REPORTS",
    "label": "View Reports",
    "payload": {}
  }
]
```

## Preguntas que hoy no se resuelven

No se detectaron preguntas sin resolver en esta corrida.

## Referencias

- `apps/api/test/assistant-san-cristobal-v2.e2e-spec.ts`
- `docs/ASSISTANT_SAN_CRISTOBAL_QUESTIONS_AND_EXPECTED_RESPONSES.md`
