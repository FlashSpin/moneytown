/** A fund's price for display: dollars and cents (the proxies are US-listed). */
export function formatFundPrice(usd: number): string {
  if (!(usd > 0)) return "—";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
