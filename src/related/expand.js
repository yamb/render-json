import { RendererFailedError } from '#core/errors';
import { url } from '#core/url';

import { buildFullView } from '../views/post-full.js';
import { resolveRelated } from './resolve.js';

const MAX_FULL_COUNT = 10;
const MAX_FULL_TEXT_CHARS = 2_000_000;

export async function expandRelated(post, ctx, mode, related) {
  ctx.signal?.throwIfAborted();

  if (mode === false) {
    return undefined;
  }

  const resolved = related ?? (await resolveRelated(post, ctx));

  if (mode === 'uri') {
    return resolved.map((target) => target.uri);
  }

  if (mode === 'summary') {
    return resolved.map((target) => buildSummaryItem(target, ctx));
  }

  if (resolved.length > MAX_FULL_COUNT) {
    throw new RendererFailedError(
      `related: 'full' is capped at ${MAX_FULL_COUNT} posts (got ${resolved.length}); use 'summary' or 'uri' for larger sets`,
      { details: { count: resolved.length, cap: MAX_FULL_COUNT } }
    );
  }

  const out = [];
  let textChars = 0;

  for (const target of resolved) {
    ctx.signal?.throwIfAborted();
    textChars += target.text?.length ?? 0;

    if (textChars > MAX_FULL_TEXT_CHARS) {
      throw new RendererFailedError(
        `related: 'full' total text exceeded ${MAX_FULL_TEXT_CHARS} chars (DoS guard); use 'summary' or 'uri'`,
        { details: { textChars, cap: MAX_FULL_TEXT_CHARS } }
      );
    }

    out.push(await buildFullView(target, ctx, { text: true, related: false }, {}));
  }

  return out;
}

function buildSummaryItem(post, ctx) {
  const item = {
    uri: post.uri,
    url: url(post.uri, ctx.base).href,
    title: post.title
  };

  if (post.publishedAt) {
    item.publishedAt = post.publishedAt.toString();
    item.publishedDate = Temporal.Instant.from(post.publishedAt)
      .toZonedDateTimeISO(ctx.timeZone)
      .toPlainDate()
      .toString();
  }

  return item;
}
