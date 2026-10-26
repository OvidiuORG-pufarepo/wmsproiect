import { useEffect, useState } from "react";
import { APP_NAME } from "@wms/shared";

interface Balance {
  item_id: string;
  item_sku: string;
  item_name: string;
  location_id: string;
  location_code: string;
  location_name: string;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  max_units: number;
  on_hand_qty: number;
}

interface LocationOccupancy {
  location_id: string;
  location_code: string;
  location_name: string;
  aisle: string | null;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  max_units: number;
  current_units: number;
  occupancy_pct: number;
}

interface Item {
  id: string;
  sku: string;
  name: string;
}

interface Location {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface LedgerEntry {
  id: string;
  transaction_id: string;
  movement_type: string;
  quantity: number;
  reference_doc: string | null;
  performed_by: string;
  created_at: string;
  item_sku: string;
  item_name: string;
  from_location_code: string;
  to_location_code: string;
}

type WorkflowTab = "transfer" | "inbound" | "outbound" | "cycle_count";

export function App() {
  const [tab, setTab] = useState<WorkflowTab>("transfer");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [occupancy, setOccupancy] = useState<LocationOccupancy[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  // Form states
  const [selectedItemId, setSelectedItemId] = useState("");
  const [fromLocId, setFromLocId] = useState("");
  const [toLocId, setToLocId] = useState("");
  const [auditLocId, setAuditLocId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [countedQty, setCountedQty] = useState(0);
  const [refDoc, setRefDoc] = useState("");
  const [auditReason, setAuditReason] = useState("Routine Floor Count");
  const [message, setMessage] = useState("");

  const loadData = async () => {
    try {
      setFetchError("");
      const [resBal, resOcc, resItems, resLocs, resLedger] = await Promise.all([
        fetch("http://127.0.0.1:3000/api/balances"),
        fetch("http://127.0.0.1:3000/api/locations/capacity"),
        fetch("http://127.0.0.1:3000/api/items"),
        fetch("http://127.0.0.1:3000/api/locations"),
        fetch("http://127.0.0.1:3000/api/ledger"),
      ]);

      const balData = await resBal.json();
      const occData = await resOcc.json();
      const itemData = await resItems.json();
      const locData = await resLocs.json();
      const ledgerData = await resLedger.json();

      setBalances(Array.isArray(balData) ? balData : []);
      setOccupancy(Array.isArray(occData) ? occData : []);
      setItems(Array.isArray(itemData) ? itemData : []);
      setLocations(Array.isArray(locData) ? locData : []);
      setLedgerEntries(Array.isArray(ledgerData) ? ledgerData : []);

      if (Array.isArray(itemData) && itemData.length > 0 && !selectedItemId) {
        setSelectedItemId(itemData[0].id);
      }

      if (Array.isArray(locData)) {
        const physicalLocs = locData.filter((l: Location) => l.type !== "virtual");
        if (physicalLocs.length > 0) {
          if (!fromLocId) setFromLocId(physicalLocs[0].id);
          if (!auditLocId) setAuditLocId(physicalLocs[0].id);
          if (physicalLocs.length > 1 && !toLocId) {
            setToLocId(physicalLocs[1].id);
          } else if (!toLocId) {
            setToLocId(physicalLocs[0].id);
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to load WMS data:", err);
      setFetchError(err.message || "Failed to connect to API backend");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");

    let endpoint = "http://127.0.0.1:3000/api/ledger";
    let bodyPayload: any = {};

    if (tab === "transfer") {
      bodyPayload = {
        transactionId: crypto.randomUUID(),
        movementType: "internal_transfer",
        itemId: selectedItemId,
        fromLocationId: fromLocId,
        toLocationId: toLocId,
        quantity: Number(quantity),
        referenceDoc: refDoc || null,
        performedBy: "terminal_operator",
      };
    } else if (tab === "inbound") {
      endpoint = "http://127.0.0.1:3000/api/workflows/inbound-receive";
      bodyPayload = {
        transactionId: crypto.randomUUID(),
        itemId: selectedItemId,
        destinationLocationId: toLocId,
        quantity: Number(quantity),
        poNumber: refDoc || `PO-${Date.now().toString().slice(-4)}`,
        performedBy: "receiving_dock",
      };
    } else if (tab === "outbound") {
      endpoint = "http://127.0.0.1:3000/api/workflows/outbound-dispatch";
      bodyPayload = {
        transactionId: crypto.randomUUID(),
        itemId: selectedItemId,
        sourceLocationId: fromLocId,
        quantity: Number(quantity),
        soNumber: refDoc || `SO-${Date.now().toString().slice(-4)}`,
        performedBy: "dispatch_dock",
      };
    } else if (tab === "cycle_count") {
      endpoint = "http://127.0.0.1:3000/api/workflows/cycle-count";
      bodyPayload = {
        itemId: selectedItemId,
        locationId: auditLocId,
        countedQuantity: Number(countedQty),
        auditReason: auditReason || "Manual Audit Reconciliation",
        performedBy: "inventory_controller",
      };
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Action execution failed");

      if (tab === "cycle_count") {
        if (resData.status === "verified") {
          setMessage("Audit Verified: Count matches system records exactly.");
        } else {
          setMessage(`Reconciliation Posted: Variance of ${resData.variance > 0 ? "+" : ""}${resData.variance} offset to virtual discrepancy ledger.`);
        }
      } else {
        setMessage(`Workflow executed successfully: ${tab.toUpperCase()}`);
      }

      setRefDoc("");
      loadData();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
  };

  const physicalLocations = Array.isArray(locations) ? locations.filter(l => l.type !== "virtual") : [];

  const currentAuditedBalance = balances.find(
    b => b.item_id === selectedItemId && b.location_id === auditLocId
  )?.on_hand_qty ?? 0;

  const currentVariance = Number(countedQty) - currentAuditedBalance;

  return (
    <div style={{ padding: "2rem", fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif", maxWidth: "1120px", margin: "0 auto", color: "#333" }}>
      <header style={{ marginBottom: "1.5rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.75rem", color: "#0f172a" }}>{APP_NAME}</h1>
        <p style={{ margin: "4px 0 0", color: "#64748b" }}>Double-Entry WMS: Hierarchy, Bin Capacity & Reconciliation</p>
      </header>

      {fetchError && (
        <div style={{ padding: "1rem", background: "#fee2e2", color: "#991b1b", borderRadius: "6px", marginBottom: "1.5rem" }}>
          <strong>API Connection Error:</strong> {fetchError}. Make sure <code>pnpm -r --parallel dev</code> is running.
        </div>
      )}

      {/* LOCATION CAPACITY OVERVIEW */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "0.75rem" }}>Bin Capacity & Location Hierarchy</h2>
        {occupancy.length === 0 ? (
          <p style={{ color: "#64748b" }}>No location occupancy data available.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
            {occupancy.map(loc => {
              const maxUnits = loc.max_units || 150;
              const currentUnits = loc.current_units || 0;
              const pct = loc.occupancy_pct ?? Math.round((currentUnits / maxUnits) * 100);
              const isWarning = pct >= 80;
              const isFull = pct >= 100;
              const barColor = isFull ? "#ef4444" : isWarning ? "#f59e0b" : "#10b981";

              return (
                <div key={loc.location_id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong style={{ fontSize: "1.05rem" }}>{loc.location_code}</strong>
                    <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Max: {maxUnits}</span>
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "#64748b", margin: "4px 0 10px" }}>
                    Aisle: {loc.aisle || "—"} | Rack: {loc.rack || "—"} | Shelf: {loc.shelf || "—"} | Bin: {loc.bin || "—"}
                  </div>

                  <div style={{ background: "#e2e8f0", borderRadius: "999px", height: "8px", overflow: "hidden", marginBottom: "6px" }}>
                    <div style={{ width: `${Math.min(pct, 100)}%`, background: barColor, height: "100%", transition: "width 0.3s ease" }} />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", fontWeight: 600 }}>
                    <span>{currentUnits} units ({pct}%)</span>
                    <span style={{ color: isFull ? "#dc2626" : "#64748b" }}>
                      {isFull ? "CAPACITY FULL" : `${Math.max(0, maxUnits - currentUnits)} units free`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* BALANCES TABLE */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "0.75rem" }}>Physical On-Hand Balances</h2>
        {loading ? (
          <p>Loading ledger balances...</p>
        ) : balances.length === 0 ? (
          <p style={{ color: "#64748b" }}>No physical balances found.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0", fontSize: "0.95rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "8px 12px" }}>Bin Location</th>
                <th style={{ padding: "8px 12px" }}>Coordinates</th>
                <th style={{ padding: "8px 12px" }}>SKU</th>
                <th style={{ padding: "8px 12px" }}>Item Name</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>On Hand</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 12px" }}><strong>{b.location_code}</strong></td>
                  <td style={{ padding: "8px 12px", color: "#64748b", fontSize: "0.85rem" }}>
                    {[b.aisle, b.rack, b.shelf, b.bin].filter(Boolean).join("-") || "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}><code>{b.item_sku}</code></td>
                  <td style={{ padding: "8px 12px" }}>{b.item_name}</td>
                  <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: "bold" }}>{b.on_hand_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* WORKFLOW CONTROLS */}
      <section style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #cbd5e1", overflow: "hidden", marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #cbd5e1", background: "#f1f5f9" }}>
          <button
            onClick={() => { setTab("transfer"); setMessage(""); }}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: tab === "transfer" ? "#ffffff" : "transparent",
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === "transfer" ? "3px solid #2563eb" : "none",
            }}
          >
            Internal Transfer
          </button>
          <button
            onClick={() => { setTab("inbound"); setMessage(""); }}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: tab === "inbound" ? "#ffffff" : "transparent",
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === "inbound" ? "3px solid #059669" : "none",
            }}
          >
            Inbound PO
          </button>
          <button
            onClick={() => { setTab("outbound"); setMessage(""); }}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: tab === "outbound" ? "#ffffff" : "transparent",
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === "outbound" ? "3px solid #dc2626" : "none",
            }}
          >
            Outbound SO
          </button>
          <button
            onClick={() => { setTab("cycle_count"); setMessage(""); }}
            style={{
              flex: 1,
              padding: "12px",
              border: "none",
              background: tab === "cycle_count" ? "#ffffff" : "transparent",
              fontWeight: 600,
              cursor: "pointer",
              borderBottom: tab === "cycle_count" ? "3px solid #7c3aed" : "none",
            }}
          >
            Cycle Counting & Audit
          </button>
        </div>

        <form onSubmit={handleAction} style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Item / SKU:</label>
            <select
              value={selectedItemId}
              onChange={e => setSelectedItemId(e.target.value)}
              style={{ width: "100%", padding: ".6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            >
              {items.map(it => (
                <option key={it.id} value={it.id}>{it.sku} — {it.name}</option>
              ))}
            </select>
          </div>

          {tab !== "cycle_count" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: tab === "transfer" ? "1fr 1fr" : "1fr", gap: "1rem" }}>
                {(tab === "transfer" || tab === "outbound") && (
                  <div>
                    <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Source Bin:</label>
                    <select
                      value={fromLocId}
                      onChange={e => setFromLocId(e.target.value)}
                      style={{ width: "100%", padding: ".6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                    >
                      {physicalLocations.map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.code} — {loc.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(tab === "transfer" || tab === "inbound") && (
                  <div>
                    <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Destination Bin:</label>
                    <select
                      value={toLocId}
                      onChange={e => setToLocId(e.target.value)}
                      style={{ width: "100%", padding: ".6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                    >
                      {physicalLocations.map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.code} — {loc.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Quantity:</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={quantity}
                    onChange={e => setQuantity(Number(e.target.value))}
                    style={{ width: "100%", padding: ".6rem", boxSizing: "border-box", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>
                    {tab === "inbound" ? "Purchase Order (PO #):" : tab === "outbound" ? "Sales Order (SO #):" : "Reference Document:"}
                  </label>
                  <input
                    type="text"
                    placeholder={tab === "inbound" ? "e.g. PO-2026-904" : tab === "outbound" ? "e.g. SO-2026-108" : "Optional reference"}
                    value={refDoc}
                    onChange={e => setRefDoc(e.target.value)}
                    style={{ width: "100%", padding: ".6rem", boxSizing: "border-box", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>
              </div>
            </>
          )}

          {tab === "cycle_count" && (
            <div style={{ background: "#faf5ff", border: "1px solid #e9d5ff", borderRadius: "6px", padding: "1.25rem", display: "grid", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Target Bin to Audit:</label>
                <select
                  value={auditLocId}
                  onChange={e => setAuditLocId(e.target.value)}
                  style={{ width: "100%", padding: ".6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                >
                  {physicalLocations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.code} — {loc.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", alignItems: "center" }}>
                <div style={{ background: "#ffffff", padding: ".75rem", borderRadius: "4px", border: "1px solid #e2e8f0" }}>
                  <small style={{ color: "#64748b" }}>Current System Balance</small>
                  <div style={{ fontSize: "1.25rem", fontWeight: "bold" }}>{currentAuditedBalance}</div>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Physical Counted Qty:</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={countedQty}
                    onChange={e => setCountedQty(Number(e.target.value))}
                    style={{ width: "100%", padding: ".6rem", boxSizing: "border-box", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                  />
                </div>

                <div style={{
                  background: currentVariance === 0 ? "#f0fdf4" : currentVariance > 0 ? "#eff6ff" : "#fef2f2",
                  padding: ".75rem",
                  borderRadius: "4px",
                  border: `1px solid ${currentVariance === 0 ? "#bbf7d0" : currentVariance > 0 ? "#bfdbfe" : "#fecaca"}`
                }}>
                  <small style={{ color: "#64748b" }}>Calculated Variance</small>
                  <div style={{
                    fontSize: "1.25rem",
                    fontWeight: "bold",
                    color: currentVariance === 0 ? "#166534" : currentVariance > 0 ? "#1d4ed8" : "#b91c1c"
                  }}>
                    {currentVariance > 0 ? `+${currentVariance}` : currentVariance}
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: ".35rem", fontWeight: 600, fontSize: "0.9rem" }}>Audit Reason / Notes:</label>
                <input
                  type="text"
                  value={auditReason}
                  onChange={e => setAuditReason(e.target.value)}
                  style={{ width: "100%", padding: ".6rem", boxSizing: "border-box", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            style={{
              padding: ".75rem",
              background: tab === "inbound" ? "#059669" : tab === "outbound" ? "#dc2626" : tab === "cycle_count" ? "#7c3aed" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.95rem",
            }}
          >
            {tab === "inbound" ? "Post Inbound Goods Receipt" :
             tab === "outbound" ? "Dispatch & Ship Outbound Stock" :
             tab === "cycle_count" ? "Submit Audit & Reconcile Variance" :
             "Transfer Stock"}
          </button>
        </form>

        {message && (
          <div style={{
            margin: "0 1.5rem 1.5rem",
            padding: ".75rem",
            borderRadius: "4px",
            background: message.startsWith("Error") ? "#fee2e2" : "#dcfce7",
            color: message.startsWith("Error") ? "#991b1b" : "#166534",
            fontWeight: 600
          }}>
            {message}
          </div>
        )}
      </section>

      {/* TRANSACTION AUDIT TRAIL */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <h2 style={{ fontSize: "1.15rem", margin: 0 }}>Transaction Audit Trail (Ledger Journal)</h2>
          <small style={{ color: "#64748b" }}>Live double-entry movements</small>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "8px 10px" }}>Timestamp</th>
                <th style={{ padding: "8px 10px" }}>Movement Type</th>
                <th style={{ padding: "8px 10px" }}>Reference</th>
                <th style={{ padding: "8px 10px" }}>SKU</th>
                <th style={{ padding: "8px 10px" }}>From</th>
                <th style={{ padding: "8px 10px" }}>To</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Qty</th>
                <th style={{ padding: "8px 10px" }}>Operator</th>
              </tr>
            </thead>
            <tbody>
              {ledgerEntries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap", color: "#64748b" }}>{entry.created_at}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      background: 
                        entry.movement_type === "receive" ? "#e0f2fe" :
                        entry.movement_type === "ship" ? "#fee2e2" :
                        entry.movement_type === "cycle_count_adjustment" ? "#f3e8ff" : "#f1f5f9",
                      color: 
                        entry.movement_type === "receive" ? "#0369a1" :
                        entry.movement_type === "ship" ? "#b91c1c" :
                        entry.movement_type === "cycle_count_adjustment" ? "#6b21a8" : "#475569"
                    }}>
                      {entry.movement_type}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px" }}><strong>{entry.reference_doc || "—"}</strong></td>
                  <td style={{ padding: "8px 10px" }}><code>{entry.item_sku}</code></td>
                  <td style={{ padding: "8px 10px" }}><code>{entry.from_location_code}</code></td>
                  <td style={{ padding: "8px 10px" }}><code>{entry.to_location_code}</code></td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: "bold" }}>{entry.quantity}</td>
                  <td style={{ padding: "8px 10px", color: "#64748b" }}>{entry.performed_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
