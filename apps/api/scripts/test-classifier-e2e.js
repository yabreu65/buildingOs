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
  console.log('🧪 Test E2E: Classifier LLM Pipeline\n');
  
  const { token, tenantId } = await login();
  console.log(`✅ Logueado: ${ADMIN_EMAIL}\n`);

  const tests = [
    // Preguntas que NO deberían matchear strict queries (lenguaje natural ambiguo)
    { q: 'Estoy al dia con las expensas', shouldContain: ['deuda', 'saldo', 'finanzas', 'pago', 'Entendí'] },
    { q: 'Me puedes decir si debo algo', shouldContain: ['deuda', 'saldo', 'finanzas', 'pago', 'Entendí'] },
    { q: 'Todo bien con los pagos', shouldContain: ['deuda', 'saldo', 'finanzas', 'pago', 'Entendí'] },
    { q: 'Hay alguna novedad en el edificio', shouldContain: ['ticket', 'reclamo', 'problema', 'novedad', 'Entendí'] },
    { q: 'Necesito un comprobante', shouldContain: ['documento', 'archivo', 'comprobante', 'Entendí'] },
    { q: 'Quiero saber como esta el complejo', shouldContain: ['estadística', 'resumen', 'dato', 'información', 'Entendí'] },
    { q: 'Buenos dias', shouldContain: ['Entendí', 'consulta', 'específico'] },
    { q: 'Gracias', shouldContain: ['Entendí', 'consulta', 'específico'] },
    // Preguntas strict que DEBEN funcionar (sin classifier)
    { q: 'Quien vive en el departamento 0101 de la Torre A', shouldContain: ['Residente', 'Torre A', 'Piso 10'] },
    { q: 'Cuanto debe la Torre A', shouldContain: ['deuda total', 'Torre A', 'USD'] },
  ];

  let pass = 0;
  let fail = 0;

  for (let i = 0; i < tests.length; i++) {
    const { q, shouldContain } = tests[i];
    const result = await ask(token, tenantId, q);
    const isValidStatus = result.status === 200 || result.status === 201;
    const answer = result.answer || '';
    const containsAny = shouldContain.some(keyword => 
      answer.toLowerCase().includes(keyword.toLowerCase())
    );
    const isPass = isValidStatus && containsAny;
    
    if (isPass) {
      pass++;
      console.log(`✅ [${i + 1}] "${q}"`);
      console.log(`   → ${answer.substring(0, 100)}...`);
    } else {
      fail++;
      console.log(`❌ [${i + 1}] "${q}"`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Answer: ${answer.substring(0, 120)}`);
      console.log(`   Expected keywords: ${shouldContain.join(', ')}`);
    }
    console.log();
    
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`📊 Resultados: ${pass} PASS, ${fail} FAIL`);
}

test().catch(console.error);
