const express = require('express');
const helmet = require('helmet');
const app = express();
app.use(helmet());
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send('OK'));
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log('OK on ' + PORT));
