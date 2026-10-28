/**
 * Instrument tone (shared) — the design's per-asset-class accent used by the
 * Markets card (M1/M11) and the Markets screen (M6).
 */

export function toneForAssetClass(assetClass: string): string {
  switch (assetClass) {
    case "CRYPTO":
      return "orange";
    case "FOREX":
      return "violet";
    case "EQUITY":
      return "gray";
    default:
      return "purple";
  }
}
