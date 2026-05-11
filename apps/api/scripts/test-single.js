const fetch = require('node-fetch');

async function testSingle() {
  const baseUrl = process.env.API_URL || 'http://localhost:4000';
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) throw new Error('TENANT_ID is required');

  const res = await fetch(`${baseUrl}/${tenantId}/assistant/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hola' })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));
}

testSingle().catch(console.error);
