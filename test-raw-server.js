const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`📍 Request: ${req.method} ${req.url}`);
  
  if (req.url === '/health') {
    console.log('🏥 Health endpoint hit');
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': 16
    });
    res.end(JSON.stringify({status:'ok'}));
    console.log('🏥 Health response sent');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Raw HTTP server listening on ${PORT}`);
});
