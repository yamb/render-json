import assert from 'node:assert/strict';
import test from 'node:test';

import { json } from '../src/index.js';
import { blogWith } from './fixture.js';

function makeBlog() {
  return blogWith([], {
    renderers: { json: json() },
    base: 'https://nko.io',
    timeZone: 'Europe/Moscow'
  });
}

async function withBlog(fn) {
  const blog = await makeBlog();

  try {
    await fn(blog);
  } finally {
    await blog.close();
  }
}

async function publishN(blog, n) {
  const posts = [];

  for (let i = 0; i < n; i++) {
    const post = await blog.create({ title: `T${i}`, text: `body-${i}` });
    await post.publish();
    posts.push(post);
  }

  return posts;
}

test('post.render(json) returns full view', async () => {
  await withBlog(async (blog) => {
    const [post] = await publishN(blog, 1);
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
      assert.ok(key in out, `missing field "${key}" in full view`);
    }

    assert.deepEqual(out.options, {});
    assert.equal(out.title, 'T0');
    assert.equal(out.text, 'body-0');
    assert.equal(out.status, 'published');
  });
});

test('blog.render(json, { posts: blog.all() }) returns { posts: [...3 items...] }', async () => {
  await withBlog(async (blog) => {
    await publishN(blog, 3);
    const result = await blog.render('json', { posts: blog.all() });
    assert.ok(result && typeof result === 'object');
    assert.ok(Array.isArray(result.posts));
    assert.equal(result.posts.length, 3);

    for (const item of result.posts) {
      assert.equal(typeof item.uri, 'string');
      assert.equal(typeof item.url, 'string');
      assert.equal(typeof item.title, 'string');
      assert.equal(typeof item.preview, 'string');
      assert.ok(Array.isArray(item.tags));
      assert.equal(typeof item.publishedAt, 'string');
      assert.equal(typeof item.publishedDate, 'string');
    }
  });
});

test('blog.render(json, { posts: blog.all().take(2) }) lazily yields 2 items', async () => {
  await withBlog(async (blog) => {
    await publishN(blog, 5);
    const result = await blog.render('json', { posts: blog.all().take(2) });
    assert.equal(result.posts.length, 2);
  });
});

test("post.render('rss') throws YAMB_RENDERER_MISSING (not registered)", async () => {
  await withBlog(async (blog) => {
    const [post] = await publishN(blog, 1);

    await assert.rejects(
      () => post.render('rss'),
      (err) => err?.code === 'YAMB_RENDERER_MISSING' && err?.name === 'RendererMissingError'
    );
  });
});
