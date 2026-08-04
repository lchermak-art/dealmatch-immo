const { fetchJsonWithRetry } = require('../lib/httpClient');
const config = require('../config');

/**
 * Client pour l'API DVF+ open-data du Cerema.
 * Doc : https://apidf-preprod.cerema.fr/swagger/
 * Attention : environnement de préproduction, pas de SLA garanti (503 fréquents).
 */

const PAGE_SIZE = 500;

/**
 * Récupère toutes les mutations DVF+ pour une commune, sur une plage d'années.
 * @param {string} codeInsee
 * @param {number} anneeMin
 * @returns {Promise<Array<object>>}
 */
async function fetchAllMutations(codeInsee, anneeMin) {
  const results = [];
  let url = `${config.api.dvfBaseUrl}/dvf_opendata/mutations?code_insee=${codeInsee}&anneemut_min=${anneeMin}&page_size=${PAGE_SIZE}`;

  while (url) {
    const page = await fetchJsonWithRetry(url);
    results.push(...page.results);
    // L'API renvoie parfois "next" en http:// — on le force en https pour éviter un mixed-content / redirect intempestif.
    url = page.next ? page.next.replace(/^http:/, 'https:') : null;
  }

  return results;
}

module.exports = { fetchAllMutations };
