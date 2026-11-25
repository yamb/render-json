import { z } from 'zod';

import { AsyncIteratorHelper } from '#core/async-iterator';
import { RendererInputError } from '#core/errors';

import pkg from '../../package.json' with { type: 'json' };
import { JsonRendererConfigError } from '../errors/index.js';
import { ConfigSchema } from '../schemas/zod.js';
import { inputPosts, snapshotSource, validateSource } from '../source.js';
import { buildFullView } from '../views/post-full.js';
import { buildSummaryView } from '../views/post-summary.js';

const views = new Set([undefined, 'summary', 'full']);

export class JsonRenderer {
  #config;

  constructor(config = {}) {
    const result = ConfigSchema.safeParse(config);

    if (!result.success) {
      throw new JsonRendererConfigError(`invalid config: ${z.prettifyError(result.error)}`, {
        details: { issues: result.error.issues }
      });
    }

    this.name = 'json';
    this.version = pkg.version;
    this.#config = result.data;
  }

  async post(post, ctx) {
    ctx.signal?.throwIfAborted();

    return buildFullView(snapshotSource(post), ctx, this.#config);
  }

  async collection(input, ctx) {
    const posts = inputPosts(input);

    if (!views.has(input.view)) {
      throw new RendererInputError("input.view must be 'summary' or 'full'");
    }

    ctx.signal?.throwIfAborted();
    const out = [];

    for await (const post of AsyncIteratorHelper.from(posts, { signal: ctx.signal })) {
      ctx.signal?.throwIfAborted();
      out.push(
        input.view === 'full'
          ? await buildFullView(snapshotSource(post), ctx, this.#config)
          : buildSummaryView(validateSource(post), ctx)
      );
    }

    return { posts: out };
  }
}
