const express = require('express');
const cors = require('cors');
const path = require('path');

const config = require('./config');
const apiRouter = require('./routes/api');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', apiRouter);

// Sert le frontend statique (build/ ou fichiers bruts) — permet de livrer
// backend + frontend depuis un seul processus/conteneur pour le MVP.
const frontendDir = path.resolve(__dirname, '..', '..', 'frontend');
app.use(express.static(frontendDir));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(config.port, () => {
  console.log(`DealMatch Immo backend démarré sur http://localhost:${config.port}`);
  console.log(`Ville pilote : ${config.pilotCity.name} (${config.pilotCity.codeInsee})`);
});
