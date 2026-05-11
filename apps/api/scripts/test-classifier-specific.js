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
  console.log('🧪 Test E2E: Classifier Específico\n');
  
  const { token, tenantId } = await login();
  
  // Solo preguntas que definitivamente NO matchean strict queries
  const tests = [
    'Estoy al dia con las expensas',
    'Todo esta pagado',
    'No debo nada verdad',
    'Como anda la cobranza',
    'Necesito ver si hay reclamos',
    'Hay algo roto en el edificio',
    'Quiero revisar los papeles',
    'Donde estan los archivos',
    'Quien habita aca',
    'Los inquilinos estan al dia',
    'Como viene el complejo',
    'Cuantas unidades tenemos',
  ];

  for (const q of tests) {
    const result = await ask(token, tenantId, q);
    const isClassifier = result.answer?.includes('Entiendo que') || result.answer?.includes('Parece que');
    const isStrict = result.answer?.includes('En Torre') || result.answer?.includes('deuda total') || result.answer?.includes('Tickets del edificio');
    const icon = isClassifier ? '🤖' : isStrict ? '🎯' : '💬';
    console.log(`${icon} "${q}"`);
    console.log(`   → ${result.answer?.substring(0, 100)}...`);
    console.log();
    await new Promise(r => setTimeout(r, 1000));
  }
}

test().catch(console.error);
