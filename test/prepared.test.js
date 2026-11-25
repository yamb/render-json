import assert from 'node:assert/strict';
import test from 'node:test';

import { feed } from '../src/index.js';
import { postData, blogWith } from './fixture.js';

const ctx = { base: new URL('https://example.test/blog'), timeZone: 'UTC' };
const config = { title: 'Feed', feed: 'https://example.test/feed' };
const row = () => ({
  ...postData(100),
  id: 'a/é😀',
  uri: '2026/11/article',
  cover: { url: './cover.jpg' }
});
function value(preview) {
  const result = {
    title: 'Prepared <title> 😀',
    text: { feedHtml: '<p>Introduction</p><hr><p>Complete</p>' },
    cover: {
      url: './cover.jpg',
      alt: '<alt>',
      caption: 'Prepared <caption>',
      width: 320,
      height: 200
    }
  };

  if (preview !== undefined) {
    result.preview = { feedHtml: '<p>HTML preview</p>', plain: preview };
  }

  return result;
}

test('JSON Feed consumes one whole prepared result and never synthesizes preview', async () => {
  for (const preview of [undefined, '', 'Plain preview']) {
    const prepared = value(preview);
    const original = structuredClone(prepared);
    const post = row();
    const before = structuredClone(post);
    let calls = 0;
    const renderer = feed({
      ...config,
      prepare: (data, context) => {
        calls++;
        assert.deepEqual(data, post);
        assert.equal(context, ctx);
        return prepared;
      }
    });

    const out = JSON.parse(JSON.stringify(await renderer.collection({ posts: [post] }, ctx)));
    const entry = out.items[0];

    assert.equal(entry.title, prepared.title);
    assert.equal(entry.image, 'https://example.test/blog/2026/11/cover.jpg');
    assert.equal(
      entry.content_html,
      `<figure><img src="https://example.test/blog/2026/11/cover.jpg" alt="&lt;alt&gt;" width="320" height="200"><figcaption>Prepared &lt;caption&gt;</figcaption></figure>${
        prepared.text.feedHtml
      }`
    );
    assert.equal(entry.summary, preview);
    assert.equal(Object.hasOwn(entry, 'summary'), preview !== undefined);
    assert.equal(Object.hasOwn(entry, 'content_text'), false);
    assert.equal(calls, 1);
    assert.deepEqual(post, before);
    assert.deepEqual(prepared, original);
  }
});

test('JSON Feed captures metadata before callback mutation and await', async () => {
  const post = row();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const renderer = feed({
    ...config,
    prepare: async (data) => {
      data.id = 'callback';
      data.uri = '2026/11/callback';
      data.tags.push('callback');
      entered.resolve();
      await release.promise;
      return value();
    }
  });
  const rendering = renderer.collection({ posts: [post] }, ctx);
  await entered.promise;

  Object.assign(post, { id: 'after', uri: '2026/11/after', publishedAt: '2026-12-01T00:00:00Z' });
  post.tags.push('after');

  release.resolve();
  const result = await rendering;
  const entry = result.items[0];

  assert.equal(entry.id, 'a/é😀');
  assert.equal(entry.url, 'https://example.test/blog/2026/11/article');
  assert.deepEqual(entry.tags, ['javascript']);
  assert.equal(entry.date_published, '2026-11-01T12:00:00.000000000Z');
});

test('JSON Feed literal content remains safe without hidden Markdown and preserves empty preview', async () => {
  const renderer = feed(config);
  const result = await renderer.collection(
    { posts: [{ ...row(), text: '**raw** <script>x</script> & 😀', preview: '', cover: {} }] },
    ctx
  );
  const entry = result.items[0];

  assert.equal(entry.content_html, '**raw** &lt;script&gt;x&lt;/script&gt; &amp; 😀');
  assert.equal(entry.summary, '');
});

test('JSON Feed counts final UTF-8 JSON bytes and closes sync/async sources on overflow', async () => {
  const posts = [{ ...row(), text: '😀 & < > " \r\n', preview: '', cover: {} }];
  const out = await feed(config).collection({ posts }, ctx);
  const bytes = Buffer.byteLength(JSON.stringify(out));
  assert.deepEqual(await feed({ ...config, bytes }).collection({ posts }, ctx), out);

  for (const async of [false, true]) {
    let closed = 0;
    const source = {
      [async ? Symbol.asyncIterator : Symbol.iterator]() {
        return {
          next: () => ({ value: posts[0], done: false }),
          return() {
            closed++;
            return { done: true };
          }
        };
      }
    };

    await assert.rejects(
      () => feed({ ...config, bytes: bytes - 1 }).collection({ posts: source }, ctx),
      { code: 'YAMB_RENDERER_INPUT' }
    );
    assert.equal(closed, 1);
  }
});

test('JSON Feed distinguishes raw source limits from derived expansion', async () => {
  for (const patch of [
    { title: `${' '.repeat(501)}A` },
    { text: '😀'.repeat(524289) },
    { preview: '😀'.repeat(2501) },
    { tags: ['😀'.repeat(33)] },
    { cover: { alt: 'a'.repeat(5001) } },
    { cover: { url: '/a'.repeat(2049) } }
  ]) {
    await assert.rejects(
      () =>
        feed({ ...config, prepare: () => assert.fail('invalid source') }).collection(
          { posts: [{ ...row(), ...patch }] },
          ctx
        ),
      { code: 'YAMB_RENDERER_INPUT' }
    );
  }

  const source = { ...row(), cover: { url: `./${'a'.repeat(4094)}`, caption: 'a'.repeat(5000) } };
  const prepared = {
    ...value(),
    title: 'T'.repeat(501),
    cover: {
      url: new URL(source.cover.url, 'https://example.test/blog/2026/11/article').href,
      caption: 'C'.repeat(5001),
      alt: 'A'.repeat(5001)
    }
  };
  const result = await feed({ ...config, prepare: () => prepared }).collection(
    { posts: [source] },
    ctx
  );
  const entry = result.items[0];

  assert.equal(entry.title, prepared.title);
  assert.equal(entry.image, prepared.cover.url);
  assert.ok(entry.content_html.includes(prepared.cover.caption));
  assert.ok(entry.content_html.includes(`alt="${prepared.cover.alt}"`));

  for (const patch of [
    { title: 'a'.repeat(5000001) },
    { text: { feedHtml: 'a'.repeat(5000001) } },
    { preview: { plain: 'a'.repeat(5000001), feedHtml: '' } },
    { cover: { alt: 'a'.repeat(5000001) } },
    { cover: { url: `https://example.test/${'a'.repeat(5000000)}` } }
  ]) {
    await assert.rejects(
      () =>
        feed({ ...config, prepare: () => ({ ...value(), ...patch }) }).collection(
          { posts: [row()] },
          ctx
        ),
      { code: 'YAMB_RENDERER_INPUT' }
    );
  }
});

test('JSON Feed public path preserves callback errors when source cleanup aborts', async (t) => {
  const controller = new AbortController();
  const failure = new Error('primary');
  let closed = 0;
  const blog = await blogWith([], {
    renderers: {
      feed: feed({
        ...config,
        prepare: () => {
          throw failure;
        }
      })
    }
  });
  t.after(() => blog.close());

  const posts = {
    async *[Symbol.asyncIterator]() {
      try {
        yield row();
      } finally {
        closed++;
        controller.abort(0);
      }
    }
  };

  await assert.rejects(
    () => blog.render('feed', { posts }, { signal: controller.signal }),
    (e) => e.cause === failure
  );
  assert.equal(closed, 1);
});

test('JSON Feed preserves native abort reasons and rejects unsafe prepared covers before output', async (t) => {
  for (const reason of [null, false, 0, NaN]) {
    const controller = new AbortController();
    let closed = 0;
    let result;
    const posts = {
      async *[Symbol.asyncIterator]() {
        try {
          yield row();
        } finally {
          closed++;
        }
      }
    };
    const renderer = feed({
      ...config,
      prepare: () => {
        controller.abort(reason);
        throw reason;
      }
    });

    await assert.rejects(
      async () => {
        result = await renderer.collection({ posts }, { ...ctx, signal: controller.signal });
      },
      (error) => Object.is(error, reason)
    );
    assert.equal(result, undefined);
    assert.equal(closed, 1);
  }

  for (const url of [
    'javascript:alert(1)',
    'data:image/png,x',
    '//example.test/a',
    'https://user:pass@example.test/a',
    '/back\\slash',
    '/space here'
  ]) {
    await assert.rejects(
      () =>
        feed({ ...config, prepare: () => ({ ...value(), cover: { url } }) }).collection(
          { posts: [row()] },
          ctx
        ),
      { code: 'YAMB_RENDERER_INPUT' }
    );
  }

  const renderer = feed({
    ...config,
    prepare: () => {
      t.mock.method(URL, 'parse', () => assert.fail('oversized URL parsed'));
      return { ...value(), cover: { url: `https://example.test/${'x'.repeat(5000000)}` } };
    }
  });
  await assert.rejects(() => renderer.collection({ posts: [row()] }, ctx), {
    code: 'YAMB_RENDERER_INPUT'
  });
});

test('JSON Feed accepts Temporal.Instant source dates and prepares JSON data', async () => {
  const instant = Temporal.Instant.from('2026-11-01T23:30:00Z');
  const source = { ...row(), createdAt: instant, updatedAt: instant, publishedAt: instant };

  const prepare = (data) => {
    assert.deepEqual(data, JSON.parse(JSON.stringify(source)));
    return value();
  };

  for (const options of [{}, { prepare }]) {
    const out = await feed({ ...config, ...options }).collection({ posts: [source] }, ctx);

    assert.equal(out.items[0].date_published, '2026-11-01T23:30:00.000000000Z');
    assert.equal(out.items[0].date_modified, '2026-11-01T23:30:00.000000000Z');
  }
});

test('JSON Feed preserves opaque IDs through JSON serialization', async () => {
  const id = '\ud800';
  const out = await feed(config).collection({ posts: [{ ...row(), id }] }, ctx);
  assert.equal(JSON.parse(JSON.stringify(out)).items[0].id, id);
});
