import { z } from 'zod';

import { AsyncIteratorHelper } from '#core/async-iterator';
import { RendererFailedError, RendererInputError } from '#core/errors';
import { url } from '#core/url';

import pkg from '../../package.json' with { type: 'json' };
import { JsonRendererConfigError } from '../errors/index.js';
import { FeedConfigSchema } from '../schemas/zod.js';
import { budget } from './budget.js';
import { content, full } from './content.js';

const precision = { fractionalSecondDigits: 9 };

function author(value, base) {
  const out = { name: value.name };

  if (value.url) {
    out.url = url(value.url, base).href;
  }

  return out;
}

function item(post, prepared, documentURL, base) {
  const out = {
    id: post.id,
    url: documentURL,
    title: prepared.title,
    date_published: post.publishedAt.toString(precision),
    date_modified: post.updatedAt.toString(precision)
  };

  out.content_html = full(prepared);

  if (prepared.preview !== undefined) {
    out.summary = prepared.preview.plain;
  }

  if (post.tags !== undefined) {
    out.tags = post.tags;
  }

  if (prepared.cover.url) {
    out.image = prepared.cover.url;
  }

  if (post.author) {
    out.authors = [author(post.author, base)];
  }

  return out;
}

export class FeedRenderer {
  #config;

  constructor(config) {
    const result = FeedConfigSchema.safeParse(config);

    if (!result.success) {
      throw new JsonRendererConfigError(`invalid config: ${z.prettifyError(result.error)}`, {
        details: { issues: result.error.issues }
      });
    }

    this.name = 'feed';
    this.version = pkg.version;
    this.#config = result.data;
  }

  async collection(input, ctx) {
    try {
      ctx.signal?.throwIfAborted();
      const posts = input?.posts;

      if (
        !posts ||
        (typeof posts[Symbol.asyncIterator] !== 'function' &&
          typeof posts[Symbol.iterator] !== 'function')
      ) {
        throw new RendererInputError('input.posts must be iterable or async iterable');
      }

      const config = this.#config;
      const base = url('./', ctx.base);
      const out = {
        version: 'https://jsonfeed.org/version/1.1',
        title: config.title,
        home_page_url: new URL(config.link ?? ctx.base).href,
        feed_url: new URL(config.feed).href,
        items: []
      };

      if (config.description !== undefined) {
        out.description = config.description;
      }

      if (config.language !== undefined) {
        out.language = config.language;
      }

      if (config.author) {
        out.authors = [author(config.author, base)];
      }

      const bytes = budget(config.bytes);
      bytes.check(config.title.length + (config.description?.length ?? 0));
      bytes.add(out);

      const ids = new Set();

      if (config.limit > 0) {
        const iterator = AsyncIteratorHelper.from(posts, { signal: ctx.signal });

        for await (const value of iterator.take(config.limit)) {
          ctx.signal?.throwIfAborted();
          const { post, prepared, documentURL } = await content(value, config, ctx);

          if (ids.has(post.id)) {
            throw new RendererInputError('duplicate feed post id');
          }

          ids.add(post.id);

          bytes.check(
            prepared.text.feedHtml.length +
              (prepared.preview?.plain.length ?? 0) +
              prepared.title.length
          );

          const entry = item(post, prepared, documentURL, base);
          bytes.add(entry, out.items.length > 0 ? 1 : 0);
          out.items.push(entry);
        }
      }

      ctx.signal?.throwIfAborted();

      return out;
    } catch (error) {
      if (ctx.signal?.aborted && Object.is(error, ctx.signal.reason)) {
        throw error;
      }

      if (error?.name === 'AbortError' || error?.code?.startsWith?.('YAMB_')) {
        throw error;
      }

      throw new RendererFailedError('feed generation failed', { cause: error });
    }
  }
}
