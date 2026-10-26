export type LocationType = 'warehouse' | 'zone' | 'aisle' | 'rack' | 'shelf' | 'bin' | 'virtual';

export interface Location {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  parentId: string | null;
  barcode: string;
  isActive: boolean;
  createdAt: string;
}

export interface Item {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  description?: string;
  unitOfMeasure: string;
  createdAt: string;
}

export type InventoryMovementType = 
  | 'receive'
  | 'putaway'
  | 'internal_transfer'
  | 'pick'
  | 'ship'
  | 'cycle_count_adjustment';

export interface InventoryLedgerEntry {
  id: string;
  transactionId: string;
  movementType: InventoryMovementType;
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  referenceDoc?: string;
  performedByUserId: string;
  timestamp: string;
}

export interface InventoryBalance {
  itemId: string;
  locationId: string;
  onHandQuantity: number;
}
