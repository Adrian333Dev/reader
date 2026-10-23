// The "what to say" layer of the pronunciation step (rd-7): turns a page word that needs reading out, such as a path,
// into plain words any speech engine can say. The sound layer (pronunciation.ts) then turns those words into sounds.

export type Piece = { type: 'text' | 'code' | 'link'; text: string; href?: string };
export type PathStyle = 'innermost' | 'slashes';

const EXTENSIONS = new Set(
  ('ts tsx js jsx mjs cjs json jsonc md mdx css scss sass less html htm vue svelte astro py rb rs go java kt swift c h cpp hpp cs php ' +
    'sh bash zsh ps1 bat sql graphql yml yaml toml ini cfg conf env lock log txt csv tsv xml svg png jpg jpeg gif webp ico pdf ' +
    'wav mp3 mp4 zip gz tar wasm map dockerfile').split(' '),
);

// A path: ends in a known file extension (main.ts) or is a dotfile (.env), ends in a slash (src/), or has slashes between word parts.
// Inline code needs 1 such slash (web/src); plain text needs 2, so "and/or", "km/h" and "10/23" stay words.
export function isPath(word: string, inCode: boolean) {
  if (word.includes('://') || word.startsWith('www.')) return false;
  const segments = word.split('/');
  const named = segments.filter(s => /\p{L}/u.test(s));
  if (!named.length) return false;
  const last = segments[segments.length - 1];
  const ext = last.match(/[^.]\.([A-Za-z0-9]+)$/)?.[1];
  if (ext && EXTENSIONS.has(ext.toLowerCase())) return true;
  if (/^\.\p{L}[\p{L}\d._-]*$/u.test(last)) return true; // a dotfile: .env, .gitignore
  if (word.endsWith('/') && /\p{L}/u.test(segments[segments.length - 2] ?? '')) return true;
  const slashes = segments.length - 1;
  return named.length === segments.filter(Boolean).length && named.length >= 2 && slashes >= (inCode ? 1 : 2);
}

// A file or folder name as words: "button.tsx" → "button dot TSX"; short names and extensions are spelled ("ui" → "UI").
function name(segment: string) {
  if (segment === '~') return 'home';
  if (segment === '..') return 'parent';
  const parts = segment.split('.').map((part, i) => (part.length <= 2 || (i > 0 && part.length <= 4) ? part.toUpperCase() : part));
  return (segment.startsWith('.') ? 'dot ' : '') + parts.filter(Boolean).join(' dot ');
}

// Innermost first: "button dot TSX, in the UI folder, inside components, inside src".
// Slashes: "button dot TSX, in src slash components slash UI folder". A folder alone: "the src folder".
export function speakPath(path: string, style: PathStyle = 'innermost') {
  const isFolder = path.endsWith('/');
  const segments = path.split('/').filter(s => s && s !== '.');
  const file = isFolder ? null : segments.pop()!;
  const folders = segments.map(name);
  if (!folders.length) return file ? name(file) : '';
  if (style === 'slashes') return [file && `${name(file)}, in`, `${folders.join(' slash ')} folder`].filter(Boolean).join(' ');
  const [inner, ...outer] = folders.reverse();
  const where = [file ? `in the ${inner} folder` : `the ${inner} folder`, ...outer.map(f => `inside ${f}`)];
  return [file && name(file), ...where].filter(Boolean).join(', ');
}

// Site exceptions, from pronunciation/sites.json, keyed by domain (a subdomain matches too). `name`: the site's spoken
// name. `query` and `label`: the parameter read as a search ("Google search: kokoro tts"). `drop`: address parts never read.
export type Site = { name?: string; label?: string; query?: string; drop?: string[] };
export type Sites = Record<string, Site>;

const PAGE_EXTENSION = /\.(html?|php|aspx?|jsp)$/i;
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']); // amazon.co.uk → amazon

export const isLink = (word: string) => /^(https?:\/\/|www\.)[^\s/]+\.[^\s/]/i.test(word);

const decode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

// The words of one address part. A part that is one token is read when it is a word of 3+ letters or a number up to
// 4 digits; anything else (dp, B0GNTCQM9R, 1234567) is an ID. In a slug of several tokens, only long or hex IDs go.
function wordsOf(part: string) {
  const tokens = part.split(/[-_+.~\s]+/).filter(t => /[\p{L}\p{N}]/u.test(t));
  if (tokens.length === 1) return /^\p{L}{3,}$/u.test(tokens[0]) || /^\d{1,4}$/.test(tokens[0]) ? tokens : [];
  return tokens.filter(t => t.length < 12 && !/^\d{5,}$/.test(t) && !(/^[0-9a-f]{8,}$/i.test(t) && /\d/.test(t)));
}

// A link as "<site> link: <the words in its address>". IDs and parameters go; a site's `query` is read as a search;
// an address ending in a file is read by the path reader. Null when the address does not parse.
export function speakLink(address: string, sites: Sites = {}, style: PathStyle = 'innermost') {
  let url: URL;
  try {
    url = new URL(/^www\./i.test(address) ? `https://${address}` : address);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const labels = host.split('.');
  const n = labels.length;
  const domain = n > 2 && SECOND_LEVEL.has(labels[n - 2]) && labels[n - 1].length === 2 ? labels[n - 3] : labels[Math.max(0, n - 2)];
  const site = sites[Object.keys(sites).find(d => host === d || host.endsWith(`.${d}`)) ?? ''] ?? {};
  const name = site.name ?? domain;
  const searched = site.query && url.searchParams.get(site.query)?.trim();
  if (searched) return `${site.label ?? `${name} search`}: ${searched}`;

  const drop = new Set((site.drop ?? []).map(d => d.toLowerCase()));
  const parts = url.pathname.split('/').map(decode).filter(p => p && !drop.has(p.toLowerCase()));
  if (parts.length) parts[parts.length - 1] = parts[parts.length - 1].replace(PAGE_EXTENSION, '');
  const last = parts[parts.length - 1];
  if (last && /[^.]\.[A-Za-z0-9]+$/.test(last) && isPath(last, true)) return `${name} link: ${speakPath(parts.join('/'), style)}`;
  const words = parts.flatMap(wordsOf).slice(0, 12);
  return words.length ? `${name} link: ${words.join(' ')}` : `${name} link`;
}

// The spoken form of one HeadTTS word (a whitespace-separated token), or null when it is read as written.
// `inCode`: the token sits in inline code.
export function spokenForm(word: string, inCode: boolean, style: PathStyle, sites: Sites = {}) {
  if (isLink(word)) return speakLink(word, sites, style);
  return isPath(word, inCode) ? speakPath(word, style) : null;
}
