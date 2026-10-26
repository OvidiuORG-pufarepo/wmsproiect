CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) NOT NULL,
  parent_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  barcode VARCHAR(64) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(64) UNIQUE NOT NULL,
  barcode VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit_of_measure VARCHAR(16) NOT NULL DEFAULT 'EA',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  movement_type VARCHAR(64) NOT NULL,
  item_id UUID NOT NULL REFERENCES items(id),
  from_location_id UUID NOT NULL REFERENCES locations(id),
  to_location_id UUID NOT NULL REFERENCES locations(id),
  quantity NUMERIC(12, 4) NOT NULL CHECK (quantity > 0),
  reference_doc VARCHAR(128),
  performed_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_item ON inventory_ledger(item_id);
CREATE INDEX IF NOT EXISTS idx_ledger_from_loc ON inventory_ledger(from_location_id);
CREATE INDEX IF NOT EXISTS idx_ledger_to_loc ON inventory_ledger(to_location_id);

CREATE OR REPLACE VIEW view_inventory_balances AS
WITH debits AS (
  SELECT item_id, to_location_id AS location_id, SUM(quantity) AS qty
  FROM inventory_ledger
  GROUP BY item_id, to_location_id
),
credits AS (
  SELECT item_id, from_location_id AS location_id, SUM(quantity) AS qty
  FROM inventory_ledger
  GROUP BY item_id, from_location_id
)
SELECT 
  COALESCE(d.item_id, c.item_id) AS item_id,
  COALESCE(d.location_id, c.location_id) AS location_id,
  (COALESCE(d.qty, 0) - COALESCE(c.qty, 0)) AS on_hand_qty
FROM debits d
FULL OUTER JOIN credits c 
  ON d.item_id = c.item_id AND d.location_id = c.location_id;
