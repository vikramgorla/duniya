// @ts-check
// The project's GitHub repository (084): one slug, `repository` in package.json ("github:owner/name"), and every URL
// derived from it. Pure (no side effects), so the app, the CLI and the scripts (repo-sync, ci-checks, doc links) share
// it. A fork or a rename changes the slug and runs `npm run repo:sync`; nothing else holds the owner or the name.

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const NAME = '[A-Za-z0-9._-]{1,100}';
const FORMS = [
  new RegExp(`^(?:github:)?(${OWNER})/(${NAME})$`),
  new RegExp(`^(?:git\\+)?https://github\\.com/(${OWNER})/(${NAME})/?$`),
];

/**
 * owner/name, github:owner/name or https://github.com/owner/name[.git][/] (also package.json's { url } form) →
 * { owner, name, slug }, or null for anything else (other hosts, ssh, credentials, query strings, paths).
 * @param {unknown} input
 */
export function parseRepo(input) {
  const raw = typeof input === 'object' && input ? /** @type {{ url?: unknown }} */ (input).url : input;
  const s = String(raw ?? '').trim();
  for (const re of FORMS) {
    const m = re.exec(s);
    if (!m) continue;
    const name = m[2].replace(/\.git$/, '');
    if (!name || name === '.' || name === '..') return null;
    return { owner: m[1], name, slug: `${m[1]}/${name}` };
  }
  return null;
}

/**
 * The URLs of a repository. `pages` is GitHub Pages (https://<owner>.github.io/<name>/), `image` the container image.
 * @param {string} slug owner/name
 */
export function repoLinks(slug) {
  const r = parseRepo(slug);
  if (!r) throw new Error(`Not a GitHub repository: ${slug}`);
  const url = `https://github.com/${r.slug}`;
  return {
    ...r, url, git: `${url}.git`,
    pages: `https://${r.owner.toLowerCase()}.github.io/${r.name}/`,
    image: `ghcr.io/${r.slug.toLowerCase()}`,
    /** A file or folder at a ref: blob('main', 'docs/README.md'). */
    blob: (ref, path) => `${url}/blob/${ref}/${path}`,
  };
}

/** Same repository (GitHub owners and names are case-insensitive). */
export const sameRepo = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
