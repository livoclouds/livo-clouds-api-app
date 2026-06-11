// ENGINE-002/ENGINE-004 — shared staleness threshold: a PROCESSING batch whose
// updatedAt is older than this is considered stalled (the in-process
// setImmediate classification runner crashed or the process died). Used by
// imports remove()'s deletability guard, the ImportsMaintenanceCron reaper,
// and reclassifyBatch's in-flight guard. Lives in its own module so the
// classification service can import it without a circular file dependency.
export const STALE_PROCESSING_MS = 30 * 60 * 1000;

// ENGINE-048 — PENDING batches with a retained file but no transactions older
// than this are abandoned uploads (preview/confirm never happened); the orphan
// sweep deletes the R2 object and the batch row.
export const ABANDONED_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
