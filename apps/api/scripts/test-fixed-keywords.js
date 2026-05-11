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
    'Quien reside en el departamento 0110 de la Torre B',
    'Quien ocupa el departamento 0114 de la Torre B',
    'Estado de cuenta del departamento 0111 de la Torre A',
    'Abonos del departamento 0108 de la Torre B',
  ];
  
  for (const q of tests) {
    const result = await ask(token, tenantId, q);
    console.log(`[${result.status}] ${q}`);
    console.log(`  -> ${result.answer?.substring(0, 100)}...`);
    console.log();
  }
}

test().catch(console.error);
