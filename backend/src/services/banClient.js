const { fetchJsonWithRetry } = require('../lib/httpClient');
const config = require('../config');

/**
 * Client pour l'API Adresse (Base Adresse Nationale) — géocodage gratuit,
 * sans clé. Utilisé pour convertir une adresse saisie par l'utilisateur en
 * coordonnées + code INSEE.
 */
async function geocodeAddress(query) {
  const url = `${config.api.banBaseUrl}/search/?q=${encodeURIComponent(query)}&limit=1`;
  const data = await fetchJsonWithRetry(url, { retries: 2 });

  const feature = data.features && data.features[0];
  if (!feature) return null;

  return {
    label: feature.properties.label,
    codeInsee: feature.properties.citycode,
    city: feature.properties.city,
    postcode: feature.properties.postcode,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    score: feature.properties.score
  };
}

module.exports = { geocodeAddress };
