const path = require('path');
require('dotenv').config();

function envInt(name, fallback) {
  const v = process.env[name];
  return v ? parseInt(v, 10) : fallback;
}

module.exports = {
  port: envInt('PORT', 4000),

  pilotCity: {
    codeInsee: process.env.PILOT_CITY_CODE_INSEE || '31555',
    name: process.env.PILOT_CITY_NAME || 'Toulouse'
  },

  api: {
    dvfBaseUrl: process.env.DVF_API_BASE_URL || 'https://apidf-preprod.cerema.fr',
    dpeBaseUrl: process.env.DPE_API_BASE_URL || 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant',
    banBaseUrl: process.env.BAN_API_BASE_URL || 'https://api-adresse.data.gouv.fr'
  },

  dvfAnneeMin: envInt('DVF_ANNEE_MIN', 2022),

  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data')
};
