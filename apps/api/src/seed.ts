import { randomUUID } from "node:crypto";
import { initDb, saveDb } from "./db.js";

async function seed() {
  const db = await initDb();

  const inboundId = randomUUID();
  const bin1Id = randomUUID();
  const bin2Id = randomUUID();
  const outId = randomUUID();

  db.run(`
    INSERT OR REPLACE INTO locations (id, code, name, type, barcode, aisle, rack, shelf, bin, max_units) VALUES
      (?, 'LOC-VIRT-INBOUND', 'Virtual Supplier Inbound', 'virtual', 'LOC-VIRT-INBOUND', NULL, NULL, NULL, NULL, 999999),
      (?, 'LOC-A1-01', 'Aisle 01 Rack 01 Shelf A Bin 01', 'bin', 'LOC-A1-01', 'A01', 'R01', 'S-A', 'B01', 120),
      (?, 'LOC-A1-02', 'Aisle 01 Rack 01 Shelf A Bin 02', 'bin', 'LOC-A1-02', 'A01', 'R01', 'S-A', 'B02', 100),
      (?, 'LOC-STAGE-OUT', 'Outbound Staging Area', 'virtual', 'LOC-STAGE-OUT', NULL, NULL, NULL, NULL, 999999);
  `, [inboundId, bin1Id, bin2Id, outId]);

  const bearingId = randomUUID();
  const boltId = randomUUID();

  db.run(`
    INSERT OR REPLACE INTO items (id, sku, barcode, name, unit_of_measure) VALUES
      (?, 'SKU-BEARING-608', '012345678901', 'Deep Groove Ball Bearing 608-2RS', 'EA'),
      (?, 'SKU-BOLT-M8-30', '012345678902', 'Hex Cap Bolt M8x30mm Zinc', 'EA');
  `, [bearingId, boltId]);

  const stmtLoc = db.prepare("SELECT id FROM locations WHERE code = 'LOC-VIRT-INBOUND'");
  stmtLoc.step();
  const inboundRow = stmtLoc.getAsObject();
  stmtLoc.free();

  const stmtBin = db.prepare("SELECT id FROM locations WHERE code = 'LOC-A1-01'");
  stmtBin.step();
  const bin1Row = stmtBin.getAsObject();
  stmtBin.free();

  const stmtBearing = db.prepare("SELECT id FROM items WHERE sku = 'SKU-BEARING-608'");
  stmtBearing.step();
  const bearingRow = stmtBearing.getAsObject();
  stmtBearing.free();

  db.run(`
    INSERT INTO inventory_ledger
      (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
    VALUES
      (?, ?, 'receive', ?, ?, ?, 100, 'PO-2026-001', 'system_seed');
  `, [randomUUID(), randomUUID(), bearingRow.id, inboundRow.id, bin1Row.id]);

  saveDb();
  console.log("SQLite (WASM) WMS database updated and seeded successfully.");
}

seed();
