import { AsyncIteratorHelper } from '#core/async-iterator';
import { RendererInputError } from '#core/errors';

import { expandRelated } from '../../related/expand.js';
import { resolveRelated } from '../../related/resolve.js';
import { buildFullView } from '../../views/post-full.js';
import { buildSummaryView } from '../../views/post-summary.js';
import { getState } from '../internal.js';
import { snapshotSource, validateSource } from '../source.js';

function asIterator(source) {
  if (
    !source ||
    (typeof source[Symbol.asyncIterator] !== 'function' &&
      typeof source[Symbol.iterator] !== 'function')
  ) {
    throw new RendererInputError('input.posts must be iterable or async iterable');
  }

  return AsyncIteratorHelper.from(source);
}

export default {
  name: 'collection',

  async fn(renderer, input, ctx) {
    if (!input || input.posts === undefined || input.posts === null) {
      throw new RendererInputError('input.posts is required for collection render');
    }

    ctx.signal?.throwIfAborted();
    const { config } = getState(renderer);
    const full = input.view === 'full';
    const out = [];

    for await (const post of asIterator(input.posts)) {
      ctx.signal?.throwIfAborted();

      if (full) {
        const source = snapshotSource(post);
        const related = await resolveRelated(source, ctx);
        const relatedValue = await expandRelated(source, ctx, config.related, related);

        out.push(await buildFullView(source, ctx, config, { relatedValue, related }));
      } else {
        validateSource(post);
        out.push(buildSummaryView(post, ctx));
      }
    }

    return { posts: out };
  }
};
