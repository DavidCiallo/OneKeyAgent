package api

// triggerSyncIfReplica asks this node to push its buffered changes soon.
//
// It is a no-op on the main database (Syncer is nil there), so admin edit
// handlers can call it unconditionally without a guard of their own. Used after
// reference-data edits (model / provider) so a change made on a replica reaches
// the main database promptly rather than waiting for the next interval.
//
// Nothing here causes duplicate rows: flushing is idempotent and a put is an
// upsert on the main side, and TriggerPush coalesces bursts into one flush.
func (a *App) triggerSyncIfReplica() {
	if a.Syncer == nil {
		return
	}
	a.Syncer.TriggerPush()
}
