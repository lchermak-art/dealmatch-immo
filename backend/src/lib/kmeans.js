/**
 * K-means minimaliste (2D, lat/lon) — sert à approximer un découpage en
 * "quartiers" à partir des seules coordonnées géographiques, sans dépendre
 * d'un référentiel IRIS/quartier externe pour le MVP.
 */

function distSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function kmeans(points, k, { maxIterations = 50, seed = 42 } = {}) {
  // RNG déterministe (mulberry32) pour des runs reproductibles.
  let s = seed;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Initialisation : k points choisis au hasard parmi les données (k-means++ simplifié via échantillonnage uniforme, suffisant pour un MVP).
  const centroids = [];
  const usedIdx = new Set();
  while (centroids.length < k && centroids.length < points.length) {
    const idx = Math.floor(rand() * points.length);
    if (usedIdx.has(idx)) continue;
    usedIdx.add(idx);
    centroids.push([...points[idx]]);
  }

  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    for (let i = 0; i < points.length; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = distSq(points[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (assignments[i] !== best) changed = true;
      assignments[i] = best;
    }

    const sums = centroids.map(() => [0, 0, 0]);
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      sums[c][0] += points[i][0];
      sums[c][1] += points[i][1];
      sums[c][2] += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][2] > 0) {
        centroids[c][0] = sums[c][0] / sums[c][2];
        centroids[c][1] = sums[c][1] / sums[c][2];
      }
    }

    if (!changed) break;
  }

  return { assignments, centroids };
}

function nearestCluster(point, centroids) {
  let best = 0, bestDist = Infinity;
  for (let c = 0; c < centroids.length; c++) {
    const d = distSq(point, centroids[c]);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

module.exports = { kmeans, nearestCluster };
