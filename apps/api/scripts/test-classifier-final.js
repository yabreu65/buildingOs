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
  console.log('🧪 Test E2E: Classifier + Strict Pipeline Final\n');
  
  const { token, tenantId } = await login();
  
  const tests = [
    // STRICT QUERIES (deben funcionar sin classifier)
    { q: 'Quien vive en el departamento 0101 de la Torre A', type: 'strict', expect: 'Residente' },
    { q: 'Cuanto debe la Torre A', type: 'strict', expect: 'deuda total' },
    { q: 'Tickets de la Torre A', type: 'strict', expect: 'Tickets' },
    
    // CLASSIFIER (preguntas ambiguas sin keywords exactos)
    { q: 'Estoy al dia con las expensas', type: 'classifier', expect: 'deudas|saldos|finanzas' },
    { q: 'Hay algun problema en el edificio', type: 'classifier', expect: 'ticket|reclamo|problema' },
    { q: 'Necesito ver los documentos', type: 'classifier', expect: 'archivos|documentos' },
    { q: 'Quiero ver los pagos recientes', type: 'classifier', expect: 'pagos|transferencias' },
    { q: 'Quien habita aca', type: 'classifier', expect: 'residentes|ocupantes' },
    { q: 'Como viene el complejo', type: 'classifier', expect: 'estadísticas|resumen' },
    
    // FALLBACK (conversación general)
    { q: 'Buenos dias', type: 'fallback', expect: 'Entendí' },
    { q: 'Gracias por la ayuda', type: 'fallback', expect: 'Entendí' },
    { q: 'Cual es el clima hoy', type: 'fallback', expect: 'Entendí' },
  ];

  let pass = 0;
  let fail = 0;
  let strictCount = 0;
  let classifierCount = 0;
  let fallbackCount = 0;

  for (let i = 0; i < tests.length; i++) {
    const { q, type, expect } = tests[i];
    const result = await ask(token, tenantId, q);
    const isValidStatus = result.status === 200 || result.status === 201;
    const answer = result.answer || '';
    const regex = new RegExp(expect, 'i');
    const isPass = isValidStatus && regex.test(answer);
    
    if (isPass) {
      pass++;
      if (type === 'strict') strictCount++;
      else if (type === 'classifier') classifierCount++;
      else fallbackCount++;
      console.log(`✅ [${type.toUpperCase()}] "${q}"`);
      console.log(`   → ${answer.substring(0, 80)}...`);
    } else {
      fail++;
      console.log(`❌ [${type.toUpperCase()}] "${q}"`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Got: ${answer.substring(0, 100)}`);
      console.log(`   Expected: ${expect}`);
    }
    console.log();
    
    await new Promise(r => setTimeout(r, 800));
  }

  console.log('═══════════════════════════════════════════');
 console.log(`📊 RESULTADOS FINALES`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`Total: ${pass + fail} tests`);
  console.log(`✅ PASS: ${pass} (${((pass/(pass+fail))*100).toFixed(0)}%)`);
  console.log(`❌ FAIL: ${fail}`);
  console.log(`   - Strict queries: ${strictCount} activados`);
  console.log(`   - Classifier: ${classifierCount} activados`);
  console.log(`   - Fallback: ${fallbackCount} activados`);
  console.log(`═══════════════════════════════════════════`);
}

test().catch(console.error);
