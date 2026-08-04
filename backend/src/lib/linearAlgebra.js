/**
 * Petites primitives d'algèbre linéaire pour la régression OLS, sans
 * dépendance externe (pas de numpy/sklearn disponibles en JS).
 */

/** Résout Ax = b par élimination de Gauss avec pivot partiel. A est carrée. */
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) {
      M[col][col] = 1e-12; // évite une division par ~0 (colinéarité résiduelle)
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/** Régression OLS multiple : X (n_samples x n_features), y (n_samples). Retourne les coefficients beta. */
function ols(X, y) {
  const nFeatures = X[0].length;
  const XtX = Array.from({ length: nFeatures }, () => new Array(nFeatures).fill(0));
  const Xty = new Array(nFeatures).fill(0);

  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < nFeatures; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < nFeatures; k++) {
        XtX[j][k] += X[i][j] * X[i][k];
      }
    }
  }

  return solveLinearSystem(XtX, Xty);
}

function predict(beta, xRow) {
  return beta.reduce((sum, b, j) => sum + b * xRow[j], 0);
}

module.exports = { ols, predict, solveLinearSystem };
