const express = require('express');

const { geocodeAddress } = require('../services/banClient');
const { estimatePrice, checkListingPrice, findHistoricalOpportunities, computeRentability, getModelInfo } = require('../services/scoringService');
const config = require('../config');

const router = express.Router();

/** GET /api/info — métadonnées sur la ville pilote et le modèle. */
router.get('/info', (req, res) => {
  try {
    const modelInfo = getModelInfo();
    res.json({
      pilotCity: config.pilotCity,
      model: modelInfo,
      disclaimer: 'MVP de démonstration. Estimation indicative, ne remplace pas une expertise. DealMatch Immo ne réalise aucune intermédiation immobilière (voir CGU).'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/estimate — estime le prix d'un bien à partir d'une adresse. */
router.post('/estimate', async (req, res) => {
  try {
    const { adresse, surface, dpe, periodeConstruction } = req.body;

    if (!adresse) return res.status(400).json({ error: 'Le champ "adresse" est requis.' });
    if (!surface || surface <= 0) return res.status(400).json({ error: 'Le champ "surface" doit être un nombre positif.' });

    const geo = await geocodeAddress(adresse);
    if (!geo) return res.status(404).json({ error: 'Adresse introuvable.' });

    if (geo.codeInsee !== config.pilotCity.codeInsee) {
      return res.status(400).json({
        error: `Ce MVP ne couvre que ${config.pilotCity.name} (code INSEE ${config.pilotCity.codeInsee}). Adresse résolue dans une autre commune : ${geo.city}.`
      });
    }

    const estimation = estimatePrice({
      surface: parseFloat(surface),
      lat: geo.lat,
      lon: geo.lon,
      dpe,
      periodeConstruction
    });

    res.json({ adresseResolue: geo, estimation });
  } catch (err) {
    console.error('[api/estimate] ERREUR :', err); // trace complète en dev pour diagnostiquer les erreurs réseau
    res.status(400).json({ error: err.message, cause: err.cause ? String(err.cause) : undefined });
  }
});

/**
 * POST /api/check-listing — vérifie le prix d'une annonce que l'utilisateur a
 * trouvée ailleurs (SeLoger, Leboncoin, PAP...). L'utilisateur saisit
 * lui-même le prix affiché sur l'annonce : aucun accès aux données de ces
 * plateformes n'est nécessaire ni effectué.
 */
router.post('/check-listing', async (req, res) => {
  try {
    const { adresse, surface, dpe, periodeConstruction, prixDemande } = req.body;

    if (!adresse) return res.status(400).json({ error: 'Le champ "adresse" est requis.' });
    if (!surface || surface <= 0) return res.status(400).json({ error: 'Le champ "surface" doit être un nombre positif.' });
    if (!prixDemande || prixDemande <= 0) return res.status(400).json({ error: 'Le champ "prixDemande" doit être un nombre positif.' });

    const geo = await geocodeAddress(adresse);
    if (!geo) return res.status(404).json({ error: 'Adresse introuvable.' });

    if (geo.codeInsee !== config.pilotCity.codeInsee) {
      return res.status(400).json({
        error: `Ce MVP ne couvre que ${config.pilotCity.name} (code INSEE ${config.pilotCity.codeInsee}). Adresse résolue dans une autre commune : ${geo.city}.`
      });
    }

    const check = checkListingPrice({
      surface: parseFloat(surface),
      lat: geo.lat,
      lon: geo.lon,
      dpe,
      periodeConstruction,
      prixDemande: parseFloat(prixDemande)
    });

    res.json({ adresseResolue: geo, check });
  } catch (err) {
    console.error('[api/check-listing] ERREUR :', err);
    res.status(400).json({ error: err.message, cause: err.cause ? String(err.cause) : undefined });
  }
});

/** GET /api/opportunities — liste des biens historiquement sous-évalués (démo pédagogique). */
router.get('/opportunities', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const minDiscountPct = req.query.minDiscountPct ? parseFloat(req.query.minDiscountPct) : 10;
    const opportunities = findHistoricalOpportunities({ limit, minDiscountPct });
    res.json({ count: opportunities.length, opportunities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/rentability — calcule la rentabilité locative brute/nette. */
router.post('/rentability', (req, res) => {
  try {
    const { prixAchat, loyerMensuel, chargesAnnuelles, taxeFonciereAnnuelle } = req.body;
    const result = computeRentability({
      prixAchat: parseFloat(prixAchat),
      loyerMensuel: parseFloat(loyerMensuel),
      chargesAnnuelles: chargesAnnuelles ? parseFloat(chargesAnnuelles) : 0,
      taxeFonciereAnnuelle: taxeFonciereAnnuelle ? parseFloat(taxeFonciereAnnuelle) : 0
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
