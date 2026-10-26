import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { APP_NAME } from "@wms/shared";
import { initDb, getDb, saveDb } from "./db.js";

const port = Number(process.env.API_PORT ?? 3000);

await initDb();
console.log("SQLite (WASM) schema initialized successfully");

function executeQuery(db: any, sql: string) {
  const res = db.exec(sql);
  if (res.length === 0) return [];
  const columns = res[0].columns;
  return res[0].values.map((val: any[]) => {
    const obj: Record<string, any> = {};
    columns.forEach((col: string, idx: number) => { obj[col] = val[idx]; });
    return obj;
  });
}

function checkCapacity(db: any, locationId: string, additionalUnits: number) {
  const rows = executeQuery(db, `SELECT current_units, max_units, location_code FROM view_location_occupancy WHERE location_id = '${locationId}'`);
  if (rows.length > 0) {
    const { current_units, max_units, location_code } = rows[0];
    if (Number(current_units) + additionalUnits > Number(max_units)) {
      throw new Error(`Bin capacity exceeded for ${location_code}: Current ${current_units} + ${additionalUnits} exceeds limit of ${max_units} units.`);
    }
  }
}

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", app: APP_NAME }));
    return;
  }

  if (req.url === "/api/balances" && req.method === "GET") {
    try {
      const db = await getDb();
      const rows = executeQuery(db, "SELECT * FROM view_inventory_balances ORDER BY location_code ASC");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url === "/api/locations/capacity" && req.method === "GET") {
    try {
      const db = await getDb();
      const rows = executeQuery(db, "SELECT * FROM view_location_occupancy ORDER BY location_code ASC");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url === "/api/items" && req.method === "GET") {
    try {
      const db = await getDb();
      const rows = executeQuery(db, "SELECT * FROM items ORDER BY sku ASC");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url === "/api/locations" && req.method === "GET") {
    try {
      const db = await getDb();
      const rows = executeQuery(db, "SELECT * FROM locations ORDER BY code ASC");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  if (req.url === "/api/ledger" && req.method === "GET") {
    try {
      const db = await getDb();
      const sql = `
        SELECT 
          l.id,
          l.transaction_id,
          l.movement_type,
          l.quantity,
          l.reference_doc,
          l.performed_by,
          l.created_at,
          i.sku AS item_sku,
          i.name AS item_name,
          lf.code AS from_location_code,
          lt.code AS to_location_code
        FROM inventory_ledger l
        JOIN items i ON l.item_id = i.id
        JOIN locations lf ON l.from_location_id = lf.id
        JOIN locations lt ON l.to_location_id = lt.id
        ORDER BY l.created_at DESC
        LIMIT 50;
      `;
      const rows = executeQuery(db, sql);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
      return;
    } catch (err: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // Workflows: Inbound Receiving
  if (req.url === "/api/workflows/inbound-receive" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const db = await getDb();

        checkCapacity(db, payload.destinationLocationId, Number(payload.quantity));

        const locRows = executeQuery(db, "SELECT id FROM locations WHERE code = 'LOC-VIRT-INBOUND'");
        if (locRows.length === 0) throw new Error("Inbound supplier location not configured");
        const inboundLocId = locRows[0].id;

        const id = randomUUID();
        db.run(`
          INSERT INTO inventory_ledger 
            (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
          VALUES 
            (?, ?, 'receive', ?, ?, ?, ?, ?, ?)
        `, [
          id,
          payload.transactionId ?? randomUUID(),
          payload.itemId,
          inboundLocId,
          payload.destinationLocationId,
          payload.quantity,
          payload.poNumber || 'PO-UNKNOWN',
          payload.performedBy ?? 'inbound_receiver'
        ]);
        saveDb();
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "success", id }));
      } catch (err: any) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Workflows: Outbound Dispatch
  if (req.url === "/api/workflows/outbound-dispatch" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const db = await getDb();

        const checkSql = `
          SELECT on_hand_qty 
          FROM view_inventory_balances 
          WHERE item_id = '${payload.itemId}' AND location_id = '${payload.sourceLocationId}'
        `;
        const balRows = executeQuery(db, checkSql);
        const currentOnHand = balRows.length > 0 ? Number(balRows[0].on_hand_qty) : 0;

        if (currentOnHand < Number(payload.quantity)) {
          throw new Error(`Insufficient stock: Location only has ${currentOnHand} on hand.`);
        }

        const locRows = executeQuery(db, "SELECT id FROM locations WHERE code = 'LOC-STAGE-OUT'");
        if (locRows.length === 0) throw new Error("Outbound staging location not configured");
        const stageOutLocId = locRows[0].id;

        const id = randomUUID();
        db.run(`
          INSERT INTO inventory_ledger 
            (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
          VALUES 
            (?, ?, 'ship', ?, ?, ?, ?, ?, ?)
        `, [
          id,
          payload.transactionId ?? randomUUID(),
          payload.itemId,
          payload.sourceLocationId,
          stageOutLocId,
          payload.quantity,
          payload.soNumber || 'SO-UNKNOWN',
          payload.performedBy ?? 'outbound_picker'
        ]);
        saveDb();
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "success", id }));
      } catch (err: any) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Workflows: Cycle Counting & Variance Balancing
  if (req.url === "/api/workflows/cycle-count" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const db = await getDb();

        const checkSql = `
          SELECT on_hand_qty 
          FROM view_inventory_balances 
          WHERE item_id = '${payload.itemId}' AND location_id = '${payload.locationId}'
        `;
        const balRows = executeQuery(db, checkSql);
        const systemQty = balRows.length > 0 ? Number(balRows[0].on_hand_qty) : 0;
        const countedQty = Number(payload.countedQuantity);
        const variance = countedQty - systemQty;

        if (variance === 0) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "verified", message: "Count matches system records exactly. No adjustment required." }));
          return;
        }

        const adjustLocRows = executeQuery(db, "SELECT id FROM locations WHERE code = 'LOC-VIRT-ADJUST'");
        if (adjustLocRows.length === 0) throw new Error("Adjustment virtual location not initialized");
        const adjustLocId = adjustLocRows[0].id;

        const txId = randomUUID();
        const id = randomUUID();

        if (variance > 0) {
          // Found extra stock: Debit physical location from virtual discrepancy
          checkCapacity(db, payload.locationId, variance);
          db.run(`
            INSERT INTO inventory_ledger 
              (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
            VALUES 
              (?, ?, 'cycle_count_adjustment', ?, ?, ?, ?, ?, ?)
          `, [
            id,
            txId,
            payload.itemId,
            adjustLocId,
            payload.locationId,
            variance,
            payload.auditReason || 'AUDIT-SURPLUS',
            payload.performedBy ?? 'cycle_counter'
          ]);
        } else {
          // Missing stock: Credit physical location to virtual discrepancy
          const absVariance = Math.abs(variance);
          db.run(`
            INSERT INTO inventory_ledger 
              (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
            VALUES 
              (?, ?, 'cycle_count_adjustment', ?, ?, ?, ?, ?, ?)
          `, [
            id,
            txId,
            payload.itemId,
            payload.locationId,
            adjustLocId,
            absVariance,
            payload.auditReason || 'AUDIT-SHORTAGE',
            payload.performedBy ?? 'cycle_counter'
          ]);
        }

        saveDb();
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({
          status: "adjusted",
          variance,
          systemQty,
          countedQty,
          transactionId: txId
        }));
      } catch (err: any) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Generic Ledger Movement Fallback
  if (req.url === "/api/ledger" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const db = await getDb();

        checkCapacity(db, payload.toLocationId, Number(payload.quantity));

        const id = randomUUID();
        db.run(`
          INSERT INTO inventory_ledger 
            (id, transaction_id, movement_type, item_id, from_location_id, to_location_id, quantity, reference_doc, performed_by)
          VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          id,
          payload.transactionId ?? randomUUID(),
          payload.movementType,
          payload.itemId,
          payload.fromLocationId,
          payload.toLocationId,
          payload.quantity,
          payload.referenceDoc ?? null,
          payload.performedBy ?? 'system'
        ]);
        saveDb();
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id, ...payload }));
      } catch (err: any) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`${APP_NAME} api listening on http://127.0.0.1:${port}`);
});
