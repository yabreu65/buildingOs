const net = require('net');

const conn = net.createConnection({ host: '127.0.0.1', port: 5434 });

conn.on('connect', () => {
  console.log('TCP connected');
  
  // Send PostgreSQL startup message (protocol 3.0)
  const user = 'buildingos';
  const database = 'buildingos';
  
  // Build startup packet
  let params = '';
  params += 'user\x00' + user + '\x00';
  params += 'database\x00' + database + '\x00';
  
  const len = 4 + 4 + params.length + 1; // length(4) + protocol(4) + params + null
  const buf = Buffer.alloc(len);
  buf.writeInt32BE(len, 0);
  buf.writeInt32BE(196608, 4); // protocol version 3.0 = 0x00030000
  buf.write(params + '\x00', 8);
  
  conn.write(buf);
  console.log('Sent startup packet');
});

conn.on('data', (data) => {
  console.log('Received data, length:', data.length);
  console.log('First byte:', data[0], '(type:', String.fromCharCode(data[0]), ')');
  if (data.length > 5) {
    console.log('Message:', data.toString('utf8', 5, Math.min(200, data.length)));
  }
  conn.end();
});

conn.on('error', (e) => {
  console.error('TCP error:', e.message);
});

conn.on('close', () => {
  console.log('Connection closed');
});

setTimeout(() => {
  console.log('Timeout, closing');
  conn.destroy();
}, 3000);
