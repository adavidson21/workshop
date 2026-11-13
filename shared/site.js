/* Workshop: where Workshop and its apps live on the web (docs/site.md). The one place for site addresses:
   the agent, shell, shared files, apps and Worker import this, and tests/check-site.mjs fails when runtime code
   names a site anywhere else. Plain data, no imports, so Node and the browser can both load it. Apps in their
   own repos copy it with the other shared files (docs/bundle.md). */
const WORKSHOP = 'https://workshop.alexisdavidson.org';
const DOCKET = 'https://docket.alexisdavidson.org';

export const SITE = Object.freeze({
  site: 1,
  name: 'Workshop',
  workshop: WORKSHOP,
  // Apps that had a site of their own, by app id. Retired: these domains redirect to Pop out (docs/site.md).
  apps: Object.freeze({
    prioritizer: DOCKET,
    runway: 'https://runway.alexisdavidson.org',
    receipts: 'https://receipts.alexisdavidson.org',
    notes: 'https://notes.alexisdavidson.org',
    // Dispatch's old domain: Dispatch is part of Loom (app id slate) since Loom 4.0.0.
    slate: 'https://dispatch.alexisdavidson.org'
  }),
  // Sites a new install allows to pair (config hosted.origins); each still needs a click in the pairing window.
  allowedSites: Object.freeze([WORKSHOP, 'https://dispatch.alexisdavidson.org', DOCKET, 'https://runway.alexisdavidson.org', 'https://receipts.alexisdavidson.org', 'https://notes.alexisdavidson.org']),
  // Breadcrumbs back to the owner's site, on pages whose host is `domain` or a subdomain of it.
  crumbs: Object.freeze({
    domain: 'alexisdavidson.org',
    links: Object.freeze([
      Object.freeze({ title: 'LifeKit', href: 'https://tools.alexisdavidson.org/' }),
      Object.freeze({ title: 'Office', href: 'https://tools.alexisdavidson.org/office/' })
    ])
  }),
  // GitHub owner/repo, by short name.
  repos: Object.freeze({
    workshop: 'adavidson21/workshop',
    'eng-agents': 'adavidson21/eng-agents',
    docket: 'adavidson21/docket',
    runway: 'adavidson21/runway',
    receipts: 'adavidson21/receipts',
    notes: 'adavidson21/notes'
  })
});

/** True when `hostname` is the crumbs domain or one of its subdomains. */
export function onCrumbsDomain(hostname) {
  const d = SITE.crumbs.domain;
  return typeof hostname === 'string' && (hostname === d || hostname.endsWith('.' + d));
}

/** The host name of a site address ("https://dispatch.example.org" gives "dispatch.example.org"). */
export const hostOf = url => new URL(url).hostname;
