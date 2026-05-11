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
  console.log('🐛 Test: Unidad 0101 vs 101 (Ambigüedad de ceros)\n');
  
  const { token, tenantId } = await login();
  
  const tests = [
    { q: 'Quien vive en el departamento 0101 de la Torre A', expected: 'Piso 1 - Depto 1', desc: 'Unidad 0101 debería ser Piso 1, Depto 1' },
    { q: 'Quien vive en el departamento 101 de la Torre A', expected: 'Piso 10 - Depto 1', desc: 'Unidad 101 debería ser Piso 10, Depto 1' },
    { q: 'Quien vive en el departamento 0102 de la Torre A', expected: 'Piso 1 - Depto 2', desc: 'Unidad 0102 debería ser Piso 1, Depto 2' },
  ];

  for (const { q, expected, desc } of tests) {
    const result = await ask(token, tenantId, q);
    const answer = result.answer || '';
    const isCorrect = answer.includes(expected);
    const icon = isCorrect ? '✅' : '❌';
    console.log(`${icon} ${desc}`);
    console.log(`   Pregunta: "${q}"`);
    console.log(`   Respuesta: ${answer.substring(0, 120)}...`);
    console.log();
    await new Promise(r => setTimeout(r, 500));
  }
}

test().catch(console.error);
