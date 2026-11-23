import assert from 'node:assert/strict';
import test from 'node:test';

import { json } from '../../src/index.js';
import { expandRelated } from '../../src/related/expand.js';
import { blogWith } from '../fixture.js';

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

function makeCtx(yamb, timeZone = 'Europe/Moscow') {
  return {
    yamb,
    format: 'json',
    scope: 'post',
    timeZone,
    base: new URL('https://nko.io')
  };
}

test("expandRelated mode 'uri' resolves related ids to current URIs", async () => {
  await withBlog(async (blog) => {
    const second = await blog.create({ title: 'Second', text: 's' });
    await second.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [second.id] }
    });

    await first.publish();

    const ctx = makeCtx(blog);
    const result = await expandRelated(first.toJSON(), ctx, 'uri');
    assert.deepEqual(result, [second.uri]);

    result.push('2026/04/foreign');
    assert.deepEqual(first.links.related, [second.id]);
  });
});

test("expandRelated mode 'summary' resolves to summary view objects", async () => {
  await withBlog(async (blog) => {
    const second = await blog.create({ title: 'Second', text: 's' });
    await second.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [second.id] }
    });

    await first.publish();

    const ctx = makeCtx(blog);
    const result = await expandRelated(first.toJSON(), ctx, 'summary');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);

    const item = result[0];
    assert.equal(item.uri, second.uri);
    assert.equal(item.url, second.url().href);
    assert.equal(item.title, 'Second');
    assert.equal(typeof item.publishedAt, 'string');
    assert.match(item.publishedAt, /Z$/);
    assert.equal(typeof item.publishedDate, 'string');
    assert.match(item.publishedDate, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test("expandRelated mode 'full' returns full views without recursive related", async () => {
  await withBlog(async (blog) => {
    const third = await blog.create({ title: 'Third', text: 't' });
    await third.publish();

    const second = await blog.create({
      title: 'Second',
      text: 's',
      links: { related: [third.id] }
    });

    await second.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [second.id] }
    });

    await first.publish();

    const ctx = makeCtx(blog);
    const result = await expandRelated(first.toJSON(), ctx, 'full');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);

    const view = result[0];
    assert.equal(view.uri, second.uri);
    assert.equal(view.title, 'Second');
    assert.equal(typeof view.text, 'string');
    assert.equal(typeof view.meta, 'object');
    assert.equal('related' in view, false);
    assert.deepEqual(view.links.related, [third.uri]);
  });
});

test('expandRelated mode false returns undefined', async () => {
  await withBlog(async (blog) => {
    const second = await blog.create({ title: 'Second', text: 's' });
    await second.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [second.id] }
    });

    await first.publish();

    const ctx = makeCtx(blog);
    const result = await expandRelated(first.toJSON(), ctx, false);
    assert.equal(result, undefined);
  });
});

test("expandRelated mode 'full' rejects >10 related posts (DoS cap)", async () => {
  await withBlog(async (blog) => {
    const ids = [];

    for (let i = 0; i < 11; i++) {
      const p = await blog.create({ title: `P${i}`, text: 'x' });
      await p.publish();
      ids.push(p.id);
    }

    const owner = await blog.create({
      title: 'Owner',
      text: 'o',
      links: { related: ids }
    });

    await owner.publish();

    const ctx = makeCtx(blog);
    await assert.rejects(() => expandRelated(owner.toJSON(), ctx, 'full'), {
      code: 'YAMB_RENDERER_FAILED'
    });

    const summary = await expandRelated(owner.toJSON(), ctx, 'summary');
    assert.equal(summary.length, 11);
  });
});

test("expandRelated mode 'full' rejects when total text exceeds 2M chars", async () => {
  await withBlog(async (blog) => {
    const ids = [];
    const heavyText = 'x'.repeat(700_000);

    for (let i = 0; i < 3; i++) {
      const p = await blog.create({ title: `P${i}`, text: heavyText });
      await p.publish();
      ids.push(p.id);
    }

    const owner = await blog.create({
      title: 'Owner',
      text: 'o',
      links: { related: ids }
    });

    await owner.publish();

    const ctx = makeCtx(blog);
    await assert.rejects(() => expandRelated(owner.toJSON(), ctx, 'full'), {
      code: 'YAMB_RENDERER_FAILED'
    });
  });
});

test('expandRelated skips a missing related target', async () => {
  await withBlog(async (blog) => {
    const second = await blog.create({ title: 'Second', text: 's' });
    await second.publish();

    const third = await blog.create({ title: 'Third', text: 't' });
    await third.publish();

    const first = await blog.create({
      title: 'First',
      text: 'f',
      links: { related: [third.id, second.id] }
    });

    await first.publish();

    await third.remove();

    const ctx = makeCtx(blog);
    const summary = await expandRelated(first.toJSON(), ctx, 'summary');
    assert.equal(summary.length, 1);
    assert.equal(summary[0].uri, second.uri);

    const uris = await expandRelated(first.toJSON(), ctx, 'uri');
    assert.deepEqual(uris, [second.uri]);
  });
});

test('related lookup cancellation preserves native reason and prevents a partial result', async () => {
  await withBlog(async (blog) => {
    const target = await blog.create({ title: 'Target' });
    await target.publish();
    const owner = await blog.create({ title: 'Owner', links: { related: [target.id] } });
    const controller = new AbortController();
    const reason = { stopped: true };
    const find = blog.storage.find.bind(blog.storage);

    blog.storage.find = async (...args) => {
      controller.abort(reason);
      return find(...args);
    };

    await assert.rejects(
      () =>
        expandRelated(
          owner.toJSON(),
          {
            ...makeCtx(blog),
            signal: controller.signal
          },
          'summary'
        ),
      (error) => error === reason
    );
  });
});
