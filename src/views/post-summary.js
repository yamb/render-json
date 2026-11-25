import { url } from '#core/url';

export function publication(view, post, timeZone) {
  if (post.publishedAt) {
    view.publishedAt = String(post.publishedAt);
    view.publishedDate = Temporal.Instant.from(post.publishedAt)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
      .toString();
  }

  return view;
}

export function buildSummaryView(post, ctx) {
  const view = {
    uri: post.uri,
    url: url(post.uri, ctx.base).href,
    title: post.title,
    preview: post.preview ?? '',
    tags: [...(post.tags ?? [])]
  };

  return publication(view, post, ctx.timeZone);
}
