import assert from 'node:assert/strict';
import test from 'node:test';

import * as renderers from '../src/index.js';
import { blogWith, postData } from './fixture.js';

const config = { title: 'Feed', feed: 'https://example.com/feed.json' };
const row = (index = 0) => ({
  ...postData(100, index),
  id: `post-${index}`,
  uri: `2026/11/post-${index}`
});

async function setup(t, options = {}, extra = {}) {
  const blog = await blogWith([], {
    base: 'https://example.com/blog',
    renderers: { feed: renderers.feed({ ...config, ...options }) },
    ...extra
  });
  t.after(() => blog.close());

  return blog;
}

function prepared(feedHtml, preview) {
  const result = {
    title: 'Prepared',
    text: { feedHtml },
    cover: {}
  };

  if (preview !== undefined) {
    result.preview = { feedHtml: preview, plain: preview };
  }

  return result;
}
const roundtrip = (value) => JSON.parse(JSON.stringify(value));

test('JSON Feed returns a plain deterministic empty feed with collection scope', async (t) => {
  const blog = await setup(t);
  assert.ok(renderers.feed(config) instanceof renderers.FeedRenderer);

  const out = await blog.render('feed', { posts: [] });
  assert.deepEqual(out, {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Feed',
    home_page_url: 'https://example.com/blog',
    feed_url: 'https://example.com/feed.json',
    items: []
  });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(roundtrip(out), out);

  await assert.rejects(() => blog.build({ title: 'Draft' }).render('feed'), {
    code: 'YAMB_RENDERER_SCOPE'
  });
});

test('JSON Feed keeps identity across publication and rename, exposing the current URL', async (t) => {
  const blog = await setup(t);
  const post = blog.build({ title: 'First', slug: 'first', text: '**raw**\r\n' });
  await post.publish();
  const before = roundtrip(await blog.render('feed', { posts: [post] }));

  post.slug = 'second';
  await post.save();
  const after = roundtrip(await blog.render('feed', { posts: blog.published }));

  assert.equal(before.items[0].id, post.id);
  assert.equal(after.items[0].id, post.id);
  assert.equal(before.items[0].url, 'https://example.com/blog/2026/11/first');
  assert.equal(after.items[0].url, 'https://example.com/blog/2026/11/second');
  assert.equal(after.items[0].content_html, '**raw**\r\n');
  assert.equal(post.text, '**raw**\r\n');
});

test('JSON Feed maps metadata, authors, cover and precise dates without leaking private fields', async (t) => {
  const blog = await setup(
    t,
    {
      title: '<Feed> 😀',
      description: '<plain> description',
      language: 'sr-Latn-RS',
      author: { name: 'Editor', email: 'editor@example.com', url: './editor' },
      link: 'https://example.net/home'
    },
    { base: 'https://example.com/mounted?query=1#fragment' }
  );
  const post = {
    ...row(),
    title: '<Title> 😀',
    text: '**Markdown**\r\n\u0000\ud800😀',
    preview: '*not a summary*',
    cover: { url: './cover.jpg' },
    author: { name: 'Writer', email: 'writer@example.com', url: './writer' },
    tags: ['a', '<b>'],
    options: { secret: 'hidden' },
    updatedAt: '2026-11-01T15:00:00.123456789+03:00',
    publishedAt: '2026-10-31T00:00:00.000000001Z'
  };
  const original = structuredClone(post);
  const out = await blog.render('feed', { posts: [post] });

  assert.deepEqual(roundtrip(out), out);
  assert.equal(out.title, '<Feed> 😀');
  assert.equal(out.description, '<plain> description');
  assert.equal(out.language, 'sr-Latn-RS');
  assert.equal(out.home_page_url, 'https://example.net/home');
  assert.deepEqual(out.authors, [{ name: 'Editor', url: 'https://example.com/mounted/editor' }]);
  assert.deepEqual(out.items, [
    {
      id: 'post-0',
      url: 'https://example.com/mounted/2026/11/post-0',
      title: '<Title> 😀',
      content_html:
        '<figure><img src="https://example.com/mounted/2026/11/cover.jpg" alt=""></figure>**Markdown**\r\n\u0000\ud800😀',
      summary: '*not a summary*',
      date_published: '2026-10-31T00:00:00.000000001Z',
      date_modified: '2026-11-01T12:00:00.123456789Z',
      tags: ['a', '<b>'],
      image: 'https://example.com/mounted/2026/11/cover.jpg',
      authors: [{ name: 'Writer', url: 'https://example.com/mounted/writer' }]
    }
  ]);

  out.items[0].tags.push('changed');
  out.items[0].authors[0].name = 'Changed';

  assert.deepEqual(post, original);
});

test('JSON Feed callback can render a captured revision through the public API', async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const blog = await setup(
    t,
    {},
    {
      renderers: {
        json: renderers.json(),
        feed: renderers.feed({
          ...config,
          prepare: async (post, ctx) => {
            entered.resolve();
            await release.promise;
            const view = await ctx.yamb.render('json', { post }, { signal: ctx.signal });

            return { ...prepared(view.text), title: post.title };
          }
        })
      }
    }
  );
  const post = blog.build({ title: 'Before', text: '**before**' });
  await post.publish();

  const rendering = blog.render('feed', { posts: [post] });
  await entered.promise;

  post.title = 'After';
  post.text = 'After';

  release.resolve();
  const out = await rendering;

  assert.equal(out.items[0].title, 'Before');
  assert.equal(out.items[0].content_html, '**before**');
});

test('JSON Feed limits infinite sources and processes callbacks sequentially', async (t) => {
  let pulled = 0;
  let closed = 0;
  let active = 0;
  const blog = await setup(t, {
    limit: 2,
    prepare: async (post) => {
      assert.equal(active++, 0);
      await Promise.resolve();
      active--;

      return prepared(post.id);
    }
  });

  async function* posts() {
    try {
      while (true) {
        yield row(pulled++);
      }
    } finally {
      closed++;
    }
  }

  const out = await blog.render('feed', { posts: posts() });

  assert.deepEqual(
    out.items.map((post) => post.id),
    ['post-0', 'post-1']
  );
  assert.equal(pulled, 2);
  assert.equal(closed, 1);
});

test('JSON Feed limit zero never starts a source or callback', async (t) => {
  const blog = await setup(t, { limit: 0, prepare: () => assert.fail('callback started') });
  const posts = {
    [Symbol.iterator]() {
      assert.fail('source started');
    }
  };
  const out = await blog.render('feed', { posts });

  assert.deepEqual(out.items, []);
});

test('JSON Feed defaults to twenty items', async (t) => {
  const blog = await setup(t);
  let closed = false;

  async function* posts() {
    try {
      for (let i = 0; i < 25; i++) {
        yield row(i);
      }
    } finally {
      closed = true;
    }
  }

  const out = await blog.render('feed', { posts: posts() });

  assert.equal(out.items.length, 20);
  assert.equal(closed, true);
});

for (const patch of [
  { title: '' },
  { title: '  ' },
  { feed: '/feed.json' },
  { feed: 'ftp://example.com/f' },
  { link: '/home' },
  { language: 'en_US' },
  { language: 'x-private' },
  { language: 'i-klingon' },
  { prepare: {} },
  { limit: -1 },
  { limit: 1.5 },
  { limit: Number.MAX_SAFE_INTEGER + 1 },
  { bytes: 0 },
  { bytes: Infinity },
  { bytes: Number.MAX_SAFE_INTEGER + 1 },
  { author: { name: 'A', email: 'bad' } },
  { unknown: true }
]) {
  test(`JSON Feed rejects invalid configuration ${JSON.stringify(patch)}`, () => {
    assert.throws(() => renderers.feed({ ...config, ...patch }), {
      code: 'YAMB_JSON_RENDERER_CONFIG'
    });
  });
}

for (const patch of [
  { id: undefined },
  { id: '' },
  { status: 'draft' },
  { uri: '../private' },
  { title: ' ' },
  { text: undefined },
  { updatedAt: 'bad' },
  { publishedAt: undefined },
  { cover: { url: 'javascript:alert(1)' } },
  { author: { name: 'A', url: 'mailto:a@example.com' } }
]) {
  test(`JSON Feed rejects unsuitable posts ${JSON.stringify(patch)}`, async (t) => {
    const blog = await setup(t);
    let closed = false;

    async function* posts() {
      try {
        yield { ...row(), ...patch };
      } finally {
        closed = true;
      }
    }

    await assert.rejects(() => blog.render('feed', { posts: posts() }), {
      code: 'YAMB_RENDERER_INPUT'
    });
    assert.equal(closed, true);
  });
}

test('JSON Feed rejects duplicate IDs and invalid sources', async (t) => {
  const blog = await setup(t);
  await assert.rejects(() => blog.render('feed', { posts: [row(), row()] }), {
    code: 'YAMB_RENDERER_INPUT'
  });

  for (const input of [undefined, {}, { posts: null }, { posts: 1 }]) {
    await assert.rejects(() => blog.render('feed', input), { code: 'YAMB_RENDERER_INPUT' });
  }
});

for (const content of [
  null,
  [],
  {},
  { summary: 'alone' },
  { text: 1 },
  { html: null },
  { text: '', summary: 1 },
  { text: '', unknown: true },
  new (class {
    text = 'x';
  })()
]) {
  test(`JSON Feed rejects invalid content ${JSON.stringify(content)}`, async (t) => {
    const blog = await setup(t, { prepare: () => content });
    await assert.rejects(() => blog.render('feed', { posts: [row()] }), {
      code: 'YAMB_RENDERER_INPUT'
    });
  });
}

test('JSON Feed wraps callback failure, closes its source and preserves domain errors', async (t) => {
  const failure = new Error('callback failed');
  let closed = 0;
  const blog = await setup(t, {
    prepare: () => {
      throw failure;
    }
  });

  async function* posts() {
    try {
      yield row();
    } finally {
      closed++;
    }
  }

  await assert.rejects(
    () => blog.render('feed', { posts: posts() }),
    (error) => {
      assert.equal(error.code, 'YAMB_RENDERER_FAILED');
      assert.equal(error.cause, failure);

      return true;
    }
  );

  failure.code = 'YAMB_CUSTOM';
  await assert.rejects(
    () => blog.render('feed', { posts: posts() }),
    (error) => error === failure
  );
  assert.equal(closed, 2);
});

test('JSON Feed propagates cancellation from an awaiting callback and closes the source', async (t) => {
  const controller = new AbortController();
  const reason = new Error('cancelled');
  let closed = false;
  const blog = await setup(t, {
    prepare: async (_, ctx) => {
      controller.abort(reason);
      await Promise.resolve();
      ctx.signal.throwIfAborted();
    }
  });

  async function* posts() {
    try {
      yield row();
    } finally {
      closed = true;
    }
  }

  await assert.rejects(
    () => blog.render('feed', { posts: posts() }, { signal: controller.signal }),
    (error) => error === reason
  );
  assert.equal(closed, true);

  await assert.rejects(
    () =>
      blog.render(
        'feed',
        {
          posts: {
            [Symbol.iterator]() {
              assert.fail('aborted source started');
            }
          }
        },
        { signal: controller.signal }
      ),
    (error) => error === reason
  );
});

test('JSON Feed bounds the exact final compact JSON bytes including escapes and commas', async (t) => {
  const options = {
    title: 'é😀\u0000"\\\n\ud800',
    description: 'mixed\t\r',
    prepare: () => prepared(`😀\\"\n${'\u0000'.repeat(20)}`, 'é')
  };
  const posts = [row(), row(1)];
  const blog = await setup(t, options);
  const out = await blog.render('feed', { posts });
  const bytes = Buffer.byteLength(JSON.stringify(out));

  const exact = await setup(t, { ...options, bytes });
  assert.deepEqual(await exact.render('feed', { posts }), out);

  const short = await setup(t, { ...options, bytes: bytes - 1 });
  await assert.rejects(() => short.render('feed', { posts }), { code: 'YAMB_RENDERER_INPUT' });

  const empty = await blog.render('feed', { posts: [] });
  const emptyBytes = Buffer.byteLength(JSON.stringify(empty));
  const tiny = await setup(t, { ...options, bytes: emptyBytes - 1 });

  await assert.rejects(() => tiny.render('feed', { posts: [] }), { code: 'YAMB_RENDERER_INPUT' });
});

test('JSON Feed rejects huge callback output and closes the source', async (t) => {
  const blog = await setup(t, { bytes: 1000, prepare: () => prepared('x'.repeat(1048576)) });
  let closed = false;

  async function* posts() {
    try {
      yield row();
    } finally {
      closed = true;
    }
  }

  await assert.rejects(() => blog.render('feed', { posts: posts() }), {
    code: 'YAMB_RENDERER_INPUT'
  });
  assert.equal(closed, true);
});

test('JSON Feed directly closes next failures and preserves primary errors over failed cleanup', async () => {
  const failure = new Error('next failed');
  const cleanup = new Error('cleanup failed');
  let closed = 0;
  const renderer = renderers.feed(config);
  const posts = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          throw failure;
        },
        return: async () => {
          closed++;
          throw cleanup;
        }
      };
    }
  };

  await assert.rejects(
    () => renderer.collection({ posts }, { base: new URL('https://example.com') }),
    (error) => error.code === 'YAMB_RENDERER_FAILED' && error.cause === failure
  );
  assert.equal(closed, 1);
});

test('JSON Feed preserves callback errors over failed source cleanup', async (t) => {
  const failure = new Error('callback failed');
  const blog = await setup(t, {
    prepare: () => {
      throw failure;
    }
  });
  let closed = 0;
  const posts = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: row(), done: false }),
        return: async () => {
          closed++;
          throw new Error('cleanup failed');
        }
      };
    }
  };

  await assert.rejects(
    () => blog.render('feed', { posts }),
    (error) => error.code === 'YAMB_RENDERER_FAILED' && error.cause === failure
  );
  assert.equal(closed, 1);
});

test('JSON Feed rejects a failed cleanup at the item limit', async (t) => {
  const failure = new Error('cleanup failed');
  const blog = await setup(t, { limit: 1 });
  let closed = 0;
  const posts = {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: row(), done: false }),
        return: async () => {
          closed++;
          throw failure;
        }
      };
    }
  };

  await assert.rejects(
    () => blog.render('feed', { posts }),
    (error) => error.code === 'YAMB_RENDERER_FAILED' && error.cause === failure
  );
  assert.equal(closed, 1);
});

for (const mode of ['sync next', 'rejected yield']) {
  test(`JSON Feed closes ${mode} failures`, async (t) => {
    const failure = new Error(mode);
    const blog = await setup(t);
    let closed = 0;
    const posts = {
      [Symbol.iterator]() {
        return {
          next() {
            if (mode === 'sync next') {
              throw failure;
            }

            return { value: Promise.reject(failure), done: false };
          },
          return() {
            closed++;
            return { done: true };
          }
        };
      }
    };

    await assert.rejects(
      () => blog.render('feed', { posts }),
      (error) => error.code === 'YAMB_RENDERER_FAILED' && error.cause === failure
    );
    assert.equal(closed, 1);
  });
}

test('JSON Feed owns independent config and output authors across renders', async (t) => {
  const author = { name: 'Editor', email: 'editor@example.com' };
  const blog = await setup(t, { author });
  author.name = 'Changed';

  const first = await blog.render('feed', { posts: [] });
  assert.deepEqual(first.authors, [{ name: 'Editor' }]);

  first.authors[0].name = 'Changed output';
  const second = await blog.render('feed', { posts: [] });
  assert.deepEqual(second.authors, [{ name: 'Editor' }]);
});

test('JSON Feed default byte ceiling rejects more than eight MiB', async (t) => {
  const blog = await setup(t, {
    prepare: () => prepared('x'.repeat(4500000), 'x'.repeat(4500000))
  });
  await assert.rejects(() => blog.render('feed', { posts: [row()] }), {
    code: 'YAMB_RENDERER_INPUT'
  });
});

for (const patch of [{ cover: { url: '//[' } }, { author: { name: 'A', url: '//[' } }]) {
  test(`JSON Feed rejects malformed relative URL as input ${JSON.stringify(patch)}`, async (t) => {
    const blog = await setup(t);
    await assert.rejects(() => blog.render('feed', { posts: [{ ...row(), ...patch }] }), {
      code: 'YAMB_RENDERER_INPUT'
    });
  });
}

test('JSON Feed rejects malformed configured author URL at construction', () => {
  assert.throws(() => renderers.feed({ ...config, author: { name: 'A', url: '//[' } }), {
    code: 'YAMB_JSON_RENDERER_CONFIG'
  });
});

test('JSON Feed through blog.render closes rejected async next with a failed return', async (t) => {
  const blog = await setup(t);
  const primary = new Error('next failed');
  let closed = 0;
  const posts = {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(primary),
        return() {
          closed++;
          throw new Error('cleanup failed');
        }
      };
    }
  };

  await assert.rejects(
    () => blog.render('feed', { posts }),
    (error) => error.cause === primary
  );
  assert.equal(closed, 1);
});

for (const cover of [{}, { caption: 'No image', width: 100 }, { url: '', alt: 'Empty' }]) {
  test(`JSON Feed omits an image without a cover URL ${JSON.stringify(cover)}`, async (t) => {
    const blog = await setup(t);
    const out = await blog.render('feed', { posts: [{ ...row(), cover }] });
    assert.equal(Object.hasOwn(out.items[0], 'image'), false);
  });
}
