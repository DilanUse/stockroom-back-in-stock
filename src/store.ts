import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type StockCheck = { id: string; sku: string; attempts: number };
export type Delivery = { id: string; email: string; sku: string; attempts: number };
export type Alert = {
  email: string;
  sku: string;
  created_at: number;
  queued_at: number | null;
  notified_at: number | null;
  delivery_error: string | null;
};

const nextAttempt = (attempts: number) => Date.now() + Math.min(30_000, 750 * 2 ** Math.min(attempts, 6));

export function openStore(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, sku TEXT NOT NULL, created_at INTEGER NOT NULL,
      queued_at INTEGER, notified_at INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, delivery_error TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_alert ON alerts(email, sku) WHERE notified_at IS NULL;
    CREATE INDEX IF NOT EXISTS alerts_by_sku ON alerts(sku) WHERE notified_at IS NULL;
    CREATE INDEX IF NOT EXISTS pending_deliveries ON alerts(next_attempt)
      WHERE queued_at IS NOT NULL AND notified_at IS NULL;
    CREATE TABLE IF NOT EXISTS stock_checks (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL, processed_at INTEGER,
      next_attempt INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS pending_stock_checks ON stock_checks(next_attempt) WHERE processed_at IS NULL;
  `);

  const addCheck = db.prepare('INSERT INTO stock_checks(id, sku) VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
  const addAlert = db.prepare(`
    INSERT INTO alerts(id, email, sku, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email, sku) WHERE notified_at IS NULL DO NOTHING
  `);
  const readyChecks = db.prepare(`
    SELECT id, sku, attempts FROM stock_checks WHERE processed_at IS NULL AND next_attempt <= ?
    ORDER BY next_attempt, rowid LIMIT 25
  `);
  const finishCheck = db.prepare('UPDATE stock_checks SET processed_at = ? WHERE id = ?');
  const queueAlerts = db.prepare(`
    UPDATE alerts SET queued_at = ? WHERE sku = ? AND queued_at IS NULL AND notified_at IS NULL
  `);
  const retryCheck = db.prepare('UPDATE stock_checks SET attempts = attempts + 1, next_attempt = ? WHERE id = ?');
  const readyDeliveries = db.prepare(`
    SELECT id, email, sku, attempts FROM alerts
    WHERE queued_at IS NOT NULL AND notified_at IS NULL AND next_attempt <= ?
    ORDER BY next_attempt, queued_at, rowid LIMIT 25
  `);
  const markDelivered = db.prepare('UPDATE alerts SET notified_at = ?, delivery_error = NULL WHERE id = ?');
  const retryDelivery = db.prepare(`
    UPDATE alerts SET attempts = attempts + 1, next_attempt = ?, delivery_error = ? WHERE id = ?
  `);
  const listAlerts = db.prepare(`
    SELECT email, sku, created_at, queued_at, notified_at, delivery_error
    FROM alerts ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?
  `);
  const alertsForSku = db.prepare(`
    SELECT email, sku, created_at, queued_at, notified_at, delivery_error
    FROM alerts WHERE sku = ? ORDER BY created_at DESC, rowid DESC LIMIT 12
  `);

  function transaction<T>(operation: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    subscribe(email: string, sku: string) {
      return transaction(() => {
        const id = randomUUID();
        const created = addAlert.run(id, email, sku, Date.now()).changes > 0;
        // Stock may have returned while the customer was filling out the form.
        if (created) addCheck.run(`subscription:${id}`, sku);
        return created;
      });
    },
    recordWebhook(eventId: string, sku: string) {
      return addCheck.run(`webhook:${eventId}`, sku).changes > 0;
    },
    checks() {
      return readyChecks.all(Date.now()) as StockCheck[];
    },
    completeCheck(check: StockCheck, inStock: boolean) {
      transaction(() => {
        const now = Date.now();
        if (inStock) queueAlerts.run(now, check.sku);
        finishCheck.run(now, check.id);
      });
    },
    retryCheck(check: StockCheck) {
      retryCheck.run(nextAttempt(check.attempts), check.id);
    },
    deliveries() {
      return readyDeliveries.all(Date.now()) as Delivery[];
    },
    delivered(delivery: Delivery) {
      markDelivered.run(Date.now(), delivery.id);
    },
    retryDelivery(delivery: Delivery, error: string) {
      retryDelivery.run(nextAttempt(delivery.attempts), error, delivery.id);
    },
    alerts(limit: number, offset: number) {
      return listAlerts.all(limit, offset) as Alert[];
    },
    alertsForSku(sku: string) {
      return alertsForSku.all(sku) as Alert[];
    },
    close() {
      db.close();
    },
  };
}
