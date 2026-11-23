import assert from 'node:assert/strict';
import test from 'node:test';

import { json } from '../../src/index.js';
import { blogWith, postData } from '../fixture.js';

const CLOCK = () => Temporal.Instant.from('2026-04-26T12:00:00Z');

function makeBlog({ rendererConfig = {}, timeZone = 'Europe/Moscow' } = {}) {
  return blogWith([], {
    renderers: { json: json(rendererConfig) },
    base: 'https://nko.io',
    timeZone,
    clock: CLOCK
  });
}

async function withBlog(fn, options) {
  const blog = await makeBlog(options);

  try {
    await fn(blog);
  } finally {
    await blog.close();
  }
}

async function publishMany(blog, titles) {
  const out = [];

  for (const title of titles) {
    const post = await blog.create({ title, text: `body of ${title}` });
    await post.publish();
    out.push(post);
  }

  return out;
}

test('blog.render(json, { posts }) returns { posts: [summary,...] } by default', async () => {
  await withBlog(async (blog) => {
    await publishMany(blog, ['A', 'B', 'C']);
    const result = await blog.render('json', { posts: blog.all() });
    assert.ok(result && typeof result === 'object');
    assert.ok(Array.isArray(result.posts));
    assert.equal(result.posts.length, 3);

    const expected = ['uri', 'url', 'title', 'preview', 'tags', 'publishedAt', 'publishedDate'];

    for (const item of result.posts) {
      const keys = Object.keys(item).toSorted();

      assert.deepEqual(
        keys,
        [...expected].toSorted(),
        `summary keys must be exactly ${expected.join(',')}`
      );

      assert.equal(typeof item.uri, 'string');
      assert.equal(typeof item.url, 'string');
      assert.equal(typeof item.title, 'string');
      assert.equal(typeof item.preview, 'string');
      assert.ok(Array.isArray(item.tags));
      assert.equal(typeof item.publishedAt, 'string');
      assert.match(item.publishedAt, /Z$/);
      assert.equal(typeof item.publishedDate, 'string');
      assert.match(item.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

test('summary excludes text, meta, social, author, cover, links, related, status, createdAt, updatedAt, options, slug', async () => {
  await withBlog(async (blog) => {
    await publishMany(blog, ['One']);
    const result = await blog.render('json', { posts: blog.all() });
    const item = result.posts[0];

    const forbidden = [
      'text',
      'meta',
      'social',
      'author',
      'cover',
      'links',
      'related',
      'status',
      'createdAt',
      'updatedAt',
      'options',
      'slug'
    ];

    for (const key of forbidden) {
      assert.equal(key in item, false, `summary must not contain "${key}"`);
    }
  });
});

test("view: 'full' returns full views with text, meta, social, author, cover, links, related, status, slug", async () => {
  await withBlog(async (blog) => {
    await publishMany(blog, ['Alpha', 'Beta']);

    const result = await blog.render('json', {
      posts: blog.all(),
      view: 'full'
    });

    assert.equal(result.posts.length, 2);

    for (const item of result.posts) {
      const expected = [
        'uri',
        'slug',
        'url',
        'title',
        'preview',
        'text',
        'cover',
        'tags',
        'author',
        'links',
        'related',
        'meta',
        'social',
        'status',
        'createdAt',
        'updatedAt',
        'publishedAt',
        'publishedDate'
      ];

      for (const key of expected) {
        assert.ok(key in item, `full view must include "${key}"`);
      }

      assert.deepEqual(item.options, {});
      assert.equal(typeof item.text, 'string');
      assert.equal(typeof item.meta, 'object');
      assert.equal(typeof item.social, 'object');
      assert.equal(typeof item.author, 'object');
      assert.equal(typeof item.publishedDate, 'string');
    }
  });
});

test('consumes AsyncIterator lazily — counting iterable yields only requested items', async () => {
  await withBlog(async (blog) => {
    const posts = await publishMany(blog, ['p1', 'p2', 'p3', 'p4', 'p5']);
    let consumed = 0;

    async function* counting() {
      for (const post of posts.slice(0, 2)) {
        consumed += 1;
        yield post;
      }
    }

    const result = await blog.render('json', { posts: counting() });
    assert.equal(result.posts.length, 2);
    assert.equal(consumed, 2);
  });
});

test('missing input.posts throws YAMB_RENDERER_INPUT', async () => {
  await withBlog(async (blog) => {
    await assert.rejects(
      () => blog.render('json', {}),
      (err) => err?.code === 'YAMB_RENDERER_INPUT'
    );

    await assert.rejects(
      () => blog.render('json', { posts: undefined }),
      (err) => err?.code === 'YAMB_RENDERER_INPUT'
    );
  });
});

test('pre-aborted signal throws AbortError before first iteration', async () => {
  await withBlog(async (blog) => {
    await publishMany(blog, ['one', 'two']);
    let consumed = 0;

    async function* counting() {
      for (const post of await blog.all().toArray()) {
        consumed += 1;
        yield post;
      }
    }

    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () => blog.render('json', { posts: counting() }, { signal: ac.signal }),
      (err) => err?.name === 'AbortError'
    );

    assert.equal(consumed, 0, 'iterator must not be consumed when signal pre-aborted');
  });
});

test('accepts a plain array of Posts', async () => {
  await withBlog(async (blog) => {
    const posts = await publishMany(blog, ['arr1', 'arr2']);
    const result = await blog.render('json', { posts });
    assert.equal(result.posts.length, 2);
    assert.equal(result.posts[0].title, 'arr1');
    assert.equal(result.posts[1].title, 'arr2');
  });
});

test('accepts an inline async generator (AsyncIterable)', async () => {
  await withBlog(async (blog) => {
    const posts = await publishMany(blog, ['g1', 'g2', 'g3']);

    async function* gen() {
      for (const p of posts) {
        yield p;
      }
    }

    const result = await blog.render('json', { posts: gen() });
    assert.equal(result.posts.length, 3);

    assert.deepEqual(
      result.posts.map((p) => p.title),
      ['g1', 'g2', 'g3']
    );
  });
});

for (const api of ['direct', 'blog']) {
  test(`${api} summary owns tags without reading unused full data`, async (t) => {
    const renderer = json();
    const blog = await blogWith([], { renderers: { json: renderer } });
    t.after(() => blog.close());

    const source = { uri: 'drafts/summary', title: 'Summary', tags: ['original'] };

    for (const field of ['text', 'options', 'cover', 'links', 'tree']) {
      Object.defineProperty(source, field, { enumerable: true, get: () => assert.fail(field) });
    }

    const input = { posts: [source] };
    const ctx = { base: new URL('https://example.test/blog'), timeZone: 'UTC' };
    const pending = api === 'blog' ? blog.render('json', input) : renderer.collection(input, ctx);
    const result = await pending;

    result.posts[0].tags.push('view');
    assert.deepEqual(source.tags, ['original']);
    assert.equal(Object.hasOwn(result.posts[0], 'text'), false);
  });

  test(`${api} full collection captures each item only when it arrives`, async (t) => {
    const renderer = json();
    const blog = await blogWith([], { renderers: { json: renderer } });
    t.after(() => blog.close());

    const target = await blog.create({ title: 'Target' });
    await target.publish();
    const first = { ...postData(0), uri: 'drafts/first', links: { related: [target.id] } };
    const second = { ...postData(0), uri: 'drafts/second', title: 'Second' };
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const find = blog.storage.find.bind(blog.storage);

    blog.storage.find = async (...args) => {
      entered.resolve();
      await release.promise;
      return find(...args);
    };

    let consumed = 0;

    function* posts() {
      for (const source of [first, second]) {
        consumed++;
        yield source;
      }
    }

    const input = { posts: posts(), view: 'full' };
    const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };
    const pending = api === 'blog' ? blog.render('json', input) : renderer.collection(input, ctx);

    try {
      await entered.promise;
      assert.equal(consumed, 1);
      second.title = 'Arrived later';
    } finally {
      release.resolve();
    }

    const result = await pending;

    assert.equal(consumed, 2);
    assert.equal(result.posts[1].title, 'Arrived later');
  });

  test(`${api} ordinary collection closes source and preserves primary errors and abort`, async (t) => {
    const renderer = json();
    const blog = await blogWith([], { renderers: { json: renderer } });
    t.after(() => blog.close());
    let storageClosed = 0;
    const close = blog.storage.close.bind(blog.storage);

    blog.storage.close = () => {
      storageClosed++;
      return close();
    };

    for (const view of [undefined, 'full']) {
      const modes = ['next', 'value', 'abort', 'uri'];

      if (view === 'full') {
        modes.push('lookup');
      }

      for (const async of [false, true]) {
        for (const mode of modes) {
          const primary = new Error(mode);
          const ac = new AbortController();
          let closed = 0;
          blog.storage.find = async () => {
            throw primary;
          };
          const posts = {
            [async ? Symbol.asyncIterator : Symbol.iterator]() {
              let emitted = false;

              return {
                next() {
                  if (emitted) {
                    return { done: true };
                  }

                  emitted = true;

                  if (mode === 'next') {
                    throw primary;
                  }

                  if (mode === 'value') {
                    return {
                      get value() {
                        throw primary;
                      },
                      done: false
                    };
                  }

                  if (mode === 'abort') {
                    ac.abort(null);
                  }

                  return {
                    value: {
                      ...postData(0),
                      uri: mode === 'uri' ? '../outside' : 'drafts/source',
                      links: { related: ['target'] }
                    },
                    done: false
                  };
                },

                return() {
                  closed++;
                  throw new Error('cleanup');
                }
              };
            }
          };
          const input = { posts, view };
          const ctx = {
            yamb: blog,
            base: new URL('https://example.test/blog'),
            timeZone: 'UTC',
            signal: ac.signal
          };
          const render = () => {
            if (api === 'blog') {
              return blog.render('json', input, { signal: ac.signal });
            }

            return renderer.collection(input, ctx);
          };

          await assert.rejects(render, (error) => {
            if (mode === 'abort') {
              return Object.is(error, null);
            }

            if (mode === 'uri') {
              return error.code === 'YAMB_RENDERER_INPUT';
            }

            return error === primary || error.cause === primary;
          });
          assert.equal(closed, 1, `${view}/${async}/${mode}`);
        }
      }
    }

    assert.equal(storageClosed, 0);
  });
}
