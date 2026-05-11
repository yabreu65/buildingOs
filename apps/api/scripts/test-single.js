const fetch = require('node-fetch');

async function testSingle() {
  const res = await fetch('http://localhost:4000/cmoshktma00009auq4r31sthd/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Hola' })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));
}

testSingle().catch(console.error);
