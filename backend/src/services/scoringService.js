const fs = require('fs');
const path = require('path');

const config = require('../config');
const { predict } = require('../lib/linearAlgebra');
const { nearestCluster } = require('../lib/kmeans');

let modelCache = null;
let mutationsCache = null;

function loadModel() {
  if (modelCache) return modelCache;
  const modelPath = path.join(config.dataDir, 'model.json');
  if (!fs.existsSync(modelPath)) {
    throw new Error('Modèle introuvable. Lancez "npm run ingest" puis "npm run train" avant de démarrer le serveur.');
  }
  modelCache = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  return modelCache;
}

function loadMutations() {
  if (mutationsCache) return mutationsCache;
  const dataPath = path.join(config.dataDir, 'mutations.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error('Données introuvables. Lancez "npm run ingest" avant de démarrer le serveur.');
  }
  mutationsCache = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return mutationsCache;
}

/**
 * Estime le prix au m² (et donc le prix total) d'un appartement à partir de
 * sa surface, sa localisation (lat/lon) et ses caractéristiques DPE.
 *
 * @param {object} input
 * @param {number} input.surface - surface habitable en m²
 * @param {number} input.lat
 * @param {number} input.lon
 * @param {string} [input.dpe] - étiquette DPE (A-G), optionnelle
 * @param {string} [input.periodeConstruction] - une des tranches ADEME, optionnelle
 * @param {number} [input.annee] - année de référence pour l'estimation (défaut : année courante)
 */
function estimatePrice({ surface, lat, lon, dpe, periodeConstruction, annee }) {
  const model = loadModel();

  if (!surface || surface <= 0) throw new Error('Surface invalide.');
  if (typeof lat !== 'number' || typeof lon !== 'number') throw new Error('Coordonnées invalides.');

  const logSurface = Math.log(surface);
  const yearTrend = (annee || new Date().getFullYear()) - model.minYear;

  const dpeScore = dpe && model.dpeScoreMap[dpe] ? model.dpeScoreMap[dpe] : averageValue(model.dpeScoreMap);
  const periodeScore = periodeConstruction && model.periodeScoreMap[periodeConstruction]
    ? model.periodeScoreMap[periodeConstruction]
    : averageValue(model.periodeScoreMap);

  const distCenterKm = Math.sqrt((lat - model.cityCenter.lat) ** 2 + (lon - model.cityCenter.lon) ** 2) * 111;
  const clusterIdx = nearestCluster([lat, lon], model.clusterCentroids);
  const clusterOneHot = new Array(model.nClusters - 1).fill(0);
  if (clusterIdx > 0) clusterOneHot[clusterIdx - 1] = 1;

  const featureRow = [1, logSurface, logSurface ** 2, yearTrend, dpeScore, periodeScore, distCenterKm, ...clusterOneHot];
  const logPrixM2 = predict(model.finalModel.beta, featureRow);
  const prixM2 = Math.exp(logPrixM2);
  const prixEstime = prixM2 * surface;

  // Intervalle de confiance simple basé sur le MAPE du modèle retenu — pas un
  // vrai intervalle statistique, mais une fourchette honnête à afficher côté
  // utilisateur plutôt qu'un chiffre unique trompeur de fausse précision.
  const marginRatio = model.benchmarks.modelC_withLocation.mape;

  return {
    prixEstime: Math.round(prixEstime),
    prixM2Estime: Math.round(prixM2),
    fourchetteBasse: Math.round(prixEstime * (1 - marginRatio)),
    fourchetteHaute: Math.round(prixEstime * (1 + marginRatio)),
    margeErreurIndicative: Math.round(marginRatio * 1000) / 10, // en %
    clusterIdx,
    distCenterKm: Math.round(distCenterKm * 100) / 100
  };
}

function averageValue(scoreMap) {
  const values = Object.values(scoreMap);
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// Au-delà de cette décote, l'écart dépasse largement la marge d'erreur du
// modèle (~20%) et signale presque toujours une vente atypique (succession,
// cession familiale, bien sinistré non reflété par le DPE) plutôt qu'une
// vraie opportunité de marché. On les exclut pour ne pas présenter un signal
// trompeur — un vrai produit croiserait ces cas avec plus de contexte
// (nature de la mutation, lien entre acheteur/vendeur) avant de les afficher.
const MAX_CREDIBLE_DISCOUNT_PCT = 40;

/**
 * Recherche les "opportunités" : biens du jeu de données dont le prix réel
 * de vente est significativement inférieur au prix estimé par le modèle
 * pour un bien comparable — au moment de la vente. Sert de proxy pédagogique
 * pour la fonctionnalité de détection d'écarts (dans le vrai produit, on
 * comparerait aux ANNONCES actuelles, pas aux ventes DVF passées).
 */
function findHistoricalOpportunities({ limit = 20, minDiscountPct = 10 } = {}) {
  const { mutations } = loadMutations();
  const model = loadModel();

  const scored = mutations
    .filter(m => m.dpe && m.dpe.etiquette)
    .map(m => {
      let estimate;
      try {
        estimate = estimatePrice({
          surface: m.sbati,
          lat: m.lat,
          lon: m.lon,
          dpe: m.dpe.etiquette,
          periodeConstruction: m.dpe.periodeConstruction,
          annee: m.anneemut
        });
      } catch {
        return null;
      }

      const discountPct = ((estimate.prixEstime - m.valeurfonc) / estimate.prixEstime) * 100;

      return {
        idmutation: m.idmutation,
        datemut: m.datemut,
        surface: m.sbati,
        prixVente: m.valeurfonc,
        prixM2Vente: m.prixM2,
        prixEstime: estimate.prixEstime,
        prixM2Estime: estimate.prixM2Estime,
        discountPct: Math.round(discountPct * 10) / 10,
        lat: m.lat,
        lon: m.lon,
        dpe: m.dpe.etiquette
      };
    })
    .filter(Boolean)
    .filter(o => o.discountPct >= minDiscountPct && o.discountPct <= MAX_CREDIBLE_DISCOUNT_PCT)
    .sort((a, b) => b.discountPct - a.discountPct)
    .slice(0, limit);

  return scored;
}

/** Rentabilité locative simple à partir d'un prix d'achat et d'un loyer mensuel estimé. */
function computeRentability({ prixAchat, loyerMensuel, chargesAnnuelles = 0, taxeFonciereAnnuelle = 0 }) {
  if (!prixAchat || prixAchat <= 0) throw new Error('Prix d\'achat invalide.');
  if (!loyerMensuel || loyerMensuel <= 0) throw new Error('Loyer mensuel invalide.');

  const loyerAnnuel = loyerMensuel * 12;
  const rentabiliteBrute = (loyerAnnuel / prixAchat) * 100;

  const chargesTotales = chargesAnnuelles + taxeFonciereAnnuelle;
  const revenuNet = loyerAnnuel - chargesTotales;
  const rentabiliteNette = (revenuNet / prixAchat) * 100;

  return {
    loyerAnnuel: Math.round(loyerAnnuel),
    rentabiliteBrute: Math.round(rentabiliteBrute * 100) / 100,
    rentabiliteNette: Math.round(rentabiliteNette * 100) / 100,
    revenuNetAnnuel: Math.round(revenuNet)
  };
}

function getModelInfo() {
  const model = loadModel();
  return {
    city: model.city,
    codeInsee: model.codeInsee,
    trainedAt: model.trainedAt,
    nSamplesTotal: model.nSamplesTotal,
    nSamplesTrain: model.nSamplesTrain,
    nSamplesTest: model.nSamplesTest,
    benchmarks: model.benchmarks
  };
}

module.exports = { estimatePrice, findHistoricalOpportunities, computeRentability, getModelInfo };
