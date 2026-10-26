// In-memory Admin SDK test double. Transactions serialize and stage writes so
// tests can exercise competing schedulers without any network or real mail.
const assert = require('node:assert/strict');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const merge = (a, b) => {
  const result = {...a};
  for (const [key, value] of Object.entries(b)) result[key] = plain(value) ? merge(plain(result[key]) ? result[key] : {}, value) : value;
  return result;
};
const comparable = value => typeof value?.toMillis === 'function' ? value.toMillis() : value;

function fakeFirestore(initial = {}) {
  const documents = new Map(Object.entries(initial));
  let tail = Promise.resolve();
  const snapshot = ref => ({id: ref.id, ref, exists: documents.has(ref.path), data: () => documents.get(ref.path), get: key => documents.get(ref.path)?.[key]});
  const doc = path => ({
    path, id: path.split('/').at(-1),
    get: async () => snapshot(doc(path)),
    set: async (data, options) => {documents.set(path, options?.merge ? merge(documents.get(path) || {}, data) : {...data});},
    update: async data => {if (!documents.has(path)) throw Object.assign(new Error('Document missing'), {code: 5}); documents.set(path, merge(documents.get(path), data));},
    delete: async () => {documents.delete(path);},
    collection: name => collection(path + '/' + name),
  });
  const query = (path, filters = [], maximum = Infinity, sort) => ({
    where: (field, operator, value) => query(path, [...filters, {field, operator, value}], maximum, sort),
    limit: size => query(path, filters, size, sort),
    orderBy: field => query(path, filters, maximum, field),
    get: async () => {
      let rows = [...documents].filter(([key]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1);
      for (const {field, operator, value} of filters) rows = rows.filter(([, data]) => {
        const raw = field.split('.').reduce((item, part) => item?.[part], data);
        const actual = comparable(raw), expected = comparable(value);
        if (operator === '==') return actual === expected;
        if (operator === 'in') return value.includes(actual);
        if (operator === '<=') return raw != null && actual <= expected;
        if (operator === '>=') return raw != null && actual >= expected;
        throw new Error('Unsupported operator ' + operator);
      });
      if (sort) rows.sort((a, b) => comparable(a[1][sort]) - comparable(b[1][sort]));
      const docs = rows.slice(0, maximum).map(([path]) => snapshot(doc(path)));
      return {docs, empty: !docs.length, size: docs.length};
    },
  });
  const collection = path => ({...query(path), id: path.split('/').at(-1), doc: id => doc(path + '/' + id)});
  const runTransaction = callback => {
    const promise = tail.then(async () => {
      const writes = [];
      const result = await callback({
        get: ref => {assert.equal(writes.length, 0, 'Firestore reads must precede writes'); return ref.get();},
        set: (ref, data, options) => {writes.push(() => ref.set(data, options));},
        update: (ref, data) => {writes.push(() => ref.update(data));},
        delete: ref => {writes.push(() => ref.delete());},
      });
      for (const write of writes) await write();
      return result;
    });
    tail = promise.catch(() => {});
    return promise;
  };
  const batch = () => {
    const writes = [];
    return {delete: ref => {writes.push(() => ref.delete());}, commit: async () => {for (const write of writes) await write();}};
  };
  const listCollections = async () => [...new Set([...documents.keys()].map(key => key.split('/')[0]))].map(collection);
  const recursiveDelete = async ref => {for (const path of [...documents.keys()]) if (path === ref.path || path.startsWith(ref.path + '/')) documents.delete(path);};
  return {documents, doc, collection, runTransaction, batch, listCollections, recursiveDelete, getAll: (...refs) => Promise.all(refs.map(ref => ref.get()))};
}

function installFakeFirestore(t, initial = {}) {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({projectId: 'demo-lifecycle-tests'});
  const db = admin.firestore();
  const fake = fakeFirestore(initial);
  for (const key of ['doc', 'collection', 'runTransaction', 'getAll', 'batch', 'listCollections', 'recursiveDelete']) {
    const original = db[key]; db[key] = fake[key]; t.after(() => {db[key] = original;});
  }
  return fake;
}
module.exports = {fakeFirestore, installFakeFirestore};
