/*
 * RTEC PHC Field Reporting — local data layer.
 *
 * Everything lives in IndexedDB, on-device, offline. Mirrors the two
 * SharePoint lists from the original build (PHC Visits / PHC Findings) as
 * two object stores, so the record shapes and field names read the same
 * as the playbook even though there is no SharePoint here.
 *
 * Photos are stored as Blobs directly in the finding record — no separate
 * file system needed, and it travels with IndexedDB backups/exports.
 */
(function () {
  'use strict';

  const DB_NAME = 'phc-field-app';
  const DB_VERSION = 1;

  /** @type {Promise<IDBDatabase>|null} */
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (event) => {
        const db = req.result;

        if (!db.objectStoreNames.contains('visits')) {
          const visits = db.createObjectStore('visits', { keyPath: 'id' });
          visits.createIndex('status', 'status', { unique: false });
          visits.createIndex('visitDateTime', 'visitDateTime', { unique: false });
          visits.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('findings')) {
          const findings = db.createObjectStore('findings', { keyPath: 'id' });
          findings.createIndex('visitId', 'visitId', { unique: false });
          findings.createIndex('visitId_sequence', ['visitId', 'sequence'], { unique: false });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('Database upgrade blocked by another open tab.'));
      };
    });

    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDb().then((db) => db.transaction(storeNames, mode));
  }

  /** Wraps an IDBRequest in a Promise. */
  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function newId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // Fallback for older WebKit without crypto.randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // -------------------------------------------------------------------
  // Visits
  // -------------------------------------------------------------------

  async function createVisit(partial) {
    const now = new Date().toISOString();
    const visit = Object.assign(
      {
        id: newId(),
        // No stored reportId: it's derived on demand from
        // singleOpsVisitId (see phc-logic.js's reportId()) so it can't go
        // stale if that field is corrected after creation.
        singleOpsVisitId: '',
        visitType: '',
        clientName: '',
        propertyAddress: '',
        technician: '',
        visitDateTime: now,
        servicesPerformed: [],
        plantEntries: [], // [{ id, plantArea, conditions: [], otherSpecify }]
        treatmentDetails: '',
        followUpNotes: '',
        pressingIssueObserved: false,
        arboristRequestedPhotos: false,
        status: 'Draft',
        submittedOn: null,
        createdAt: now,
        updatedAt: now,
      },
      partial
    );

    const t = await tx('visits', 'readwrite');
    await reqToPromise(t.objectStore('visits').add(visit));
    return visit;
  }

  async function updateVisit(id, patch) {
    const t = await tx('visits', 'readwrite');
    const store = t.objectStore('visits');
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error(`Visit ${id} not found`);
    const updated = Object.assign({}, existing, patch, { updatedAt: new Date().toISOString() });
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function getVisit(id) {
    const t = await tx('visits', 'readonly');
    return reqToPromise(t.objectStore('visits').get(id));
  }

  async function listVisits() {
    const t = await tx('visits', 'readonly');
    const all = await reqToPromise(t.objectStore('visits').getAll());
    return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async function deleteVisit(id) {
    const findings = await listFindings(id);
    const t = await tx(['visits', 'findings'], 'readwrite');
    t.objectStore('visits').delete(id);
    const findingsStore = t.objectStore('findings');
    findings.forEach((f) => findingsStore.delete(f.id));
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // -------------------------------------------------------------------
  // Findings
  // -------------------------------------------------------------------

  async function createFinding(visitId, partial) {
    const now = new Date().toISOString();
    const existing = await listFindings(visitId);
    const finding = Object.assign(
      {
        id: newId(),
        visitId,
        sequence: existing.length + 1,
        photoBlob: null,
        photoType: '',
        plantArea: '',
        location: '',
        observation: '',
        recommendation: '',
        priority: 'Routine',
        arboristReviewRequired: false,
        createdAt: now,
      },
      partial
    );

    const t = await tx('findings', 'readwrite');
    await reqToPromise(t.objectStore('findings').add(finding));
    return finding;
  }

  async function updateFinding(id, patch) {
    const t = await tx('findings', 'readwrite');
    const store = t.objectStore('findings');
    const existing = await reqToPromise(store.get(id));
    if (!existing) throw new Error(`Finding ${id} not found`);
    const updated = Object.assign({}, existing, patch);
    await reqToPromise(store.put(updated));
    return updated;
  }

  async function deleteFinding(id) {
    const t = await tx('findings', 'readwrite');
    await reqToPromise(t.objectStore('findings').delete(id));
  }

  async function listFindings(visitId) {
    const t = await tx('findings', 'readonly');
    const index = t.objectStore('findings').index('visitId');
    const all = await reqToPromise(index.getAll(visitId));
    return all.sort((a, b) => a.sequence - b.sequence);
  }

  window.PhcDb = {
    createVisit,
    updateVisit,
    getVisit,
    listVisits,
    deleteVisit,
    createFinding,
    updateFinding,
    deleteFinding,
    listFindings,
  };
})();
