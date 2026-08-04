const { fetchJsonWithRetry } = require('../lib/httpClient');
const config = require('../config');

/**
 * Client pour l'API DPE Logements existants (ADEME, data-fair).
 * Doc : https://data.ademe.fr/datasets/dpe03existant
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 30; // garde-fou : 30k DPE suffisent largement pour l'échantillon Toulouse du MVP

const SELECT_FIELDS = [
  'numero_dpe',
  'etiquette_dpe',
  'etiquette_ges',
  'surface_habitable_logement',
  'adresse_ban',
  'code_postal_ban',
  'code_insee_ban',
  '_geopoint',
  'date_etablissement_dpe',
  'periode_construction'
].join(',');

/**
 * Récupère les DPE pour une commune (limité à MAX_PAGES pour rester dans un
 * temps d'ingestion raisonnable en MVP).
 */
async function fetchDpeForCommune(codeInsee) {
  const results = [];
  let url = `${config.api.dpeBaseUrl}/lines?size=${PAGE_SIZE}&select=${SELECT_FIELDS}&qs=code_insee_ban:${codeInsee}`;
  let page = 0;

  while (url && page < MAX_PAGES) {
    const data = await fetchJsonWithRetry(url);
    results.push(...data.results);
    url = data.next || null;
    page++;
  }

  return results;
}

module.exports = { fetchDpeForCommune };
