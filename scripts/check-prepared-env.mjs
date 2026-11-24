import { DatabaseSync } from 'node:sqlite';

import { mongodb } from 'yamb-storage-mongo';
import { sqlite } from 'yamb-storage-sqlite';

const path = process.env.YAMB_SQLITE_FIXTURE;

if (!path) {
  throw new Error('YAMB_SQLITE_FIXTURE must point to an existing prepared database');
}

const inspector = new DatabaseSync(path, { readOnly: true });

try {
  const count = inspector.prepare('SELECT count(*) AS n FROM posts').get().n;

  if (count !== 0) {
    throw new Error('Prepared SQLite posts must be empty before integrations');
  }

  console.log({
    database: 'SQLite',
    indexes: inspector
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'posts'")
      .all().length,
    rows: count
  });
} finally {
  inspector.close();
}

const sqliteStorage = sqlite({ path });

try {
  await sqliteStorage.open();
} finally {
  await sqliteStorage.close();
}

const uri = process.env.MONGO_URI;
const db = process.env.YAMB_MONGO_DB;

if (!uri || !db?.startsWith('yamb_test_')) {
  throw new Error(
    'MONGO_URI and YAMB_MONGO_DB must name an existing prepared yamb_test_* database'
  );
}

const mongoStorage = mongodb({ uri, db });

try {
  await mongoStorage.open();
  const count = await mongoStorage.count({});

  if (count !== 0) {
    throw new Error('Prepared Mongo posts must be empty before integrations');
  }

  console.log({
    database: 'MongoDB',
    documents: count,
    structure: 'existing posts and required indexes'
  });
} finally {
  await mongoStorage.close();
}
