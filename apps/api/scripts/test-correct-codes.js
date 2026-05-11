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
  console.log('🧪 Verificación: Códigos de unidad CORRECTOS (3 dígitos)\n');
  
  const { token, tenantId } = await login();
  
  // Preguntas con códigos de 3 dígitos reales
  const tests = [
    { q: 'Quien vive en el departamento 011 de la Torre A', code: '011', expected: 'Piso 1 - Depto 1' },
    { q: 'Quien vive en el departamento 012 de la Torre A', code: '012', expected: 'Piso 1 - Depto 2' },
    { q: 'Quien vive en el departamento 021 de la Torre A', code: '021', expected: 'Piso 2 - Depto 1' },
    { q: 'Quien vive en el departamento 101 de la Torre A', code: '101', expected: 'Piso 10 - Depto 1' },
    { q: 'Quien vive en el departamento 111 de la Torre A', code: '111', expected: 'Piso 11 - Depto 1' },
    { q: 'Quien vive en el departamento 118 de la Torre A', code: '118', expected: 'Piso 11 - Depto 8' },
    // Comparación: código incorrecto de 4 dígitos
    { q: 'Quien vive en el departamento 0101 de la Torre A', code: '0101', expected: 'NO_EXISTE' },
  ];

  let pass = 0;
  let fail = 0;

  for (const { q, code, expected } of tests) {
    const result = await ask(token, tenantId, q);
    const answer = result.answer || '';
    
    if (code === '0101') {
      // Este debería fallar o responder con unidad equivocada
      const isWrong = answer.includes('Piso 10') || answer.includes('No encontré');
      const icon = isWrong ? '⚠️' : '❌';
      console.log(`${icon} Código ${code} (4 dígitos - NO VÁLIDO)`);
      console.log(`   Pregunta: "${q}"`);
      console.log(`   Respuesta: ${answer.substring(0, 100)}...`);
      console.log(`   Nota: El código real es '011', no '0101'\n`);
    } else {
      const isCorrect = answer.includes(expected);
      const icon = isCorrect ? '✅' : '❌';
      console.log(`${icon} Código ${code} → ${expected}`);
      console.log(`   Pregunta: "${q}"`);
      console.log(`   Respuesta: ${answer.substring(0, 100)}...\n`);
      if (isCorrect) pass++; else fail++;
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`📊 Resultados: ${pass} correctos, ${fail} incorrectos`);
}

test().catch(console.error);
