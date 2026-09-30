/*
 * RTEC PHC Field Reporting — shared decision logic.
 *
 * These are the same rules as the playbook's Power Fx visibility formulas
 * and the flow's arborist-routing expression (sections 3 and 5 of the
 * build playbook), reimplemented as plain functions so the wizard UI and
 * the PDF generator apply exactly one definition of each rule.
 */
(function () {
  'use strict';

  /**
   * Mirrors conArboristNotice / the flow's arborist-routing expression:
   *   (VisitType = "Targeted Treatment" AND (pressingIssue OR arboristRequestedPhotos))
   *   OR any finding has ArboristReviewRequired = true
   */
  function requiresArboristNotice(visit, findings) {
    const exceptionOnTargeted =
      visit.visitType === 'Targeted Treatment' &&
      (Boolean(visit.pressingIssueObserved) || Boolean(visit.arboristRequestedPhotos));
    const findingFlagged = (findings || []).some((f) => f.arboristReviewRequired);
    return exceptionOnTargeted || findingFlagged;
  }

  /** Mirrors lblPageOutput. */
  function outputLabel(findings) {
    return (findings || []).length === 0 ? 'Page 1 only' : 'Page 1 plus finding pages';
  }

  /**
   * The report identifier shown on-screen and printed on the report:
   * "<SingleOps Visit ID> PHCI Report". Computed on demand rather than
   * stored, so it can't go stale if the SingleOps Visit ID is corrected
   * after the visit was first created.
   */
  function reportId(visit) {
    const soId = ((visit && visit.singleOpsVisitId) || '').trim();
    return soId ? `${soId} PHCI Report` : 'PHCI Report';
  }

  /**
   * Whether the finding/photo entry point is offered. The original
   * playbook's btnAddFinding.Visible formula gated this on visit type and
   * the pressing-issue/arborist-requested-photos flags; on request, photo
   * capture is now always available regardless of visit type, including a
   * routine Targeted Treatment visit with neither flag set.
   */
  function canAddFinding() {
    return true;
  }

  // ---------------------------------------------------------------------
  // Validation — mirrors frmVisitStart.Valid / frmWork.Valid / the finding
  // Patch() guard clause in the playbook.
  // ---------------------------------------------------------------------

  function validateVisitStart(visit) {
    const errors = [];
    if (!visit.singleOpsVisitId || !visit.singleOpsVisitId.trim()) errors.push('SingleOps Visit ID is required.');
    if (!visit.visitType) errors.push('Visit type is required.');
    if (!visit.clientName || !visit.clientName.trim()) errors.push('Client name is required.');
    if (!visit.propertyAddress || !visit.propertyAddress.trim()) errors.push('Property address is required.');
    if (!visit.technician || !visit.technician.trim()) errors.push('Technician is required.');
    if (!visit.visitDateTime) errors.push('Visit date/time is required.');
    return { valid: errors.length === 0, errors };
  }

  function validateWorkPerformed(visit) {
    const errors = [];
    if (!visit.servicesPerformed || visit.servicesPerformed.length === 0) {
      errors.push('At least one service performed is required.');
    }
    if (!visit.plantEntries || visit.plantEntries.length === 0) {
      errors.push('At least one Plant / Area entry is required.');
    }
    if (!visit.treatmentDetails || !visit.treatmentDetails.trim()) errors.push('Treatment details are required.');
    return { valid: errors.length === 0, errors };
  }

  /** One Plant/Area + its Ornamental Pests/Conditions — the only required part is the name. */
  function validatePlantEntry(entry) {
    const errors = [];
    if (!entry.plantArea || !entry.plantArea.trim()) errors.push('Plant or area is required.');
    return { valid: errors.length === 0, errors };
  }

  /** Mirrors the finding Patch() guard: "Add a photo, plant or area, and observation." */
  function validateFinding(finding) {
    const errors = [];
    if (!finding.photoBlob) errors.push('A photo is required.');
    if (!finding.plantArea || !finding.plantArea.trim()) errors.push('Plant or area is required.');
    if (!finding.observation || !finding.observation.trim()) errors.push('Observation is required.');
    return { valid: errors.length === 0, errors };
  }

  window.PhcLogic = {
    requiresArboristNotice,
    outputLabel,
    reportId,
    canAddFinding,
    validateVisitStart,
    validateWorkPerformed,
    validatePlantEntry,
    validateFinding,
  };
})();
