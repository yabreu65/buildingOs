const BASE_URL = 'http://localhost:4000';
const ADMIN_EMAIL = 'admin@sancristobal.test';
const ADMIN_PASSWORD = 'DevPass!123';

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const data = await res.json();
  return { token: data.accessToken, tenantId: data.memberships[0].tenantId };
}

async function ask(token, tenantId, question) {
  const res = await fetch(`${BASE_URL}/tenants/${tenantId}/assistant/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
    },
    body: JSON.stringify({ message: question, page: 'dashboard' }),
  });
  const data = await res.json();
  return { status: res.status, answer: data.answer };
}

async function test() {
  const { token, tenantId } = await login();
  
  const tests = [
    // Building-Level Debt
    'Cuanto debe la Torre A',
    'Deuda de la Torre B',
    // Building-Level Tickets
    'Tickets de la Torre A',
    'Reclamos de la Torre B',
    // Building-Level Delinquents
    'Quienes son los morosos de la Torre A',
    'Top deudores de la Torre B',
    // Building-Level Stats
    'Estadisticas de la Torre A',
    'Cuantas unidades tiene la Torre B',
    // Building-Level Documents
    'Documentos de la Torre A',
    'Archivos de la Torre B',
    // Building-Level Payments
    'Pagos de la Torre A',
    'Transferencias de la Torre B',
  ];
  
  let pass = 0;
  let fail = 0;
  
  for (const q of tests) {
    const result = await ask(token, tenantId, q);
    const isPass = (result.status === 200 || result.status === 201) && !result.answer?.includes('Entendí tu consulta');
    if (isPass) pass++; else fail++;
    console.log(`${isPass ? '✅' : '❌'} [${result.status}] ${q}`);
    if (!isPass) {
      console.log(`  -> ${result.answer?.substring(0, 120)}...`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n📊 Results: ${pass} PASS, ${fail} FAIL`);
}

test().catch(console.error);
