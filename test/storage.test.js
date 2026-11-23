import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { json } from '@meritt/yamb-render-json';
import { MongoClient, ObjectId } from 'mongodb';
import { yamb } from 'yamb';

import { mongodb, test as mongoTest, uri, dbName } from './prepared-mongodb.js';
import { sqlite, test as sqliteTest, path } from './prepared-sqlite.js';

for (const [name, test, create] of [
  ['SQLite', sqliteTest, sqlite],
  ['MongoDB', mongoTest, mongodb]
]) {
  test(`${name} public reads reject corruption and forbidden filters`, async () => {
    const storage = create();
    const blog = yamb({ storage, renderers: { json: json() } });
    await blog.open();
    let db;
    let client;
    let collection;

    try {
      const post = await blog.create({ title: 'Corruption boundary' });
      let replace;
      let original;

      if (name === 'SQLite') {
        db = new DatabaseSync(path);
        original = db.prepare('SELECT raw_json FROM posts WHERE id = ?').get(post.id).raw_json;
        replace = (value) =>
          db
            .prepare('UPDATE posts SET raw_json = ? WHERE id = ?')
            .run(JSON.stringify(value), post.id);
      } else {
        client = new MongoClient(uri);
        await client.connect();
        collection = client.db(dbName).collection('posts');
        original = await collection.findOne({ _id: new ObjectId(post.id) });
        replace = (value) =>
          collection.replaceOne({ _id: original._id }, { ...value, _id: original._id });
      }

      const raw = name === 'SQLite' ? JSON.parse(original) : original;

      for (const change of [
        { status: 'unknown' },
        { tags: 'tag' },
        { text: 42 },
        { links: { related: 'bad' } },
        { links: {} },
        { links: undefined },
        { title: undefined }
      ]) {
        try {
          await replace({ ...raw, ...change });

          await assert.rejects(blog.find(post.id), { code: 'YAMB_STORAGE_READ' });
          await assert.rejects(blog.render('json', { posts: blog.all() }), {
            code: 'YAMB_STORAGE_READ'
          });
        } finally {
          await replace(raw);
        }
      }

      const options = JSON.parse('{"__proto__":true}');
      assert.throws(() => blog.all({ options }), { code: 'YAMB_QUERY_VALIDATION' });
      await assert.rejects(async () => Array.fromAsync(storage.all({ options })), {
        code: 'YAMB_QUERY_VALIDATION'
      });
      await assert.rejects(async () => storage.count({ options }), {
        code: 'YAMB_QUERY_VALIDATION'
      });

      const stored = await blog.find(post.id);
      assert.equal(stored.title, 'Corruption boundary');
    } finally {
      await blog.close();
      db?.close();
      await client?.close();
    }
  });
}
