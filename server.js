const express = require('express');
const app = express();
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('OK'));
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('OK on ' + PORT));
