const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

console.log('🚀 TEST SERVER STARTING');
console.log('📍 process.env.PORT =', process.env.PORT);
console.log('📍 PORT variable =', PORT);

app.get('/health', (req, res) => {
  console.log('✅ Health handler called');
  res.status(200).json({ ok: true });
  console.log('✅ Health response queued');
});

app.get('/', (req, res) => {
  console.log('✅ Root handler called');
  res.send('OK');
  console.log('✅ Root response queued');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on port ${PORT}`);
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
});
