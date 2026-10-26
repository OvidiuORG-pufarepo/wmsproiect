import initSqlJs, { Database } from "sql.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../wms.db");

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();
  if (existsSync(dbPath)) {
    const filebuffer = readFileSync(dbPath);
    dbInstance = new SQL.Database(filebuffer);
  } else {
    dbInstance = new SQL.Database();
  }
  return dbInstance;
}

export function saveDb(): void {
  if (!dbInstance) return;
  const data = dbInstance.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

export async function initDb(): Promise<Database> {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      parent_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      barcode TEXT UNIQUE NOT NULL,
      aisle TEXT,
      rack TEXT,
      shelf TEXT,
      bin TEXT,
      max_units REAL DEFAULT 150,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      barcode TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      unit_of_measure TEXT NOT NULL DEFAULT 'EA',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_ledger (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES items(id),
      from_location_id TEXT NOT NULL REFERENCES locations(id),
      to_location_id TEXT NOT NULL REFERENCES locations(id),
      quantity REAL NOT NULL CHECK (quantity > 0),
      reference_doc TEXT,
      performed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_item ON inventory_ledger(item_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_from_loc ON inventory_ledger(from_location_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_to_loc ON inventory_ledger(to_location_id);

    INSERT OR IGNORE INTO locations (id, code, name, type, barcode, is_active, max_units)
    VALUES ('loc-virt-adjust', 'LOC-VIRT-ADJUST', 'Inventory Discrepancy & Variance Offset', 'virtual', 'LOC-VIRT-ADJUST', 1, 999999);

    DROP VIEW IF EXISTS view_inventory_balances;

    CREATE VIEW view_inventory_balances AS
    WITH debits AS (
      SELECT item_id, to_location_id AS location_id, SUM(quantity) AS qty
      FROM inventory_ledger
      GROUP BY item_id, to_location_id
    ),
    credits AS (
      SELECT item_id, from_location_id AS location_id, SUM(quantity) AS qty
      FROM inventory_ledger
      GROUP BY item_id, from_location_id
    ),
    all_pairs AS (
      SELECT item_id, location_id FROM debits
      UNION
      SELECT item_id, location_id FROM credits
    )
    SELECT 
      p.item_id,
      COALESCE(i.sku, 'UNKNOWN') AS item_sku,
      COALESCE(i.name, 'Unknown Item') AS item_name,
      p.location_id,
      COALESCE(l.code, 'UNKNOWN') AS location_code,
      COALESCE(l.name, 'Unknown Location') AS location_name,
      l.type AS location_type,
      l.aisle,
      l.rack,
      l.shelf,
      l.bin,
      COALESCE(l.max_units, 150) AS max_units,
      (COALESCE(d.qty, 0) - COALESCE(c.qty, 0)) AS on_hand_qty
    FROM all_pairs p
    LEFT JOIN items i ON p.item_id = i.id
    LEFT JOIN locations l ON p.location_id = l.id
    LEFT JOIN debits d ON p.item_id = d.item_id AND p.location_id = d.location_id
    LEFT JOIN credits c ON p.item_id = c.item_id AND p.location_id = c.location_id
    WHERE l.type != 'virtual';

    DROP VIEW IF EXISTS view_location_occupancy;

    CREATE VIEW view_location_occupancy AS
    SELECT 
      l.id AS location_id,
      l.code AS location_code,
      l.name AS location_name,
      l.aisle,
      l.rack,
      l.shelf,
      l.bin,
      COALESCE(l.max_units, 150) AS max_units,
      COALESCE(SUM(b.on_hand_qty), 0) AS current_units,
      ROUND((COALESCE(SUM(b.on_hand_qty), 0) / COALESCE(l.max_units, 150)) * 100, 1) AS occupancy_pct
    FROM locations l
    LEFT JOIN view_inventory_balances b ON l.id = b.location_id
    WHERE l.type != 'virtual'
    GROUP BY l.id;
  `);

  saveDb();
  return db;
}
