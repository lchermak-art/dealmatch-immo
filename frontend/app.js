(function () {
  const API_BASE = ''; // même origine : le backend sert aussi ce fichier statique

  const fmtEUR = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
  const fmtPct = n => `${n}%`;

  // --- Tabs ---
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // --- Info badge ---
  async function loadInfo() {
    try {
      const res = await fetch(`${API_BASE}/api/info`);
      const data = await res.json();
      const mape = (data.model.benchmarks.modelC_withLocation.mape * 100).toFixed(1);
      document.getElementById('cityBadge').textContent =
        `${data.pilotCity.name} — ${data.model.nSamplesTotal.toLocaleString('fr-FR')} transactions — MAPE ${mape}%`;
    } catch (err) {
      document.getElementById('cityBadge').textContent = 'Backend indisponible';
    }
  }

  // --- Check listing tab ---
  const btnCheckListing = document.getElementById('btnCheckListing');
  const checkListingError = document.getElementById('checkListingError');
  const checkListingResult = document.getElementById('checkListingResult');

  const VERDICT_LABELS = {
    tres_sous_evalue: '🟢 Très sous-évalué — bonne opportunité potentielle',
    sous_evalue: '🟢 Sous-évalué',
    prix_marche: '🟡 Dans le prix du marché',
    surcote: '🔴 Surcoté',
    tres_surcote: '🔴 Très surcoté — prix élevé par rapport au marché'
  };

  btnCheckListing.addEventListener('click', async () => {
    checkListingError.classList.remove('visible');
    checkListingResult.classList.remove('visible');

    const adresse = document.getElementById('clAdresse').value.trim();
    const surface = parseFloat(document.getElementById('clSurface').value);
    const prixDemande = parseFloat(document.getElementById('clPrixDemande').value);
    const dpe = document.getElementById('clDpe').value;
    const periodeConstruction = document.getElementById('clPeriode').value;

    if (!adresse) { showError(checkListingError, 'Veuillez saisir une adresse.'); return; }
    if (!surface || surface <= 0) { showError(checkListingError, 'Veuillez saisir une surface valide.'); return; }
    if (!prixDemande || prixDemande <= 0) { showError(checkListingError, 'Veuillez saisir le prix demandé sur l\'annonce.'); return; }

    btnCheckListing.disabled = true;
    btnCheckListing.textContent = 'Vérification en cours…';

    try {
      const res = await fetch(`${API_BASE}/api/check-listing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adresse, surface, prixDemande,
          dpe: dpe || undefined,
          periodeConstruction: periodeConstruction || undefined
        })
      });
      const data = await res.json();

      if (!res.ok) { showError(checkListingError, data.error || 'Erreur inconnue.'); return; }

      const c = data.check;
      checkListingResult.className = `verdict-box visible tone-${c.tone}`;
      document.getElementById('clVerdictBadge').textContent = VERDICT_LABELS[c.verdict] || c.label;
      document.getElementById('clPrixDemandeOut').textContent = fmtEUR(c.prixDemande);
      document.getElementById('clPrixEstimeOut').textContent = fmtEUR(c.prixEstime);
      document.getElementById('clFourchetteOut').textContent = `${fmtEUR(c.fourchetteBasse)} – ${fmtEUR(c.fourchetteHaute)}`;
      const ecartLabel = c.ecartPct >= 0 ? `${c.ecartPct}% moins cher que l'estimation` : `${Math.abs(c.ecartPct)}% plus cher que l'estimation`;
      document.getElementById('clEcartOut').textContent = ecartLabel;
      document.getElementById('clAdresseOut').textContent = data.adresseResolue.label;
      document.getElementById('clMargeOut').textContent = fmtPct(c.margeErreurIndicative);
    } catch (err) {
      showError(checkListingError, 'Impossible de contacter le serveur.');
    } finally {
      btnCheckListing.disabled = false;
      btnCheckListing.textContent = 'Vérifier ce prix';
    }
  });

  // --- Estimate tab ---
  const btnEstimate = document.getElementById('btnEstimate');
  const estimateError = document.getElementById('estimateError');
  const estimateResult = document.getElementById('estimateResult');

  btnEstimate.addEventListener('click', async () => {
    estimateError.classList.remove('visible');
    estimateResult.classList.remove('visible');

    const adresse = document.getElementById('inpAdresse').value.trim();
    const surface = parseFloat(document.getElementById('inpSurface').value);
    const dpe = document.getElementById('inpDpe').value;
    const periodeConstruction = document.getElementById('inpPeriode').value;

    if (!adresse) { showError(estimateError, 'Veuillez saisir une adresse.'); return; }
    if (!surface || surface <= 0) { showError(estimateError, 'Veuillez saisir une surface valide.'); return; }

    btnEstimate.disabled = true;
    btnEstimate.textContent = 'Estimation en cours…';

    try {
      const res = await fetch(`${API_BASE}/api/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adresse, surface, dpe: dpe || undefined, periodeConstruction: periodeConstruction || undefined })
      });
      const data = await res.json();

      if (!res.ok) { showError(estimateError, data.error || 'Erreur inconnue.'); return; }

      document.getElementById('resPrice').textContent = fmtEUR(data.estimation.prixEstime);
      document.getElementById('resRange').textContent =
        `Fourchette indicative : ${fmtEUR(data.estimation.fourchetteBasse)} — ${fmtEUR(data.estimation.fourchetteHaute)}`;
      document.getElementById('resPrixM2').textContent = fmtEUR(data.estimation.prixM2Estime) + '/m²';
      document.getElementById('resMarge').textContent = fmtPct(data.estimation.margeErreurIndicative);
      document.getElementById('resDistCenter').textContent = `${data.estimation.distCenterKm} km`;
      document.getElementById('resAdresse').textContent = data.adresseResolue.label;

      estimateResult.classList.add('visible');
    } catch (err) {
      showError(estimateError, 'Impossible de contacter le serveur d\'estimation.');
    } finally {
      btnEstimate.disabled = false;
      btnEstimate.textContent = 'Estimer le prix';
    }
  });

  function showError(el, message) {
    el.textContent = message;
    el.classList.add('visible');
  }

  // --- Opportunities tab ---
  const oppContainer = document.getElementById('oppContainer');
  const filterDiscount = document.getElementById('filterDiscount');
  const btnRefreshOpp = document.getElementById('btnRefreshOpp');

  async function loadOpportunities() {
    oppContainer.innerHTML = '<div class="loading">Chargement des opportunités…</div>';
    try {
      const minDiscountPct = filterDiscount.value;
      const res = await fetch(`${API_BASE}/api/opportunities?limit=25&minDiscountPct=${minDiscountPct}`);
      const data = await res.json();

      if (!data.opportunities || !data.opportunities.length) {
        oppContainer.innerHTML = '<div class="loading">Aucune opportunité trouvée pour ce seuil de décote.</div>';
        return;
      }

      const rows = data.opportunities.map(o => `
        <tr>
          <td>${new Date(o.datemut).toLocaleDateString('fr-FR')}</td>
          <td>${o.surface} m²</td>
          <td>${fmtEUR(o.prixVente)}</td>
          <td>${fmtEUR(o.prixEstime)}</td>
          <td><span class="discount-tag">-${o.discountPct}%</span></td>
          <td><span class="dpe-tag dpe-${o.dpe}">${o.dpe}</span></td>
        </tr>
      `).join('');

      oppContainer.innerHTML = `
        <table class="opp-table">
          <thead>
            <tr>
              <th>Date de vente</th>
              <th>Surface</th>
              <th>Prix de vente</th>
              <th>Prix estimé (modèle)</th>
              <th>Écart</th>
              <th>DPE</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch (err) {
      oppContainer.innerHTML = '<div class="loading">Impossible de charger les opportunités.</div>';
    }
  }

  btnRefreshOpp.addEventListener('click', loadOpportunities);
  filterDiscount.addEventListener('change', loadOpportunities);

  // --- Rentability tab ---
  const btnRentability = document.getElementById('btnRentability');
  const rentabilityError = document.getElementById('rentabilityError');
  const rentabilityResult = document.getElementById('rentabilityResult');

  btnRentability.addEventListener('click', async () => {
    rentabilityError.classList.remove('visible');
    rentabilityResult.classList.remove('visible');

    const prixAchat = parseFloat(document.getElementById('inpPrixAchat').value);
    const loyerMensuel = parseFloat(document.getElementById('inpLoyer').value);
    const chargesAnnuelles = parseFloat(document.getElementById('inpCharges').value) || 0;
    const taxeFonciereAnnuelle = parseFloat(document.getElementById('inpTaxeFonciere').value) || 0;

    try {
      const res = await fetch(`${API_BASE}/api/rentability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prixAchat, loyerMensuel, chargesAnnuelles, taxeFonciereAnnuelle })
      });
      const data = await res.json();

      if (!res.ok) { showError(rentabilityError, data.error || 'Erreur inconnue.'); return; }

      document.getElementById('resRentabiliteBrute').textContent = fmtPct(data.rentabiliteBrute);
      document.getElementById('resRentabiliteNette').textContent = fmtPct(data.rentabiliteNette);
      document.getElementById('resLoyerAnnuel').textContent = fmtEUR(data.loyerAnnuel);
      document.getElementById('resRevenuNet').textContent = fmtEUR(data.revenuNetAnnuel);

      rentabilityResult.classList.add('visible');
    } catch (err) {
      showError(rentabilityError, 'Impossible de contacter le serveur.');
    }
  });

  // --- Init ---
  loadInfo();
  loadOpportunities();
})();
