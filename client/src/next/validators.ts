// Validator identity → display name, from Solana Compass (CORS-open, ~50 KB gzipped).
// The endpoint falls back to the first 8 chars of the identity when a validator
// has no name; treat that as unnamed so callers can show a proper short key.
const names = new Map<string, string>();

export function loadValidatorNames() {
  fetch('https://solanacompass.com/api/live/validators')
    .then((r) => r.json())
    .then((d: Record<string, { name?: string }>) => {
      for (const [id, v] of Object.entries(d)) {
        if (v?.name && v.name !== id.slice(0, 8)) names.set(id, v.name);
      }
    })
    .catch(() => {});
}

export function validatorName(identity: string): string | undefined {
  return names.get(identity);
}
