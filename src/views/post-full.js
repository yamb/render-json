import { RendererInputError } from '#core/errors';
import { CoverSchema } from '#core/schemas';
import { url } from '#core/url';

import { resolveRelated } from '../related/resolve.js';

export async function buildFullView(post, ctx, config, opts = {}) {
  ctx.signal?.throwIfAborted();

  const cover = CoverSchema.safeParse(post.cover === undefined ? {} : post.cover);

  if (!cover.success) {
    throw new RendererInputError('invalid cover', { details: { issues: cover.error.issues } });
  }

  const related = opts.related ?? (await resolveRelated(post, ctx));
  const uris = related.map((target) => target.uri);

  const view = {
    uri: post.uri,
    slug: post.slug,
    url: url(post.uri, ctx.base).href,
    title: post.title,
    preview: post.preview ?? '',
    cover: cover.data,
    tags: post.tags ?? [],
    author: post.author ?? {},
    links: { related: uris },
    meta: post.meta ?? {},
    social: post.social ?? {},
    status: post.status,
    options: post.options
  };

  if (config.text) {
    view.text = post.text ?? '';
  }

  if (post.createdAt) {
    view.createdAt = post.createdAt.toString();
  }

  if (post.updatedAt) {
    view.updatedAt = post.updatedAt.toString();
  }

  if (post.publishedAt) {
    view.publishedAt = post.publishedAt.toString();
    view.publishedDate = Temporal.Instant.from(post.publishedAt)
      .toZonedDateTimeISO(ctx.timeZone)
      .toPlainDate()
      .toString();
  }

  if (opts.relatedValue !== undefined) {
    view.related = opts.relatedValue;
  } else if (config.related !== false) {
    view.related = [...uris];
  }

  return view;
}
