import { url } from '#core/url';

export function buildSummaryView(post, ctx) {
  ctx.signal?.throwIfAborted();

  const view = {
    uri: post.uri,
    url: url(post.uri, ctx.base).href,
    title: post.title,
    preview: post.preview ?? '',
    tags: [...(post.tags ?? [])]
  };

  if (post.publishedAt) {
    view.publishedAt = post.publishedAt.toString();
    view.publishedDate = Temporal.Instant.from(post.publishedAt)
      .toZonedDateTimeISO(ctx.timeZone)
      .toPlainDate()
      .toString();
  }

  return view;
}
