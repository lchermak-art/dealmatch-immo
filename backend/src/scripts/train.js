/**
 * Entraîne le modèle d'estimation de prix (AVM) sur les données ingérées,
 * en 3 étapes qui reproduisent les paliers de précision cités dans le guide
 * business (14% -> 11% -> 9% de MAPE) :
 *   Modèle A : surface + tendance temporelle seules (proxy "DVF brut")
 *   Modèle B : + étiquette DPE
 *   Modèle C : + localisation (distance au centre + quartier k-means)
 *
 * Cible : log(prix_m2) ~ log(surface) + tendance + dpe_score + localisation
 * (log-linéaire : plus stable qu'une régression sur le prix brut, et
 * cohérent avec la pratique standard des AVM immobiliers.)
 *
 * Usage : npm run train (nécessite d'avoir lancé `npm run ingest` avant)
 */

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { ols, predict } = require('../lib/linearAlgebra');
const { kmeans } = require('../lib/kmeans');

const N_CLUSTERS = 35; // Toulouse est une grande ville : un découpage fin capte mieux les écarts de prix par micro-secteur
const TEST_RATIO = 0.2;
const RNG_SEED = 7;
const MAX_DPE_MATCH_DISTANCE_M = 80; // au-delà, le DPE apparié est trop incertain géographiquement

const DPE_SCORE = { A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, G: 1 };

// Score ordinal croissant avec la récence de construction (proxy simple de
// l'effet "ancien vs récent" sur le prix, à défaut d'une année de
// construction précise dans le DVF).
const PERIODE_SCORE = {
  'avant 1948': 1,
  '1948-1974': 2,
  '1975-1977': 3,
  '1978-1982': 4,
  '1983-1988': 5,
  '1989-2000': 6,
  '2001-2005': 7,
  '2006-2012': 8,
  '2013-2021': 9,
  'après 2021': 10
};

function log(msg) { console.log(`[train] ${msg}`); }

function seededShuffle(arr, seed) {
  let s = seed;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function mape(actual, predicted) {
  const errors = actual.map((a, i) => Math.abs((a - predicted[i]) / a));
  return errors.reduce((s, e) => s + e, 0) / errors.length;
}

function percentile(sortedArr, p) {
  return sortedArr[Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p))];
}

/** Construit une ligne de features. */
function buildRow(r, includeDpe, includeLocation) {
  const row = [1, r.logSurface, r.logSurface ** 2, r.yearTrend]; // intercept, log(surface), log(surface)^2, tendance annuelle
  if (includeDpe) row.push(r.dpeScore, r.periodeScore);
  if (includeLocation) row.push(r.distCenterKm, ...r.clusterOneHot);
  return row;
}

function trainAndEvaluate(name, trainSet, testSet, includeDpe, includeLocation) {
  const Xtrain = trainSet.map(r => buildRow(r, includeDpe, includeLocation));
  const yTrain = trainSet.map(r => r.logPrixM2);

  const beta = ols(Xtrain, yTrain);

  const Xtest = testSet.map(r => buildRow(r, includeDpe, includeLocation));
  const predictedLogPrixM2 = Xtest.map(x => predict(beta, x));
  const predictedValeurfonc = predictedLogPrixM2.map((lp, i) => Math.exp(lp) * testSet[i].sbati);
  const actualValeurfonc = testSet.map(r => r.valeurfonc);

  const error = mape(actualValeurfonc, predictedValeurfonc);
  log(`${name} — MAPE sur le jeu de test (${testSet.length} biens) : ${(error * 100).toFixed(1)}%`);

  return { beta, mape: error };
}

function main() {
  const dataPath = path.join(config.dataDir, 'mutations.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Fichier introuvable : ${dataPath}. Lancez d'abord "npm run ingest".`);
  }

  const { meta, mutations } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  log(`Chargement de ${mutations.length} mutations (${meta.city}).`);

  // Ne garder que les biens avec DPE apparié à moins de MAX_DPE_MATCH_DISTANCE_M —
  // un DPE apparié à 150m peut appartenir à un immeuble différent (donc une
  // étiquette non représentative), ce qui ajoute du bruit pur au modèle B/C.
  const usable = mutations.filter(
    m => m.dpe && m.dpe.etiquette && DPE_SCORE[m.dpe.etiquette]
      && m.dpe.periodeConstruction && PERIODE_SCORE[m.dpe.periodeConstruction]
      && m.dpe.matchDistanceM <= MAX_DPE_MATCH_DISTANCE_M
  );
  log(`${usable.length} mutations utilisables (DPE apparié à <${MAX_DPE_MATCH_DISTANCE_M}m + étiquette valide).`);

  // Écrêtage des outliers de prix au m² (1er/99e centile) — quelques ventes
  // très en dessous ou très au-dessus du marché (vente familiale, parking
  // classé "appartement" par erreur de code, etc.) déforment sinon le MAPE.
  const sortedPrix = [...usable].map(m => m.prixM2).sort((a, b) => a - b);
  const lowBound = percentile(sortedPrix, 0.01);
  const highBound = percentile(sortedPrix, 0.99);
  const trimmed = usable.filter(m => m.prixM2 >= lowBound && m.prixM2 <= highBound);
  log(`${trimmed.length} mutations après écrêtage 1er/99e centile (bornes : ${lowBound.toFixed(0)}–${highBound.toFixed(0)} €/m²).`);

  // --- Feature engineering géographique ---
  const centerLat = trimmed.reduce((s, m) => s + m.lat, 0) / trimmed.length;
  const centerLon = trimmed.reduce((s, m) => s + m.lon, 0) / trimmed.length;

  const points = trimmed.map(m => [m.lat, m.lon]);
  const { assignments, centroids } = kmeans(points, N_CLUSTERS, { seed: RNG_SEED });
  log(`Quartiers (clusters géographiques) constitués : ${centroids.length}.`);

  const minYear = Math.min(...trimmed.map(m => m.anneemut));

  const rows = trimmed.map((m, i) => {
    const clusterOneHot = new Array(N_CLUSTERS - 1).fill(0);
    if (assignments[i] > 0) clusterOneHot[assignments[i] - 1] = 1;

    // distance euclidienne en degrés x ~111km/degré (approximation suffisante à l'échelle d'une ville)
    const distCenterKm = Math.sqrt((m.lat - centerLat) ** 2 + (m.lon - centerLon) ** 2) * 111;

    return {
      valeurfonc: m.valeurfonc,
      sbati: m.sbati,
      logPrixM2: Math.log(m.prixM2),
      logSurface: Math.log(m.sbati),
      yearTrend: m.anneemut - minYear,
      dpeScore: DPE_SCORE[m.dpe.etiquette],
      periodeScore: PERIODE_SCORE[m.dpe.periodeConstruction],
      distCenterKm,
      clusterOneHot
    };
  });

  const shuffled = seededShuffle(rows, RNG_SEED);
  const splitIdx = Math.floor(shuffled.length * (1 - TEST_RATIO));
  const trainSet = shuffled.slice(0, splitIdx);
  const testSet = shuffled.slice(splitIdx);
  log(`Split train/test : ${trainSet.length} / ${testSet.length}.`);

  log('--- Entraînement des 3 modèles (paliers de précision) ---');
  const modelA = trainAndEvaluate('Modèle A (surface + tendance seules)', trainSet, testSet, false, false);
  const modelB = trainAndEvaluate('Modèle B (+ DPE)', trainSet, testSet, true, false);
  const modelC = trainAndEvaluate('Modèle C (+ localisation)', trainSet, testSet, true, true);

  const bestModel = modelC; // le modèle final retenu pour l'API est toujours le plus complet

  const output = {
    trainedAt: new Date().toISOString(),
    city: meta.city,
    codeInsee: meta.codeInsee,
    nSamplesTotal: trimmed.length,
    nSamplesTrain: trainSet.length,
    nSamplesTest: testSet.length,
    minYear,
    nClusters: N_CLUSTERS,
    clusterCentroids: centroids, // [lat, lon] par cluster
    cityCenter: { lat: centerLat, lon: centerLon },
    dpeScoreMap: DPE_SCORE,
    periodeScoreMap: PERIODE_SCORE,
    benchmarks: {
      modelA_surfaceOnly: { mape: modelA.mape },
      modelB_withDpe: { mape: modelB.mape },
      modelC_withLocation: { mape: modelC.mape }
    },
    finalModel: {
      description: 'log(prix_m2) = b0 + b1*log(surface) + b2*tendance_annuelle + b3*score_dpe + b4*score_periode_construction + b5*distance_centre_km + b6..*quartier(one-hot, ref=cluster0)',
      beta: bestModel.beta
    }
  };

  const outPath = path.join(config.dataDir, 'model.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  log(`Modèle écrit : ${outPath}`);
  log('');
  log('=== Résumé (à comparer aux benchmarks du guide business : 14% / 11% / 9%) ===');
  log(`  Surface seule   : ${(modelA.mape * 100).toFixed(1)}%`);
  log(`  + DPE           : ${(modelB.mape * 100).toFixed(1)}%`);
  log(`  + Localisation  : ${(modelC.mape * 100).toFixed(1)}%`);
}

main();
