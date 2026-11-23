import assert from 'node:assert/strict';
import test from 'node:test';

import { json } from '../src/index.js';
import { blogWith } from './fixture.js';

async function setup(t, config = {}) {
  const blog = await blogWith([], {
    base: 'https://example.com/blog',
    timeZone: 'Europe/Istanbul',
    renderers: { json: json(config) }
  });
  t.after(() => blog.close());

  return blog;
}

test('JSON renders a captured revision while related lookup waits, filtering hidden targets', async (t) => {
  const blog = await setup(t, { related: 'full' });
  const target = await blog.create({ title: 'Target', text: '**target**' });
  await target.publish();
  const hidden = await blog.create({ title: 'Hidden' });
  const owner = await blog.create({
    title: 'Before',
    text: '**source**\r\n',
    preview: '*preview*',
    links: { related: [target.id, hidden.id] }
  });
  await owner.publish();
  owner.links.related.push('missing');

  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const find = blog.storage.find.bind(blog.storage);

  blog.storage.find = async (...args) => {
    blog.storage.find = find;
    entered.resolve();
    await release.promise;
    return find(...args);
  };

  const rendering = owner.render('json');
  await entered.promise;

  owner.title = 'After';
  owner.text = 'After';
  owner.links.related = [];
  owner.tags.push('after');
  target.slug = 'renamed';
  await target.save();

  release.resolve();
  const out = await rendering;

  assert.equal(out.title, 'Before');
  assert.equal(out.text, '**source**\r\n');
  assert.equal(out.preview, '*preview*');
  assert.deepEqual(out.tags, []);
  assert.equal(out.url, 'https://example.com/blog/2026/11/before');
  assert.equal(out.publishedDate, '2026-11-10');
  assert.deepEqual(out.links.related, ['2026/11/renamed']);
  assert.equal(out.related[0].title, 'Target');
  assert.equal(out.related[0].text, '**target**');
  assert.equal('related' in out.related[0], false);
});

test('JSON supports supplied data and both collection views without changing Markdown', async (t) => {
  const blog = await setup(t);
  const post = blog.build({
    title: 'Guide',
    slug: 'guide',
    text: '**source**',
    publishedAt: '2026-11-10T09:00:00Z',
    status: 'published'
  });
  const data = post.toJSON();
  post.title = 'Current';

  const retained = await blog.render('json', { post: data });
  assert.equal(retained.title, 'Guide');

  const summary = await blog.render('json', { posts: [post] });
  assert.equal(summary.posts[0].title, 'Current');
  assert.equal('text' in summary.posts[0], false);

  const full = await blog.render('json', { posts: [post], view: 'full' });
  assert.equal(full.posts[0].text, '**source**');
  assert.equal(full.posts[0].publishedAt, '2026-11-10T09:00:00Z');
  assert.equal(post.text, '**source**');
});
