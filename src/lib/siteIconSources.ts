/**
 * Where to look for a site's real icon, in order, for any UI that lists web sources.
 *
 * Google's resolver is first because it reads the site's `<link rel="icon">` tag, which is how most
 * official sites publish an icon — of the domains these searches actually hit, only about one in
 * eight serves anything at `/favicon.ico`, so trying that first means a failed request and a flash
 * of placeholder on nearly every row. The direct favicon is the second attempt, for the sites
 * Google has no record of.
 *
 * An icon endpoint is only usable here if it 404s on an unknown domain, so that `<img onError>`
 * can move to the next source. Google does. DuckDuckGo's `icons.duckduckgo.com` answered 200 with a
 * generic grey arrow instead, which meant it always won and no real logo was ever reached — do not
 * reintroduce it.
 */
export function siteIconSources(host: string): string[] {
  const clean = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .replace(/:\d+$/, '');
  if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return [];
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=64`,
    `https://${clean}/favicon.ico`,
  ];
}
