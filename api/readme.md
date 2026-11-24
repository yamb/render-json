# JSON renderer API

Both renderers return independent objects for `JSON.stringify()`. See the [quick start](../readme.md#quick-start) for direct calls and the [Yamb reference](https://github.com/yamb/yamb#reference) for renderer context.

| API | Scope and result | Content |
| --- | --- | --- |
| `json(config?)` / `new JsonRenderer(config?)` | Post → full view; collection → `{ posts: [...] }` | Original Markdown, preview, cover and options |
| `feed(config)` / `new FeedRenderer(config)` | Collection → JSON Feed 1.1 object | Explicit prepared projections, or escaped literal source |

## Source JSON

Register `json()` as `renderers.json`. Use `post.render('json')` for a full post and `blog.render('json', { posts: blog.published, view: 'full' })` for full collection items. Collections default to summaries. Direct calls take canonical source URIs, `ctx.base` as a URL and `ctx.timeZone`. Related lookups also need `ctx.yamb`.

| Setting | Default | Effect |
| --- | --- | --- |
| `text` | `true` | Include source `text` in full views |
| `related` | `'uri'` | Top-level `related`: URI strings, `'summary'` objects, `'full'` views, or omitted with `false` |

Unknown factory settings fail. JSON never invokes content preparation. `text` is the complete article, including its introduction; `preview` remains independent and is never generated or prepended.

| View | Fields |
| --- | --- |
| Summary | `uri`, absolute `url`, `title`, `preview`, `tags`; `publishedAt` / `publishedDate` when publishedAt is present |
| Full | Summary fields plus `slug`, `cover`, `author`, `links: { related }`, `meta`, `social`, `status`, `options`; configured `text` / `related`; `createdAt` / `updatedAt` when present |
| Related summary | `uri`, absolute `url`, `title`; `publishedAt` / `publishedDate` when present |

Absent preview becomes `''`; absent tags become `[]`; full views default cover/author/meta/social to `{}` and enabled text to `''`. Minimal direct input leaves absent slug/status/options as `undefined`, so `JSON.stringify()` omits them. Dates are ISO strings; `publishedDate` is the calendar date in `ctx.timeZone`. Source views omit stable `id`; read it from Post/PostData when needed.

Full views capture the whole source record before the first related lookup await; mutable output does not alias input. Summaries copy only their selected fields, including tags. Collections capture each item as it arrives and accumulate every selected result; bound large inputs with collection selection or `take(n)`. There is no transaction across collection items or related lookups.

Related IDs resolve in order through `ctx.yamb.find(id, { signal })`. `links.related` lists current URIs of published targets. With `related: 'full'`, expansion stops after one level. Each target includes `text` even when the parent uses `text: false`. Its `links.related` contains URIs and its top-level `related` field is omitted. Full expansion allows up to 10 published targets and 2000000 UTF-16 units of their combined source text.

## JSON Feed 1.1

Register `feed(config)` as `renderers.feed` and call `blog.render('feed', { posts: blog.published })`. Serve the serialized [JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/) result as `application/feed+json; charset=utf-8`. Input must be saved published posts with unique IDs, canonical URIs, title, text and update/publication dates.

| Setting | Default | Value |
| --- | --- | --- |
| `title` | Required | Nonempty feed title |
| `feed` | Required | Absolute HTTP(S) feed URL without credentials |
| `link` | `ctx.base` | Absolute HTTP(S) home page URL without credentials |
| `description` | Absent | Plain text |
| `language` | Absent | Locale accepted by native `Intl.getCanonicalLocales`, e.g. `en-US` |
| `author` | Absent | Core author object; feed-level author |
| `prepare` | Absent | Sync/async `(source, ctx) => PreparedPost` |
| `limit` | `20` | Nonnegative safe integer; zero starts neither source nor preparation |
| `bytes` | `8388608` | Positive safe integer; UTF-8 ceiling for compact `JSON.stringify(result)` |

Unknown settings fail. The feed captures independent source metadata before awaiting preparation and passes a separate source copy to the callback. Each item retains its captured ID, URI, dates, tags and author even if the callback changes its copy or the caller edits the original input during that await.

| Output | Mapping |
| --- | --- |
| Feed | `version`, `title`, `home_page_url`, `feed_url`, `items`; configured `description`, `language`, `authors` |
| Item identity | Stable source `id`; current absolute article `url`; UTC `date_published` / `date_modified` with nine fractional digits |
| Item content | Prepared `title` and `text.feedHtml` → `title` / `content_html`; present `preview.plain` → `summary`, including `''` |
| Item media | Nonempty prepared `cover.url` → `image` and a figure before the full body; escaped alt/caption and optional dimensions |
| Item metadata | Source `tags` when present; source `author` → `authors: [{ name, url? }]`; email/options/internal fields omitted |

Cover references resolve against the canonical article URL with native URL semantics; author references resolve against the base directory. A cover without a URL produces no image/figure; its caption never becomes a summary. Full text includes its introduction and never has preview prepended. Absent preview omits `summary`; no excerpt is generated.

### Prepared content

Install `yamb-markdown` and `yamb-microtypo` for the standard pipeline:

```bash
pnpm add yamb-markdown yamb-microtypo
```

```js
import { markdown } from 'yamb-markdown';
import { microtypo } from 'yamb-microtypo';
import { feed } from 'yamb-render-json';
import { prepare } from 'yamb/transform';

await using md = markdown();
await using typo = microtypo();

const stages = [md, md.html(), typo, md.clean()];

const renderer = feed({
  title: 'Blog',
  feed: 'https://example.com/feed.json',
  prepare: (source, ctx) => prepare(source, stages, ctx)
});

const source = {
  id: 'guide',
  uri: '2026/11/guide',
  title: 'Guide',
  text: 'Introduction.\n\n---\n\n**Complete article.**',
  status: 'published',
  updatedAt: '2026-11-12T09:00:00Z',
  publishedAt: '2026-11-12T09:00:00Z'
};

const ctx = {
  base: new URL('https://example.com/blog'),
  timeZone: 'UTC'
};

const result = await renderer.collection(
  {
    posts: [source]
  },
  ctx
);

console.log(JSON.stringify(result));
```

Keep the Markdown/MicroTypo owners for the application lifetime and close them after pending preparation ends. The callback returns the whole PreparedPost; one immutable result can serve HTML/RSS/Atom/JSON Feed through an application-owned preparation cache. [Markdown](https://github.com/yamb/markdown#reference) owns stage shapes, dialect, cleaning and media/URL policy; [MicroTypo](https://github.com/yamb/microtypo#reference) owns native typography options. Custom callbacks own HTML safety: the renderer validates projection types and cover URLs, but does not sanitize `text.feedHtml`.

Without `prepare`, title/cover remain source values, literal source text is HTML-escaped into `content_html`, and an explicit preview becomes plain `summary` with its Markdown markers intact. There is no hidden parser or typographer. Core source bounds apply before preparation; derived title, text/preview projections and cover URL/alt/caption each have a 5000000 UTF-16 code-unit guard. The final byte budget includes JSON escaping and separators; pretty printing or caller-added fields fall outside it. No partial feed is returned on failure.

## Cancellation and errors

Pass `{ signal }` as the final render option, or provide `ctx.signal` for direct calls. Feed items and related lookups run sequentially. Early limit, cancellation, source failure and processing failure close the source iterator; borrowed storage stays open. Callbacks and pending source work must cooperate with the signal; renderers cannot preempt arbitrary application code. Native cancellation reasons and domain errors retain identity.

| Code | Cause |
| --- | --- |
| `YAMB_JSON_RENDERER_CONFIG` | Invalid configuration for either factory; `JsonRendererConfigError` is exported from `yamb-render-json/errors` |
| `YAMB_RENDERER_INPUT` | Missing/noniterable collection source; invalid source URI/text/cover; unsuitable/duplicate feed post, prepared projection or output overflow |
| `YAMB_RENDERER_FAILED` | Full related expansion exceeds its limits, or an unexpected failure is wrapped with `cause` by feed/core rendering |
| `YAMB_RENDERER_SCOPE` | Core dispatch selects an unsupported scope, such as a single post for `feed()` |

See the core reference's Exports and errors section for the shared hierarchy. Direct source JSON methods propagate unexpected failures; core dispatch wraps them.
