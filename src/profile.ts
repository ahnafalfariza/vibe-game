import { newProfile, normalizeProfile, type Profile } from './sim/meta';

// The player's profile (rank, goals, coins, upgrades) in localStorage. The
// rules live in sim/meta.ts; this only loads and saves. Storage can be
// missing or throw (private mode, tests): the game then plays on without it.

export const PROFILE_KEY = 'yeti-set-go.profile';
/** Where the coin wallet lived before profiles. Migrated into the profile, then removed. */
export const OLD_WALLET_KEY = 'yeti-set-go.coins';

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Load (or start, migrating an old coin wallet) the profile kept in `store`. */
export function loadProfile(store: Store | null): Profile {
  if (!store) return newProfile();
  try {
    const raw = store.getItem(PROFILE_KEY);
    if (raw !== null) return normalizeProfile(JSON.parse(raw));
    const p = newProfile(Math.max(0, Math.floor(Number(store.getItem(OLD_WALLET_KEY)) || 0)));
    saveProfile(p, store);
    // Only drop the old wallet once the coins are safely in the profile.
    if (store.getItem(PROFILE_KEY) !== null) store.removeItem(OLD_WALLET_KEY);
    return p;
  } catch {
    return newProfile();
  }
}

export function saveProfile(p: Profile, store: Store | null): void {
  try {
    store?.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable or full: progress just won't persist.
  }
}

function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let current: Profile | null = null;

/** The live profile, loaded on first use. */
export function getProfile(): Profile {
  return (current ??= loadProfile(storage()));
}

/** Save the live profile. */
export function persist(): void {
  saveProfile(getProfile(), storage());
}

/** Dev aid (?profile=reset): start over from a blank profile. */
export function resetProfile(): void {
  const store = storage();
  try {
    store?.removeItem(PROFILE_KEY);
    store?.removeItem(OLD_WALLET_KEY);
  } catch {
    // Nothing stored to wipe.
  }
  current = newProfile();
  persist();
}

/** Dev aid (?coins=5000): top the wallet up to at least `coins` (idempotent across reloads). */
export function topUpCoins(coins: number): void {
  const p = getProfile();
  p.coins = Math.max(p.coins, Math.min(1e7, Math.floor(coins)));
  persist();
}
