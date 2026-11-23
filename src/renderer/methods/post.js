import { expandRelated } from '../../related/expand.js';
import { resolveRelated } from '../../related/resolve.js';
import { buildFullView } from '../../views/post-full.js';
import { getState } from '../internal.js';
import { snapshotSource } from '../source.js';

export default {
  name: 'post',

  async fn(renderer, post, ctx) {
    ctx.signal?.throwIfAborted();
    const source = snapshotSource(post);
    const { config } = getState(renderer);
    const related = await resolveRelated(source, ctx);
    const relatedValue = await expandRelated(source, ctx, config.related, related);

    return buildFullView(source, ctx, config, { relatedValue, related });
  }
};
