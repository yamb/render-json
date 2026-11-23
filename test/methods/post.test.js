import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { Post } from 'yamb';

import { JsonRenderer, json } from '../../src/index.js';
import { buildFullView } from '../../src/views/post-full.js';
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

test('post.render(json) returns full view shape with default config', async () => {
  await withBlog(async (blog) => {
    const post = await blog.create({
      title: 'Hello',
      preview: 'Preview text',
      text: 'Body text',
      cover: { url: '/covers/hello.jpg' },
      tags: ['javascript'],
      author: { name: 'Alex', email: 'alex@example.com' },
      meta: { title: 'Meta title', description: 'Meta desc' },
      social: { title: 'Social title' }
    });

    await post.publish();

    const out = await post.render('json');

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
      assert.ok(key in out, `missing field "${key}" in output`);
    }

    assert.deepEqual(out.options, {});
    assert.equal(typeof out.uri, 'string');
    assert.equal(typeof out.slug, 'string');
    assert.equal(typeof out.url, 'string');
    assert.equal(out.url, post.url().href);
    assert.equal(typeof out.title, 'string');
    assert.equal(typeof out.preview, 'string');
    assert.equal(typeof out.text, 'string');
    assert.deepEqual(out.cover, { url: '/covers/hello.jpg' });
    assert.ok(Array.isArray(out.tags));
    assert.equal(typeof out.author, 'object');
    assert.equal(typeof out.links, 'object');
    assert.ok(Array.isArray(out.links.related));
    assert.ok(Array.isArray(out.related));
    assert.equal(typeof out.meta, 'object');
    assert.equal(typeof out.social, 'object');
    assert.equal(out.status, 'published');
    assert.equal(typeof out.createdAt, 'string');
    assert.match(out.createdAt, /Z$/);
    assert.equal(typeof out.updatedAt, 'string');
    assert.match(out.updatedAt, /Z$/);
    assert.equal(typeof out.publishedAt, 'string');
    assert.match(out.publishedAt, /Z$/);
    assert.equal(typeof out.publishedDate, 'string');
    assert.match(out.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test('publishedDate respects timeZone (Europe/Moscow shift)', async () => {
  await withBlog(async (blog) => {
    const post = blog.build({ title: 'Late night', text: 'x' });
    post.publishedAt = '2026-04-26T22:00:00Z';
    await post.publish();

    const out = await post.render('json');
    assert.equal(out.publishedAt, '2026-04-26T22:00:00Z');
    assert.equal(out.publishedDate, '2026-04-27');
  });
});

test('text: false config omits text from output', async () => {
  await withBlog(
    async (blog) => {
      const post = await blog.create({ title: 'NoBody', text: 'Hidden' });
      await post.publish();
      const out = await post.render('json');
      assert.equal('text' in out, false);
      assert.equal(out.title, 'NoBody');
    },
    { rendererConfig: { text: false } }
  );
});

test('renderer does not mutate Post', async () => {
  await withBlog(async (blog) => {
    const post = await blog.create({
      title: 'Original',
      text: 'Body',
      tags: ['a', 'b'],
      author: { name: 'X' }
    });

    await post.publish();

    const before = post.toJSON();
    await post.render('json');
    const after = post.toJSON();

    assert.ok(isDeepStrictEqual(before, after), 'post.toJSON() must not change');
  });
});

test('post with undefined publishedAt omits publishedAt and publishedDate', async () => {
  const fakePost = new Post(
    { timeZone: 'Europe/Moscow', base: 'https://nko.io' },
    {
      uri: null,
      slug: 'pending',
      title: 'Pending',
      preview: '',
      text: 'wip',
      cover: {},
      tags: [],
      author: { name: 'A' },
      links: { related: [] },
      meta: {},
      social: {},
      status: 'draft',
      createdAt: Temporal.Instant.from('2026-04-26T10:00:00Z'),
      updatedAt: Temporal.Instant.from('2026-04-26T10:00:00Z'),
      publishedAt: undefined,
      options: {}
    },
    { pristine: false }
  );

  const ctx = {
    yamb: {},
    format: 'json',
    scope: 'post',
    timeZone: 'Europe/Moscow',
    base: new URL('https://nko.io')
  };

  const out = await buildFullView(fakePost.toJSON(), ctx, {
    text: true,
    related: 'uri'
  });

  assert.equal('publishedAt' in out, false);
  assert.equal('publishedDate' in out, false);
  assert.equal(out.title, 'Pending');
  assert.equal(out.text, 'wip');
  assert.equal(out.status, 'draft');
  assert.equal(typeof out.createdAt, 'string');
});

test('default related mode "uri": top-level related mirrors links.related', async () => {
  await withBlog(async (blog) => {
    const second = await blog.create({ title: 'Second', text: 's' });
    await second.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [second.id] }
    });

    await first.publish();

    const out = await first.render('json');
    assert.deepEqual(out.links.related, [second.uri]);
    assert.deepEqual(out.related, [second.uri]);

    out.related.push('2026/04/foreign');
    assert.deepEqual(first.links.related, [second.id]);

    out.links.related.push('2026/04/another');
    assert.deepEqual(first.links.related, [second.id]);
  });
});

test('default related mode "uri": links.related omits a draft target, keeps a published one', async () => {
  await withBlog(async (blog) => {
    const draft = await blog.create({ title: 'Draft target', text: 'd' });
    const published = await blog.create({ title: 'Published target', text: 'p' });
    await published.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [draft.id, published.id] }
    });

    await first.publish();

    const out = await first.render('json');
    assert.deepEqual(out.links.related, [published.uri]);
    assert.deepEqual(out.related, [published.uri]);
  });
});

test('signal abort throws AbortError', async () => {
  await withBlog(async (blog) => {
    const post = await blog.create({ title: 'X', text: 'y' });
    await post.publish();

    const ac = new AbortController();
    ac.abort();

    await assert.rejects(
      () => post.render('json', { signal: ac.signal }),
      (err) => err?.name === 'AbortError'
    );
  });
});

test('structured clone of nested fields (tags, author)', async () => {
  await withBlog(async (blog) => {
    const post = await blog.create({
      title: 'Clone',
      text: 'b',
      tags: ['one', 'two'],
      author: { name: 'A', url: '/about' }
    });

    await post.publish();

    const out = await post.render('json');
    out.tags.push('mutated');
    assert.deepEqual(post.tags, ['one', 'two']);

    out.author.name = 'Mutated';
    assert.equal(post.author.name, 'A');
  });
});

test("config related: 'summary' expands top-level related into summary objects", async () => {
  await withBlog(
    async (blog) => {
      const draft = await blog.create({ title: 'Draft target', text: 'd' });
      const second = await blog.create({ title: 'Second', text: 's' });
      await second.publish();

      const first = await blog.create({
        title: 'First',
        text: 'f',
        links: { related: [draft.id, second.id] }
      });

      await first.publish();

      const out = await first.render('json');
      assert.ok(Array.isArray(out.related));
      assert.equal(out.related.length, 1);

      const item = out.related[0];
      assert.equal(item.uri, second.uri);
      assert.equal(item.url, second.url().href);
      assert.equal(item.title, 'Second');
      assert.equal(typeof item.publishedAt, 'string');
      assert.match(item.publishedAt, /Z$/);
      assert.equal(typeof item.publishedDate, 'string');
      assert.match(item.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.deepEqual(out.links.related, [second.uri]);
    },
    { rendererConfig: { related: 'summary' } }
  );
});

test("config related: 'full' expands top-level related into full views", async () => {
  await withBlog(
    async (blog) => {
      const second = await blog.create({
        title: 'Second',
        text: 'second-body'
      });

      await second.publish();

      const first = await blog.create({
        title: 'First',
        text: 'f',
        links: { related: [second.id] }
      });

      await first.publish();

      const out = await first.render('json');
      assert.ok(Array.isArray(out.related));
      assert.equal(out.related.length, 1);

      const view = out.related[0];
      assert.equal(view.uri, second.uri);
      assert.equal(view.text, 'second-body');
      assert.equal(typeof view.meta, 'object');
      assert.equal('related' in view, false);
    },
    { rendererConfig: { related: 'full' } }
  );
});

test('config related: false omits top-level related and filters links.related to published targets', async () => {
  await withBlog(
    async (blog) => {
      const draft = await blog.create({ title: 'Draft target', text: 'd' });
      const second = await blog.create({ title: 'Second', text: 's' });
      await second.publish();

      const first = await blog.create({
        title: 'First',
        text: 'f',
        links: { related: [draft.id, second.id] }
      });

      await first.publish();

      const out = await first.render('json');
      assert.equal('related' in out, false);
      assert.deepEqual(out.links.related, [second.uri]);
    },
    { rendererConfig: { related: false } }
  );
});

test('json().post rejects a non-Post input with YAMB_RENDERER_INPUT', async () => {
  const renderer = json();
  const ctx = { base: new URL('https://e.com'), timeZone: 'UTC' };

  await assert.rejects(() => renderer.post(null, ctx), { code: 'YAMB_RENDERER_INPUT' });
  await assert.rejects(() => renderer.post({}, ctx), { code: 'YAMB_RENDERER_INPUT' });
});

test('JSON cover views own complete, partial and empty objects', async () => {
  const renderer = json();
  const ctx = { base: new URL('https://example.com/'), timeZone: 'UTC' };

  for (const cover of [
    { url: '/cover.jpg', alt: 'Alt', caption: 'Caption', width: 10, height: 20 },
    { caption: 'No image' },
    {},
    undefined
  ]) {
    const source = { title: 'Cover', uri: 'drafts/cover', text: '', cover };
    const view = await renderer.post(source, ctx);

    assert.deepEqual(view.cover, cover ?? {});

    const caption = source.cover?.caption;
    view.cover.caption = 'View';

    assert.equal(source.cover?.caption, caption);
    assert.notStrictEqual(view.cover, source.cover);
  }
});

test('direct JSON rendering rejects invalid cover data', async () => {
  const renderer = json();
  const ctx = { base: new URL('https://example.com/'), timeZone: 'UTC' };

  for (const cover of ['/cover.jpg', null, [], { unknown: true }, { url: '//example.com/a' }]) {
    await assert.rejects(
      () => renderer.post({ title: 'Cover', uri: 'drafts/cover', text: '', cover }, ctx),
      { code: 'YAMB_RENDERER_INPUT' }
    );
  }
});

for (const api of ['direct', 'blog']) {
  for (const scope of ['post', 'collection']) {
    test(`${api} ${scope} captures all full fields and related IDs before lookup`, async () => {
      for (const related of ['uri', 'summary', 'full', false]) {
        const renderer = new JsonRenderer({ related });
        const blog = await blogWith([], {
          base: 'https://example.test/blog',
          renderers: { json: renderer }
        });

        try {
          const targets = [];

          for (const title of ['First', 'Second']) {
            const target = await blog.create({ title, text: `**${title}**` });
            await target.publish();
            targets.push(target);
          }

          const hidden = await blog.create({ title: 'Hidden' });
          const source = {
            ...postData(0),
            uri: '2026/11/source',
            title: 'Original',
            text: '**Сырой**\r\n\ud800 😀\u0000',
            preview: '',
            cover: { url: './cover.jpg', caption: '"Raw"' },
            author: { name: 'Original' },
            social: { title: 'Original' },
            options: { nested: { value: 1 } },
            links: { related: [...targets.map((p) => p.id), hidden.id, 'missing'] }
          };
          const before = structuredClone(source);
          const entered = Promise.withResolvers();
          const release = Promise.withResolvers();
          const find = blog.storage.find.bind(blog.storage);

          blog.storage.find = async (...args) => {
            if (args[0] === targets[0].id) {
              entered.resolve();
              await release.promise;
            }

            return find(...args);
          };

          const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };
          const input = scope === 'post' ? { post: source } : { posts: [source], view: 'full' };
          const direct =
            scope === 'post'
              ? () => renderer.post(source, ctx)
              : () => renderer.collection(input, ctx);
          const pending = api === 'blog' ? blog.render('json', input) : direct();

          try {
            await entered.promise;

            source.title = 'After';
            source.text = 'After';
            source.uri = '2026/11/after';
            source.slug = 'after';
            source.status = 'draft';
            source.createdAt = '2026-11-12T00:00:00Z';
            source.updatedAt = '2026-11-12T00:00:00Z';
            source.publishedAt = '2026-11-12T00:00:00Z';
            source.preview = 'After';
            source.cover.caption = 'After';
            source.author.name = 'After';
            source.tags.push('after');
            source.meta.keywords.push('after');
            source.social.title = 'After';
            source.options.nested.value = 2;
            source.links.related.splice(1);
          } finally {
            release.resolve();
          }

          const result = await pending;
          const view = scope === 'post' ? result : result.posts[0];

          for (const key of [
            'uri',
            'slug',
            'status',
            'createdAt',
            'updatedAt',
            'publishedAt',
            'title',
            'text',
            'preview',
            'cover',
            'tags',
            'author',
            'meta',
            'social',
            'options'
          ]) {
            assert.deepEqual(view[key], before[key], key);
          }

          assert.deepEqual(
            view.links.related,
            targets.map((p) => p.uri)
          );

          if (related === false) {
            assert.equal(Object.hasOwn(view, 'related'), false);
          } else if (related === 'uri') {
            assert.deepEqual(
              view.related,
              targets.map((p) => p.uri)
            );
          } else {
            assert.deepEqual(
              view.related.map((p) => p.title),
              ['First', 'Second']
            );
            assert.equal(view.related[0].url, 'https://example.test/blog/2026/11/first');

            if (related === 'full') {
              assert.equal(view.related[0].text, '**First**');
              assert.equal(Object.hasOwn(view.related[0], 'related'), false);
            }
          }

          assert.equal(JSON.parse(JSON.stringify(view)).text, before.text);
          assert.equal(view.publishedDate, '2026-11-01');
        } finally {
          await blog.close();
        }
      }
    });

    test(`${api} ${scope} owns mutable full output and preserves JSON values`, async () => {
      const renderer = new JsonRenderer();
      const blog = await blogWith([], { renderers: { json: renderer } });

      try {
        const shared = { values: [null, true, 42, 'е́ 😀\ud800'] };
        const source = {
          ...postData(0),
          uri: 'drafts/source',
          cover: { caption: 'Raw' },
          author: { name: 'Original' },
          social: { title: 'Original' },
          options: { left: shared, right: shared }
        };
        const before = structuredClone(source);
        const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };
        const input = scope === 'post' ? { post: source } : { posts: [source], view: 'full' };
        const direct =
          scope === 'post'
            ? () => renderer.post(source, ctx)
            : () => renderer.collection(input, ctx);
        const result = await (api === 'blog' ? blog.render('json', input) : direct());
        const view = scope === 'post' ? result : result.posts[0];

        assert.deepEqual(view.options, before.options);
        assert.strictEqual(view.options.left, view.options.right);
        assert.deepEqual(JSON.parse(JSON.stringify(view.options)), before.options);
        assert.equal(view.preview, '');
        assert.equal(Object.getPrototypeOf(view), Object.prototype);

        view.tags.push('changed');
        view.author.name = 'Changed';
        view.meta.keywords.push('changed');
        view.social.title = 'Changed';
        view.options.left.values.push('changed');
        view.cover.caption = 'Changed';
        view.links.related.push('drafts/other');

        assert.deepEqual(source, before);

        const rendered = structuredClone(view);
        source.tags.push('source');
        source.options.right.values.push('source');

        assert.deepEqual(view, rendered);
        assert.equal(Object.isFrozen(source), false);
      } finally {
        await blog.close();
      }
    });
  }
}

test('minimal ordinary full source retains defaults and text: false', async () => {
  const ctx = { base: new URL('https://example.test/blog'), timeZone: 'UTC' };
  const source = { uri: 'drafts/minimal', title: 'Minimal' };

  for (const text of [true, false]) {
    const renderer = json({ text });
    const post = await renderer.post(source, ctx);
    const collection = await renderer.collection({ posts: [source], view: 'full' }, ctx);

    assert.deepEqual(collection.posts[0], post);
    assert.deepEqual(post.tags, []);

    for (const key of ['cover', 'author', 'meta', 'social']) {
      assert.deepEqual(post[key], {});
    }

    assert.equal(post.preview, '');
    assert.equal(Object.hasOwn(post, 'text'), text);

    if (text) {
      assert.equal(post.text, '');
    }

    assert.equal(post.options, undefined);
  }
});

test('ordinary full views reject non-string and oversized text before lookup', async (t) => {
  const renderer = new JsonRenderer();
  const blog = await blogWith([], { renderers: { json: renderer } });
  t.after(() => blog.close());
  blog.storage.find = () => assert.fail('invalid text reached related lookup');
  const ctx = { yamb: blog, base: new URL('https://example.test/blog'), timeZone: 'UTC' };

  for (const text of [{ nested: { value: 1 } }, null, 42, 'x'.repeat(1048577)]) {
    const source = {
      uri: 'drafts/source',
      title: 'Invalid text',
      text,
      links: { related: ['target'] }
    };

    for (const api of ['direct', 'blog']) {
      for (const scope of ['post', 'collection']) {
        const input = scope === 'post' ? { post: source } : { posts: [source], view: 'full' };
        const direct =
          scope === 'post'
            ? () => renderer.post(source, ctx)
            : () => renderer.collection(input, ctx);

        await assert.rejects(() => (api === 'blog' ? blog.render('json', input) : direct()), {
          code: 'YAMB_RENDERER_INPUT'
        });
      }
    }
  }
});
