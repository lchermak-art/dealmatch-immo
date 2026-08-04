/**
 * Petit client HTTP avec retries — l'API DVF+ (Cerema, environnement de
 * préproduction) renvoie des 503 par intermittence sous charge. Sans retry,
 * l'ingestion échoue au hasard.
 */

const DEFAULT_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 3000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url, { retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, timeoutMs = 30000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);

      if (res.ok) {
        return await res.json();
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        lastError = new Error(`HTTP ${res.status} sur ${url}`);
        await sleep(retryDelayMs);
        continue;
      }

      throw new Error(`HTTP ${res.status} sur ${url} : ${await res.text().catch(() => '')}`);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) {
        await sleep(retryDelayMs);
        continue;
      }
    }
  }

  throw lastError || new Error(`Échec de la requête vers ${url}`);
}

module.exports = { fetchJsonWithRetry };
