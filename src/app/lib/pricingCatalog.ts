// Public plan defaults are marketing/admin presets only. Runtime debits are
// always authorized from billing_balance.token_price_idr on the server.
export const ADVERTISED_PLAN_TOKEN_PRICE_IDR = {
  core: 250,
  full: 1250,
} as const;

export function formatIdrAmount(value: number): string {
  return Number(value).toLocaleString("id-ID");
}
