/*
 * RTEC PHC Field Reporting — wizard UI.
 *
 * Plain DOM/vanilla JS, no framework, no build step — the whole app is
 * just files a browser can open directly. Screens are <section
 * data-screen="…"> blocks in index.html, shown one at a time.
 */
(function () {
  'use strict';

  const cfg = window.PHC_CONFIG;
  const Db = window.PhcDb;
  const Logic = window.PhcLogic;
  const Report = window.PhcReport;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    visitId: null,
    editingFindingId: null,
    lastPdfBytes: null,
    lastPdfFilename: null,
  };

  // -----------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------

  function show(screenName) {
    $all('.screen').forEach((el) => {
      el.hidden = el.getAttribute('data-screen') !== screenName;
    });
    window.scrollTo(0, 0);
  }

  async function goHome() {
    state.visitId = null;
    state.editingFindingId = null;
    await renderVisitList();
    show('home');
  }

  // -----------------------------------------------------------------
  // Home
  // -----------------------------------------------------------------

  function fmtShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function renderVisitList() {
    const visits = await Db.listVisits();
    const list = $('#visitList');
    const empty = $('#visitListEmpty');
    list.innerHTML = '';
    empty.hidden = visits.length > 0;

    visits.forEach((visit) => {
      const li = document.createElement('li');
      li.className = 'visit-row';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'visit-row__main';
      main.innerHTML = `
        <span class="visit-row__title">${escapeHtml(visit.clientName || '(no client name)')}</span>
        <span class="visit-row__meta">${escapeHtml(Logic.reportId(visit))} · ${escapeHtml(visit.visitType || '—')}</span>
        <span class="visit-row__meta">${escapeHtml(fmtShort(visit.visitDateTime))} · ${escapeHtml(visit.status)}</span>
      `;
      main.addEventListener('click', () => openVisit(visit.id));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'visit-row__delete';
      del.setAttribute('aria-label', 'Delete visit');
      del.textContent = '✕';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete visit for ${visit.clientName || 'this property'}? This cannot be undone.`)) {
          await Db.deleteVisit(visit.id);
          await renderVisitList();
        }
      });

      li.appendChild(main);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  async function openVisit(id) {
    const visit = await Db.getVisit(id);
    if (!visit) return;
    state.visitId = id;

    if (visit.status === 'Submitted') {
      const findings = await Db.listFindings(id);
      await buildAndShowReport(visit, findings);
      return;
    }

    fillVisitStartForm(visit);
    fillWorkForm(visit);
    show('work');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // -----------------------------------------------------------------
  // Screen: Visit Start
  // -----------------------------------------------------------------

  function toLocalDateTimeInputValue(iso) {
    const d = iso ? new Date(iso) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fillVisitStartForm(visit) {
    const form = $('#formVisitStart');
    form.singleOpsVisitId.value = visit.singleOpsVisitId || '';
    form.visitType.value = visit.visitType || '';
    form.clientName.value = visit.clientName || '';
    form.propertyAddress.value = visit.propertyAddress || '';
    form.technician.value = visit.technician || '';
    form.visitDateTime.value = toLocalDateTimeInputValue(visit.visitDateTime);
  }

  function readVisitStartForm() {
    const form = $('#formVisitStart');
    const local = form.visitDateTime.value; // 'YYYY-MM-DDTHH:mm', local time
    return {
      singleOpsVisitId: form.singleOpsVisitId.value.trim(),
      visitType: form.visitType.value,
      clientName: form.clientName.value.trim(),
      propertyAddress: form.propertyAddress.value.trim(),
      technician: form.technician.value.trim(),
      visitDateTime: local ? new Date(local).toISOString() : new Date().toISOString(),
    };
  }

  function showErrors(elId, errors) {
    const el = $(elId);
    if (!errors || errors.length === 0) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = errors.map((e) => escapeHtml(e)).join('<br>');
  }

  $('#formVisitStart').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readVisitStartForm();
    const { valid, errors } = Logic.validateVisitStart(data);
    if (!valid) {
      showErrors('#errorsVisitStart', errors);
      return;
    }
    showErrors('#errorsVisitStart', []);

    const visit = state.visitId
      ? await Db.updateVisit(state.visitId, data)
      : await Db.createVisit(data);
    state.visitId = visit.id;

    fillWorkForm(visit);
    show('work');
  });

  // -----------------------------------------------------------------
  // Screen: Work Performed
  // -----------------------------------------------------------------

  function renderChecklist(containerSel, name, options, selected) {
    const container = $(containerSel);
    container.innerHTML = '';
    const chosen = new Set(selected || []);
    options.forEach((option) => {
      const label = document.createElement('label');
      label.className = 'checklist__item';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = name;
      input.value = option;
      input.checked = chosen.has(option);
      label.appendChild(input);
      label.appendChild(document.createTextNode(` ${option}`));
      container.appendChild(label);
    });
  }

  function newLocalId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function conditionsSummary(entry) {
    const parts = [];
    if (entry.conditions && entry.conditions.length) parts.push(entry.conditions.join(', '));
    if (entry.otherSpecify && entry.otherSpecify.trim()) parts.push(entry.otherSpecify.trim());
    return parts.join(' — ') || 'No conditions noted';
  }

  function renderPlantEntriesGallery(entries) {
    const list = $('#plantEntriesGallery');
    list.innerHTML = '';
    (entries || []).forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'plant-entry-card';

      const body = document.createElement('div');
      body.className = 'plant-entry-card__body';
      body.innerHTML = `
        <span class="plant-entry-card__title">${escapeHtml(entry.plantArea)}</span>
        <span class="hint">${escapeHtml(conditionsSummary(entry))}</span>
      `;

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'plant-entry-card__edit';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => openPlantEntryEditor(entry));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'plant-entry-card__delete';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete plant/area entry');
      del.addEventListener('click', async () => {
        const visit = await Db.getVisit(state.visitId);
        const remaining = (visit.plantEntries || []).filter((e) => e.id !== entry.id);
        const updated = await Db.updateVisit(state.visitId, { plantEntries: remaining });
        renderPlantEntriesGallery(updated.plantEntries);
      });

      li.appendChild(body);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function fillWorkForm(visit) {
    const form = $('#formWork');
    renderChecklist('#servicesChecklist', 'servicesPerformed', cfg.servicesPerformed, visit.servicesPerformed);
    renderPlantEntriesGallery(visit.plantEntries);
    form.treatmentDetails.value = visit.treatmentDetails || '';
    form.followUpNotes.value = visit.followUpNotes || '';
  }

  function readWorkForm() {
    const form = $('#formWork');
    return {
      servicesPerformed: $all('input[name="servicesPerformed"]:checked', form).map((i) => i.value),
      treatmentDetails: form.treatmentDetails.value.trim(),
      followUpNotes: form.followUpNotes.value.trim(),
    };
  }

  $('#formWork').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readWorkForm();
    const currentVisit = await Db.getVisit(state.visitId);
    const { valid, errors } = Logic.validateWorkPerformed(Object.assign({}, data, { plantEntries: currentVisit.plantEntries }));
    if (!valid) {
      showErrors('#errorsWork', errors);
      return;
    }
    showErrors('#errorsWork', []);

    const visit = await Db.updateVisit(state.visitId, data);
    await renderDecisionScreen(visit);
    show('decision');
  });

  // -----------------------------------------------------------------
  // Screen: Plant / Area entry (one plant/area + its conditions at a time)
  // -----------------------------------------------------------------

  let editingPlantEntryId = null;

  function openPlantEntryEditor(entry) {
    editingPlantEntryId = entry ? entry.id : null;
    $('#plantEntryScreenTitle').textContent = entry ? 'Edit Plant / Area' : 'Add Plant / Area';

    const form = $('#formPlantEntry');
    form.reset();
    showErrors('#errorsPlantEntry', []);
    renderChecklist('#entryPestsChecklist', 'entryConditions', cfg.ornamentalPestsConditions, entry ? entry.conditions : []);

    if (entry) {
      form.plantArea.value = entry.plantArea || '';
      form.otherSpecify.value = entry.otherSpecify || '';
    }

    show('plant-entry');
  }

  $('#btnAddPlantEntry').addEventListener('click', () => openPlantEntryEditor(null));

  $('#formPlantEntry').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = $('#formPlantEntry');

    const candidate = {
      id: editingPlantEntryId || newLocalId(),
      plantArea: form.plantArea.value.trim(),
      conditions: $all('input[name="entryConditions"]:checked', form).map((i) => i.value),
      otherSpecify: form.otherSpecify.value.trim(),
    };

    const { valid, errors } = Logic.validatePlantEntry(candidate);
    if (!valid) {
      showErrors('#errorsPlantEntry', errors);
      return;
    }
    showErrors('#errorsPlantEntry', []);

    const visit = await Db.getVisit(state.visitId);
    const entries = visit.plantEntries || [];
    const index = entries.findIndex((en) => en.id === candidate.id);
    const nextEntries = index >= 0 ? entries.map((en, i) => (i === index ? candidate : en)) : entries.concat(candidate);

    const updated = await Db.updateVisit(state.visitId, { plantEntries: nextEntries });
    renderPlantEntriesGallery(updated.plantEntries);
    show('work');
  });

  // -----------------------------------------------------------------
  // Screen: Decision (findings entry point)
  // -----------------------------------------------------------------

  function findingThumbUrl(finding) {
    if (!finding.photoBlob) return '';
    return URL.createObjectURL(finding.photoBlob);
  }

  function renderFindingsGallery(listEl, findings, { editable }) {
    listEl.innerHTML = '';
    findings.forEach((finding) => {
      const li = document.createElement('li');
      li.className = 'finding-card';

      const img = document.createElement('img');
      img.className = 'finding-card__thumb';
      img.alt = finding.plantArea || 'Finding photo';
      const url = findingThumbUrl(finding);
      if (url) img.src = url;

      const body = document.createElement('div');
      body.className = 'finding-card__body';
      body.innerHTML = `
        <strong>#${finding.sequence} — ${escapeHtml(finding.plantArea || '(no plant/area)')}</strong>
        <span>${escapeHtml(finding.priority || 'Routine')}${finding.arboristReviewRequired ? ' · Arborist review' : ''}</span>
        <span class="hint">${escapeHtml((finding.observation || '').slice(0, 90))}</span>
      `;

      li.appendChild(img);
      li.appendChild(body);

      if (editable) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'finding-card__edit';
        edit.textContent = 'Edit';
        edit.addEventListener('click', () => openFindingEditor(finding));
        li.appendChild(edit);
      }

      listEl.appendChild(li);
    });
  }

  async function renderDecisionScreen(visit) {
    const findings = await Db.listFindings(visit.id);

    $('#targetedQuestions').hidden = visit.visitType !== 'Targeted Treatment';
    $('#togPressingIssue').checked = Boolean(visit.pressingIssueObserved);
    $('#togArboristRequested').checked = Boolean(visit.arboristRequestedPhotos);

    $('#lblPageOutput').textContent = `Output: ${Logic.outputLabel(findings)}`;
    $('#arboristNotice').hidden = !Logic.requiresArboristNotice(visit, findings);
    $('#btnAddFinding').hidden = !Logic.canAddFinding(visit);

    renderFindingsGallery($('#findingsGallery'), findings, { editable: true });
  }

  async function refreshDecisionScreen() {
    const visit = await Db.getVisit(state.visitId);
    await renderDecisionScreen(visit);
  }

  $('#togPressingIssue').addEventListener('change', async (e) => {
    await Db.updateVisit(state.visitId, { pressingIssueObserved: e.target.checked });
    await refreshDecisionScreen();
  });

  $('#togArboristRequested').addEventListener('change', async (e) => {
    await Db.updateVisit(state.visitId, { arboristRequestedPhotos: e.target.checked });
    await refreshDecisionScreen();
  });

  $('#btnAddFinding').addEventListener('click', () => openFindingEditor(null));

  $('#btnGoReview').addEventListener('click', async () => {
    await renderReviewScreen();
    show('review');
  });

  // -----------------------------------------------------------------
  // Screen: Finding editor
  // -----------------------------------------------------------------

  let pendingPhoto = null; // { blob, type } chosen but not yet saved

  function openFindingEditor(finding) {
    state.editingFindingId = finding ? finding.id : null;
    pendingPhoto = null;

    const form = $('#formFinding');
    form.reset();
    showErrors('#errorsFinding', []);

    const preview = $('#findingPhotoPreview');
    preview.hidden = true;
    preview.removeAttribute('src');

    $('#findingScreenTitle').textContent = finding ? 'Edit Finding' : 'Add Finding';

    if (finding) {
      form.plantArea.value = finding.plantArea || '';
      form.location.value = finding.location || '';
      form.observation.value = finding.observation || '';
      form.recommendation.value = finding.recommendation || '';
      form.priority.value = finding.priority || 'Routine';
      form.arboristReviewRequired.checked = Boolean(finding.arboristReviewRequired);
      if (finding.photoBlob) {
        preview.src = URL.createObjectURL(finding.photoBlob);
        preview.hidden = false;
      }
    }

    show('finding');
  }

  $('#findingPhotoInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    pendingPhoto = { blob: file, type: file.type };
    const preview = $('#findingPhotoPreview');
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
  });

  $('#formFinding').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = $('#formFinding');

    const existing = state.editingFindingId ? await getFindingById(state.editingFindingId) : null;

    const patch = {
      plantArea: form.plantArea.value.trim(),
      location: form.location.value.trim(),
      observation: form.observation.value.trim(),
      recommendation: form.recommendation.value.trim(),
      priority: form.priority.value,
      arboristReviewRequired: form.arboristReviewRequired.checked,
    };
    if (pendingPhoto) {
      patch.photoBlob = pendingPhoto.blob;
      patch.photoType = pendingPhoto.type;
    }

    const effective = Object.assign({}, existing, patch);
    const { valid, errors } = Logic.validateFinding(effective);
    if (!valid) {
      showErrors('#errorsFinding', errors);
      return;
    }
    showErrors('#errorsFinding', []);

    if (state.editingFindingId) {
      await Db.updateFinding(state.editingFindingId, patch);
    } else {
      await Db.createFinding(state.visitId, patch);
    }

    await refreshDecisionScreen();
    show('decision');
  });

  async function getFindingById(id) {
    const findings = await Db.listFindings(state.visitId);
    return findings.find((f) => f.id === id) || null;
  }

  // -----------------------------------------------------------------
  // Screen: Review & Submit
  // -----------------------------------------------------------------

  async function renderReviewScreen() {
    const visit = await Db.getVisit(state.visitId);
    const findings = await Db.listFindings(state.visitId);

    $('#reviewSummary').innerHTML = `
      <dl>
        <dt>Report ID</dt><dd>${escapeHtml(Logic.reportId(visit))}</dd>
        <dt>Visit Type</dt><dd>${escapeHtml(visit.visitType)}</dd>
        <dt>SingleOps Visit ID</dt><dd>${escapeHtml(visit.singleOpsVisitId)}</dd>
        <dt>Client</dt><dd>${escapeHtml(visit.clientName)}</dd>
        <dt>Property</dt><dd>${escapeHtml(visit.propertyAddress)}</dd>
        <dt>Technician</dt><dd>${escapeHtml(visit.technician)}</dd>
        <dt>Visit Date/Time</dt><dd>${escapeHtml(fmtShort(visit.visitDateTime))}</dd>
        <dt>Services</dt><dd>${escapeHtml((visit.servicesPerformed || []).join(', ') || '—')}</dd>
        <dt>Plants / Areas</dt><dd>${(visit.plantEntries || []).length === 0 ? '—' : (visit.plantEntries || []).map((e) => `${escapeHtml(e.plantArea)}: ${escapeHtml(conditionsSummary(e))}`).join('<br>')}</dd>
        <dt>Output</dt><dd>${escapeHtml(Logic.outputLabel(findings))}</dd>
      </dl>
    `;

    $('#reviewArboristNotice').hidden = !Logic.requiresArboristNotice(visit, findings);
    renderFindingsGallery($('#reviewFindingsGallery'), findings, { editable: false });
  }

  $('#btnSubmitVisit').addEventListener('click', async () => {
    const visit = await Db.getVisit(state.visitId);
    const findings = await Db.listFindings(state.visitId);

    const startCheck = Logic.validateVisitStart(visit);
    const workCheck = Logic.validateWorkPerformed(visit);
    const allErrors = startCheck.errors.concat(workCheck.errors);
    if (allErrors.length > 0) {
      showErrors('#errorsReview', allErrors);
      return;
    }
    showErrors('#errorsReview', []);

    const submitted = await Db.updateVisit(state.visitId, {
      status: 'Submitted',
      submittedOn: new Date().toISOString(),
    });

    await buildAndShowReport(submitted, findings);
  });

  // -----------------------------------------------------------------
  // Screen: Report
  // -----------------------------------------------------------------

  async function buildAndShowReport(visit, findings) {
    const bytes = await Report.generateReportPdf(visit, findings);
    state.lastPdfBytes = bytes;
    state.lastPdfFilename = Report.reportFilename(visit);

    $('#reportMeta').innerHTML = `
      <dl>
        <dt>Report ID</dt><dd>${escapeHtml(Logic.reportId(visit))}</dd>
        <dt>File name</dt><dd>${escapeHtml(state.lastPdfFilename)}</dd>
        <dt>Output</dt><dd>${escapeHtml(Logic.outputLabel(findings))}</dd>
        <dt>Arborist routing</dt><dd>${Logic.requiresArboristNotice(visit, findings) ? 'Required — route a copy' : 'Not required'}</dd>
      </dl>
    `;

    const canShareFiles = Boolean(
      navigator.canShare && navigator.share && navigator.canShare({ files: [new File([bytes], state.lastPdfFilename, { type: 'application/pdf' })] })
    );
    $('#btnSharePdf').hidden = !canShareFiles;
    $('#btnSaveFallback').hidden = canShareFiles;

    show('report');
  }

  $('#btnSharePdf').addEventListener('click', async () => {
    try {
      const file = new File([state.lastPdfBytes], state.lastPdfFilename, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: state.lastPdfFilename });
    } catch (err) {
      if (err && err.name !== 'AbortError') {
        console.error('Share failed', err);
        alert('Sharing failed. Use "Download PDF" instead and save it from there.');
      }
    }
  });

  $('#btnSaveFallback').addEventListener('click', () => {
    const blob = new Blob([state.lastPdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.lastPdfFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  // -----------------------------------------------------------------
  // Global nav wiring, network badge, init
  // -----------------------------------------------------------------

  $all('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-nav');
      if (target === 'home') goHome();
      else show(target);
    });
  });

  $('#btnHome').addEventListener('click', goHome);

  $('#btnNewVisit').addEventListener('click', () => {
    state.visitId = null;
    $('#formVisitStart').reset();
    $('#formVisitStart').visitDateTime.value = toLocalDateTimeInputValue(null);
    showErrors('#errorsVisitStart', []);
    show('visit-start');
  });

  function updateNetBadge() {
    const badge = $('#netBadge');
    badge.textContent = navigator.onLine ? 'Online' : 'Working offline';
    badge.classList.toggle('net-badge--offline', !navigator.onLine);
  }
  window.addEventListener('online', updateNetBadge);
  window.addEventListener('offline', updateNetBadge);

  // -----------------------------------------------------------------
  // Update banner — a field tech can leave this app running/suspended
  // for days (it's built to work fully offline), which silently skips
  // past a bumped sw.js CACHE_VERSION: the browser only checks for a new
  // service worker on a fresh navigation, and that check doesn't force
  // the already-loaded page to pick up new JS by itself. Surfacing this
  // explicitly, rather than relying on "just relaunch it," is what a
  // past round of fixes (which never reached the field for exactly this
  // reason) was missing.
  function showUpdateBanner() {
    $('#updateBanner').hidden = false;
  }

  $('#btnUpdateDismiss').addEventListener('click', () => {
    $('#updateBanner').hidden = true;
  });

  $('#btnUpdateReload').addEventListener('click', () => {
    window.location.reload();
  });

  function watchForServiceWorkerUpdate(registration) {
    // A worker only reaches "installed" while something is already
    // controlling this page if it's a genuine update — on a first-ever
    // install there's no controller yet, so that case never shows the
    // banner.
    const hadController = Boolean(navigator.serviceWorker.controller);
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (hadController && newWorker.state === 'installed') {
          showUpdateBanner();
        }
      });
    });
  }

  async function init() {
    updateNetBadge();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('sw.js')
        .then((registration) => {
          watchForServiceWorkerUpdate(registration);
          // Covers the tech having left the app open/suspended since
          // before the update: check for a waiting service worker right
          // now too, not just on the next natural registration event.
          if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner();
        })
        .catch((err) => console.warn('Service worker registration failed', err));
    }
    await goHome();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Exposed for the offline smoke-test harness only.
  window.__PHC_APP__ = { state };
})();
