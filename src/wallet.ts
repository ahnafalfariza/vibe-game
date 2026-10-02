// Lifetime coin wallet: every run's coins are added at game over. Coins are
// currency for the (future) shop, not score.

const WALLET_KEY = 'yeti-set-go.coins';

export function loadWallet(): number {
  try {
    return Number(localStorage.getItem(WALLET_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Add a run's coins; returns the new total. */
export function addToWallet(coins: number): number {
  const total = loadWallet() + Math.max(0, Math.floor(coins));
  try {
    localStorage.setItem(WALLET_KEY, String(total));
  } catch {
    // Storage unavailable: the wallet just won't persist.
  }
  return total;
}
