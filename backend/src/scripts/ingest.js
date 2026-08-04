/**
 * Script d'ingestion : récupère les mutations DVF+ (appartements uniquement)
 * et les DPE de la ville pilote, les croise géographiquement au plus proche
 * voisin, et écrit le résultat dans data/mutations.json.
 *
 * Usage : npm run ingest
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { fetchAllMutations } = require('../services/dvfClient');
const { fetchDpeForCommune } = require('../services/dpeClient');

const CODTYPBIEN_APPARTEMENT = ['121', '120', '122']; // un/deux appartements + indéterminé
const MAX_DISTANCE_METERS_DPE_MATCH = 150; // rayon de rapprochement DVF <-> DPE le plus proche

function log(msg) {
  console.log(`[ingest] ${msg}`);
}

// Distance haversine simplifiée (suffisante à l'échelle d'une ville).
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polygonCentroid(coordinates) {
  // coordinates: MultiPolygon -> [ [ [ [lon,lat], ... ] ] ]
  let sumLon = 0, sumLat = 0, count = 0;
  const walk = node => {
    if (typeof node[0] === 'number') {
      sumLon += node[0];
      sumLat += node[1];
      count++;
    } else {
      node.forEach(walk);
    }
  };
  walk(coordinates);
  return count ? { lon: sumLon / count, lat: sumLat / count } : null;
}

async function fetchGeoMutationsAppartements(codeInsee, anneeMin) {
  const { fetchJsonWithRetry } = require('../lib/httpClient');
  const results = [];
  const codtypFilter = CODTYPBIEN_APPARTEMENT.join(',');
  // fields=all est nécessaire pour récupérer sbatapt/nblocapt (surface et
  // nombre de LOCAUX APPARTEMENT dans la mutation) — indispensables pour
  // isoler les ventes d'un seul appartement des ventes multi-lots (immeuble
  // entier, appartement+cave+parking comptés ensemble) qui polluent sinon
  // fortement le prix au m² calculé depuis le seul champ "sbati" global.
  let url = `${config.api.dvfBaseUrl}/dvf_opendata/geomutations?code_insee=${codeInsee}&anneemut_min=${anneeMin}&codtypbien=${codtypFilter}&page_size=200&fields=all`;

  while (url) {
    const page = await fetchJsonWithRetry(url, { timeoutMs: 60000 });
    results.push(...page.features);
    url = page.next ? page.next.replace(/^http:/, 'https:') : null;
    log(`  mutations récupérées : ${results.length}${page.count ? ' / ' + page.count : ''}`);
  }

  return results;
}

// Grille spatiale ~0.002° (environ 150-220m à ces latitudes) pour éviter une
// recherche exhaustive O(mutations x DPE) qui serait bien trop lente en JS
// sur des dizaines de milliers de points.
const GRID_CELL_DEG = 0.002;

function gridKey(lat, lon) {
  return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lon / GRID_CELL_DEG)}`;
}

function buildDpeIndex(dpeRecords) {
  const points = dpeRecords
    .filter(d => d._geopoint && d.etiquette_dpe)
    .map(d => {
      const [lat, lon] = d._geopoint.split(',').map(Number);
      return { ...d, lat, lon };
    });

  const grid = new Map();
  for (const p of points) {
    const key = gridKey(p.lat, p.lon);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  return grid;
}

function findNearestDpe(lat, lon, dpeGrid) {
  const cellLat = Math.floor(lat / GRID_CELL_DEG);
  const cellLon = Math.floor(lon / GRID_CELL_DEG);

  let best = null;
  let bestDist = Infinity;

  // On ne regarde que la cellule contenant le point et ses 8 voisines —
  // largement suffisant vu que le rayon de rapprochement (150m) est du même
  // ordre de grandeur qu'une cellule.
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const key = `${cellLat + dLat}:${cellLon + dLon}`;
      const candidates = dpeGrid.get(key);
      if (!candidates) continue;
      for (const dpe of candidates) {
        const d = distanceMeters(lat, lon, dpe.lat, dpe.lon);
        if (d < bestDist) {
          bestDist = d;
          best = dpe;
        }
      }
    }
  }

  return best && bestDist <= MAX_DISTANCE_METERS_DPE_MATCH ? { ...best, matchDistanceM: Math.round(bestDist) } : null;
}

async function main() {
  const { codeInsee, name } = config.pilotCity;
  log(`Ville pilote : ${name} (${codeInsee})`);

  log('Étape 1/3 — récupération des mutations DVF+ (appartements)...');
  const rawMutations = await fetchGeoMutationsAppartements(codeInsee, config.dvfAnneeMin);
  log(`-> ${rawMutations.length} mutations brutes récupérées.`);

  log('Étape 2/3 — récupération des DPE...');
  const rawDpe = await fetchDpeForCommune(codeInsee);
  log(`-> ${rawDpe.length} DPE récupérés.`);
  const dpeGrid = buildDpeIndex(rawDpe);
  const dpeGeoCount = [...dpeGrid.values()].reduce((s, arr) => s + arr.length, 0);
  log(`-> ${dpeGeoCount} DPE géolocalisés exploitables (indexés en grille spatiale).`);

  log('Étape 3/3 — croisement géographique DVF+ <-> DPE et nettoyage...');
  const cleaned = [];
  let matchedCount = 0;

  let skippedMultiLot = 0;

  for (const feature of rawMutations) {
    const p = feature.properties;
    const valeurfonc = parseFloat(p.valeurfonc);
    const sbatapt = parseFloat(p.sbatapt);
    const nblocapt = parseInt(p.nblocapt, 10) || 0;
    const nblocmut = parseInt(p.nblocmut, 10) || 0;

    // Coeur du nettoyage : on ne garde QUE les mutations qui vendent un seul
    // appartement et rien d'autre (pas de maison, pas de local d'activité
    // mêlé). Sans ce filtre, "sbati" agrège des ventes multi-lots (immeuble
    // entier, appartement+cave+parking...) et le prix au m² calculé n'a plus
    // de sens — c'est ce qui faisait dériver le MAPE à 25-31% au lieu de
    // 9-14% dans une première itération de ce script.
    if (nblocapt !== 1 || nblocmut !== 1) { skippedMultiLot++; continue; }

    if (!valeurfonc || valeurfonc < 10000 || !sbatapt || sbatapt < 9 || sbatapt > 300) continue;

    const prixM2 = valeurfonc / sbatapt;
    if (prixM2 < 800 || prixM2 > 12000) continue; // garde-fou anti-outlier (bornes resserrées post-filtre mono-lot)

    if (!feature.geometry || !feature.geometry.coordinates) continue;
    const centroid = polygonCentroid(feature.geometry.coordinates);
    if (!centroid) continue;

    const dpe = findNearestDpe(centroid.lat, centroid.lon, dpeGrid);
    if (dpe) matchedCount++;

    cleaned.push({
      idmutation: feature.id,
      datemut: p.datemut,
      anneemut: p.anneemut,
      valeurfonc,
      sbati: sbatapt,
      prixM2: Math.round(prixM2 * 100) / 100,
      codtypbien: p.codtypbien,
      libtypbien: p.libtypbien,
      lat: centroid.lat,
      lon: centroid.lon,
      dpe: dpe ? {
        etiquette: dpe.etiquette_dpe,
        etiquetteGes: dpe.etiquette_ges,
        surfaceHabitable: dpe.surface_habitable_logement,
        periodeConstruction: dpe.periode_construction,
        matchDistanceM: dpe.matchDistanceM
      } : null
    });
  }

  log(`-> ${skippedMultiLot} mutations écartées (vente multi-lots ou pas exactement 1 appartement).`);

  log(`-> ${cleaned.length} mutations exploitables après nettoyage (${matchedCount} avec DPE apparié, soit ${Math.round(matchedCount / cleaned.length * 100)}%).`);

  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });

  const outPath = path.join(config.dataDir, 'mutations.json');
  fs.writeFileSync(outPath, JSON.stringify({
    meta: {
      city: name,
      codeInsee,
      extractedAt: new Date().toISOString(),
      anneeMin: config.dvfAnneeMin,
      totalMutations: cleaned.length,
      matchedWithDpe: matchedCount
    },
    mutations: cleaned
  }, null, 2));

  log(`Fichier écrit : ${outPath}`);
}

main().catch(err => {
  console.error('[ingest] ERREUR :', err.message);
  process.exitCode = 1;
});
