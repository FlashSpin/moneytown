/**
 * Market-data sources switched off by the operator: DISABLE_SOURCES is a
 * comma-separated list of kraken, coingecko, trending, feargreed, coinbase.
 * The rest carry on (see docs/operations.md).
 */
export function disabledSources(value = process.env.DISABLE_SOURCES): Set<string> {
  return new Set((value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}
