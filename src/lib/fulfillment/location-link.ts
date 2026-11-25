/**
 * The optional "Location link (Waze / Google Maps)" on a delivery address. Only links to Waze and
 * Google Maps are accepted, so nothing else reaches the courier's screen. Pure — the browser and the
 * server use the same check.
 */
export type LocationLinkKind = "waze" | "google";
export type LocationLink = { url: string; kind: LocationLinkKind };

export const LOCATION_LINK_MAX = 500;

function kindOf(url: URL): LocationLinkKind | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === "waze.com" || host === "www.waze.com" || host === "ul.waze.com") return "waze";
  if (host === "maps.app.goo.gl" || host === "maps.google.com") return "google";
  if (host === "goo.gl" && path.startsWith("/maps")) return "google";
  // google.com / google.co.il (with or without www), /maps path only
  if (/^(www\.)?google\.(com|co\.il)$/.test(host) && path.startsWith("/maps")) return "google";
  return null;
}

/**
 * A pasted link (also when shared with text around it, e.g. "Meet me here https://waze.com/ul/…"),
 * as a clean https URL with its kind; null when it is not a Waze / Google Maps link.
 */
export function parseLocationLink(input: string | null | undefined): LocationLink | null {
  const text = String(input ?? "").trim();
  if (!text || text.length > LOCATION_LINK_MAX * 2) return null;
  const found = /(https?:\/\/[^\s<>"']+)/i.exec(text)?.[1] ?? (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(text) ? `https://${text}` : null);
  if (!found || found.length > LOCATION_LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(found);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443")) return null;
  const kind = kindOf(url);
  if (!kind) return null;
  url.protocol = "https:";
  return { url: url.toString(), kind };
}
