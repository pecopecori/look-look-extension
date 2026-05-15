(function () {
  const DB_NAME = 'meeting-extension-db';
  const DB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
          chunks.createIndex('meetingId', 'meetingId', { unique: false });
          chunks.createIndex('meetingId_source', ['meetingId', 'sourceLabel'], { unique: false });
        }
        if (!db.objectStoreNames.contains('artifacts')) {
          db.createObjectStore('artifacts', { keyPath: 'meetingId' });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let settled = false;
      tx.oncomplete = () => {
        if (!settled) resolve(undefined);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      Promise.resolve(fn(store, tx))
        .then((result) => {
          settled = true;
          resolve(result);
        })
        .catch(reject);
    }).finally(() => db.close());
  }

  async function putChunk(chunk) {
    await withStore('chunks', 'readwrite', (store) => store.put(chunk));
    return chunk;
  }

  async function listMeetingChunks(meetingId) {
    return await withStore('chunks', 'readonly', (store) => new Promise((resolve, reject) => {
      const index = store.index('meetingId');
      const request = index.getAll(IDBKeyRange.only(meetingId));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  async function listMeetingChunksBySource(meetingId, sourceLabel) {
    return await withStore('chunks', 'readonly', (store) => new Promise((resolve, reject) => {
      const index = store.index('meetingId_source');
      const request = index.getAll(IDBKeyRange.only([meetingId, sourceLabel]));
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  async function deleteMeetingChunks(meetingId) {
    const chunks = await listMeetingChunks(meetingId);
    await withStore('chunks', 'readwrite', (store) => {
      chunks.forEach((chunk) => store.delete(chunk.id));
    });
  }

  async function getArtifact(meetingId) {
    return await withStore('artifacts', 'readonly', (store) => new Promise((resolve, reject) => {
      const request = store.get(meetingId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  async function saveArtifact(meetingId, patch) {
    const current = (await getArtifact(meetingId)) || {
      meetingId,
      transcriptText: '',
      transcriptSegments: [],
      failedChunks: [],
      minutesJson: null,
      updatedAt: new Date().toISOString(),
    };
    const next = {
      ...current,
      ...(patch || {}),
      updatedAt: new Date().toISOString(),
    };
    await withStore('artifacts', 'readwrite', (store) => store.put(next));
    return next;
  }

  async function clearMeetingData(meetingId) {
    await deleteMeetingChunks(meetingId);
    await withStore('artifacts', 'readwrite', (store) => store.delete(meetingId));
  }

  globalThis.MeetingExtDB = {
    clearMeetingData,
    deleteMeetingChunks,
    getArtifact,
    listMeetingChunks,
    listMeetingChunksBySource,
    putChunk,
    saveArtifact,
  };
})();
