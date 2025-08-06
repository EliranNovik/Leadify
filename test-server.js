const express = require('express');
const path = require('path');

const app = express();
const PORT = 8080;

// Serve static files
app.use(express.static('.'));

// Serve the test HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-webhook.html'));
});

app.listen(PORT, () => {
  console.log(`🌐 Test server running on http://localhost:${PORT}`);
  console.log(`📝 Open http://localhost:${PORT} to test the webhook`);
}); 