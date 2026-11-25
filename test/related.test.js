import assert from 'node:assert/strict';
import test from 'node:test';

import { json } from '../src/index.js';
import { blogWith } from './fixture.js';

const CLOCK = () => Temporal.Instant.from('2026-04-26T12:00:00Z');

async function setup(t) {
  const blog = await blogWith([], {
    base: 'https://nko.io',
    timeZone: 'Europe/Moscow',
    clock: CLOCK
  });
  t.after(() => blog.close());

  return blog;
}

async function published(blog, data) {
  const post = await blog.create(data);
  await post.publish();

  return post;
}

function render(blog, related, post, signal) {
  const ctx = { yamb: blog, timeZone: 'Europe/Moscow', base: new URL('https://nko.io'), signal };

  return json({ related }).post(post.toJSON(), ctx);
}

test("related 'uri' resolves related ids to current URIs", async (t) => {
  const blog = await setup(t);
  const second = await published(blog, { title: 'Second', text: 's' });
  const first = await published(blog, {
    title: 'First',
    text: 'f',
    links: { related: [second.id] }
  });

  const view = await render(blog, 'uri', first);
  assert.deepEqual(view.related, [second.uri]);

  view.related.push('2026/04/foreign');
  assert.deepEqual(view.links.related, [second.uri]);
  assert.deepEqual(first.links.related, [second.id]);
});

test("related 'summary' resolves to summary objects", async (t) => {
  const blog = await setup(t);
  const second = await published(blog, { title: 'Second', text: 's' });
  const first = await published(blog, {
    title: 'First',
    text: 'f',
    links: { related: [second.id] }
  });

  const { related } = await render(blog, 'summary', first);

  assert.deepEqual(related, [
    {
      uri: second.uri,
      url: second.url().href,
      title: 'Second',
      publishedAt: second.publishedAt.toString(),
      publishedDate: '2026-04-26'
    }
  ]);
});

test("related 'full' returns full views one level deep", async (t) => {
  const blog = await setup(t);
  const third = await published(blog, { title: 'Third', text: 't' });
  const second = await published(blog, {
    title: 'Second',
    text: 's',
    links: { related: [third.id] }
  });
  const first = await published(blog, {
    title: 'First',
    text: 'f',
    links: { related: [second.id] }
  });

  const { related } = await render(blog, 'full', first);
  assert.equal(related.length, 1);

  const [view] = related;
  assert.equal(view.uri, second.uri);
  assert.equal(view.title, 'Second');
  assert.equal(view.text, 's');
  assert.deepEqual(view.meta, {});
  assert.equal('related' in view, false);
  assert.deepEqual(view.links.related, [third.uri]);
});

test('related false omits the top-level field', async (t) => {
  const blog = await setup(t);
  const second = await published(blog, { title: 'Second', text: 's' });
  const first = await published(blog, {
    title: 'First',
    text: 'f',
    links: { related: [second.id] }
  });

  const view = await render(blog, false, first);
  assert.equal('related' in view, false);
  assert.deepEqual(view.links.related, [second.uri]);
});

test("related 'full' rejects more than 10 posts", async (t) => {
  const blog = await setup(t);
  const ids = [];

  for (let i = 0; i < 11; i++) {
    const post = await published(blog, { title: `P${i}`, text: 'x' });
    ids.push(post.id);
  }

  const owner = await published(blog, { title: 'Owner', text: 'o', links: { related: ids } });

  await assert.rejects(() => render(blog, 'full', owner), { code: 'YAMB_RENDERER_FAILED' });

  const summary = await render(blog, 'summary', owner);
  assert.equal(summary.related.length, 11);
});

test("related 'full' rejects more than 2000000 combined text chars", async (t) => {
  const blog = await setup(t);
  const ids = [];

  for (let i = 0; i < 3; i++) {
    const post = await published(blog, { title: `P${i}`, text: 'x'.repeat(700_000) });
    ids.push(post.id);
  }

  const owner = await published(blog, { title: 'Owner', text: 'o', links: { related: ids } });

  await assert.rejects(() => render(blog, 'full', owner), { code: 'YAMB_RENDERER_FAILED' });
});

test('related lookup skips a removed target', async (t) => {
  const blog = await setup(t);
  const second = await published(blog, { title: 'Second', text: 's' });
  const third = await published(blog, { title: 'Third', text: 't' });
  const first = await published(blog, {
    title: 'First',
    text: 'f',
    links: { related: [third.id, second.id] }
  });

  await third.remove();

  const summary = await render(blog, 'summary', first);
  assert.deepEqual(
    summary.related.map((item) => item.uri),
    [second.uri]
  );

  const uris = await render(blog, 'uri', first);
  assert.deepEqual(uris.related, [second.uri]);
});

test('related lookup cancellation preserves the native reason', async (t) => {
  const blog = await setup(t);
  const target = await published(blog, { title: 'Target' });
  const owner = await blog.create({ title: 'Owner', links: { related: [target.id] } });
  const controller = new AbortController();
  const reason = { stopped: true };
  const find = blog.storage.find.bind(blog.storage);

  blog.storage.find = async (...args) => {
    controller.abort(reason);
    return find(...args);
  };

  await assert.rejects(
    () => render(blog, 'summary', owner, controller.signal),
    (error) => error === reason
  );
});
