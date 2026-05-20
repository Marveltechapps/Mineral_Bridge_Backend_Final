/**
 * Resolve catalog stock fields for minerals (dashboard + app).
 * Used by GET mapMineral, POST/PATCH persistence, and bulk-normalize.
 */

function toOptionalNumber(v) {
  if (v == null) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'object' && v !== null && typeof v.toString === 'function') {
    const n = parseFloat(String(v.toString()).replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function getAvailabilityState(rawAv) {
  let enabled = false;
  let quantity;
  let unit;
  if (rawAv && typeof rawAv === 'object' && !Array.isArray(rawAv)) {
    enabled =
      rawAv.enabled === true ||
      rawAv.enabled === 'true' ||
      rawAv.enabled === 1 ||
      rawAv.enabled === '1';
    quantity = toOptionalNumber(rawAv.quantity);
    if (rawAv.unit != null && String(rawAv.unit).trim()) unit = String(rawAv.unit).trim();
  }
  return { enabled, quantity, unit };
}

/**
 * Pick canonical availableQuantity + availableQuantityUnit from a DB/API-shaped mineral document.
 * @returns {{ availableQuantity: number, availableQuantityUnit: string } | null}
 */
function resolveStockFieldsFromDocument(m) {
  const state = resolveStockStateFromDocument(m);
  if (!state) return null;
  return {
    availableQuantity: state.availableQuantity,
    availableQuantityUnit: state.availableQuantityUnit,
  };
}

/**
 * Resolve current stock including source so orders can safely decrement it.
 * Explicit zero is preserved and treated as "out of stock" instead of "missing".
 * @returns {{ availableQuantity: number, availableQuantityUnit: string, source: string } | null}
 */
function resolveStockStateFromDocument(m) {
  if (!m) return null;
  const aqTop = toOptionalNumber(m.availableQuantity);
  let aqUnit =
    m.availableQuantityUnit != null && String(m.availableQuantityUnit).trim()
      ? String(m.availableQuantityUnit).trim()
      : undefined;
  const rawAv = m.availability;
  const avState = getAvailabilityState(rawAv);
  const limOn = avState.enabled;
  const limQ = avState.quantity;
  const limUnit = avState.unit;
  const altQ = toOptionalNumber(m.availableQty ?? m.availabilityQty ?? m.stock ?? m.quantityAvailable);
  const priceUnit = m.unit != null && String(m.unit).trim() ? String(m.unit).trim() : undefined;

  let qty;
  let unit;
  let source;
  if (limOn && limQ !== undefined && limQ >= 0) {
    qty = limQ;
    unit = limUnit || aqUnit || priceUnit || 'MT';
    source = 'limited';
  } else if (aqTop !== undefined && aqTop >= 0) {
    qty = aqTop;
    unit = aqUnit || limUnit || priceUnit || 'MT';
    source = 'catalog';
  } else if (!limOn && limQ !== undefined && limQ >= 0) {
    qty = limQ;
    unit = limUnit || aqUnit || priceUnit || 'MT';
    source = 'availability';
  } else if (altQ !== undefined && altQ >= 0) {
    qty = altQ;
    unit = aqUnit || limUnit || priceUnit || 'MT';
    source = 'alternate';
  } else {
    return null;
  }
  return { availableQuantity: qty, availableQuantityUnit: unit, source };
}

module.exports = {
  toOptionalNumber,
  resolveStockStateFromDocument,
  resolveStockFieldsFromDocument,
};
