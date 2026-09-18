'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.readingNotation = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
const greek = { α: 'alpha', β: 'beta', γ: 'gamma', ζ: 'zeta', η: 'eta', ι: 'iota', κ: 'kappa', ν: 'nu', ξ: 'xi', υ: 'upsilon', χ: 'chi', ϑ: 'vartheta', ϕ: 'phi', ϵ: 'epsilon', δ: 'delta', ε: 'epsilon', θ: 'theta', λ: 'lambda', μ: 'mu', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', φ: 'phi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' };
const subscripts = '₀₁₂₃₄₅₆₇₈₉ᵢⱼₙₖ';
const subvalues = '0123456789ijnk';

// Normalize spelling, never mathematical meaning: X, x, x_i and bold x stay distinct.
function referenceKey(value) {
  return String(value || '').normalize('NFC').trim()
    .replace(/^\$\$([\s\S]*)\$\$$/u, '$1').replace(/^\$([\s\S]*)\$$/u, '$1')
    .replace(/^\\\(([\s\S]*)\\\)$/u, '$1').replace(/^\\\[([\s\S]*)\\\]$/u, '$1')
    .replace(/\p{Script=Greek}/gu, (letter) => greek[letter] ? `\\${greek[letter]}` : letter)
    .replace(/[₀₁₂₃₄₅₆₇₈₉ᵢⱼₙₖ]+/gu, (run) => `_{${[...run].map((letter) => subvalues[subscripts.indexOf(letter)]).join('')}}`)
    .replace(/([_^])\{([^{}])\}/gu, '$1$2')
    .replace(/\s*([_^])\s*/gu, '$1')
    .replace(/\s+/gu, ' ').trim();
}

function isNotation(value) {
  const key = referenceKey(value);
  return /^(?:\\(?:mathbf|boldsymbol|mathbb|mathcal|mathrm|hat|bar|tilde|vec)\{[^{}]+\}|\\[A-Za-z]+|[A-Za-z\p{Script=Greek}])(?:[_^](?:\{[^{}]+\}|\\[A-Za-z]+|[A-Za-z0-9]))*$/u.test(key);
}

// Search tolerates flattened PDF subscripts. Never use this for storage,
// deduplication or automatic lookup: x1 and x_1 may be different objects.
function matchesReferenceSearch(entry, value) {
  const query = String(value || '').trim();
  if (!query) return true;
  const key = referenceKey(query);
  if (isNotation(query) || /^(?:\\[A-Za-z]+|[A-Za-z])[0-9]+$/u.test(key)) {
    const searchKey = (symbol) => referenceKey(symbol)
      .replace(/_\{([A-Za-z0-9]+)\}/gu, '$1').replace(/_([A-Za-z0-9])/gu, '$1');
    return searchKey(entry.symbol) === searchKey(query);
  }
  return `${entry.symbol} ${entry.meaning} ${entry.scope || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

return { referenceKey, isNotation, matchesReferenceSearch };
});
