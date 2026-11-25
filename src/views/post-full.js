import { RendererFailedError } from '#core/errors';
import { url } from '#core/url';

import { publication } from './post-summary.js';

const MAX_FULL_COUNT = 10;
const MAX_FULL_TEXT_CHARS = 2_000_000;

async function resolveRelated(post, ctx) {
  const resolved = [];

  for (const id of post.links?.related ?? []) {
    ctx.signal?.throwIfAborted();
    const target = await ctx.yamb.find(id, { signal: ctx.signal });
    ctx.signal?.throwIfAborted();

    if (target?.status === 'published') {
      resolved.push(target.toJSON());
    }
  }

  return resolved;
}

async function expandRelated(related, ctx, mode) {
  if (mode === 'uri') {
    return related.map((target) => target.uri);
  }

  if (mode === 'summary') {
    return related.map((target) =>
      publication(
        { uri: target.uri, url: url(target.uri, ctx.base).href, title: target.title },
        target,
        ctx.timeZone
      )
    );
  }

  if (related.length > MAX_FULL_COUNT) {
    throw new RendererFailedError(
      `related: 'full' is capped at ${MAX_FULL_COUNT} posts (got ${related.length}); use 'summary' or 'uri' for larger sets`,
      { details: { count: related.length, cap: MAX_FULL_COUNT } }
    );
  }

  const textChars = related.reduce((sum, target) => sum + (target.text?.length ?? 0), 0);

  if (textChars > MAX_FULL_TEXT_CHARS) {
    throw new RendererFailedError(
      `related: 'full' total text exceeded ${MAX_FULL_TEXT_CHARS} chars; use 'summary' or 'uri'`,
      { details: { textChars, cap: MAX_FULL_TEXT_CHARS } }
    );
  }

  const views = [];

  for (const target of related) {
    views.push(await buildFullView(target, ctx, { text: true, related: false }));
  }

  return views;
}

export async function buildFullView(post, ctx, config) {
  const related = await resolveRelated(post, ctx);

  const view = {
    uri: post.uri,
    slug: post.slug,
    url: url(post.uri, ctx.base).href,
    title: post.title,
    preview: post.preview ?? '',
    cover: post.cover ?? {},
    tags: post.tags ?? [],
    author: post.author ?? {},
    links: { related: related.map((target) => target.uri) },
    meta: post.meta ?? {},
    social: post.social ?? {},
    status: post.status,
    options: post.options
  };

  if (config.text) {
    view.text = post.text ?? '';
  }

  if (post.createdAt) {
    view.createdAt = post.createdAt;
  }

  if (post.updatedAt) {
    view.updatedAt = post.updatedAt;
  }

  publication(view, post, ctx.timeZone);

  if (config.related !== false) {
    view.related = await expandRelated(related, ctx, config.related);
  }

  return view;
}
