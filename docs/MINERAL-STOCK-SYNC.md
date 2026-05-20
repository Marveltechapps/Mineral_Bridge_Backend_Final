# Mineral stock fields for the mobile app

The app reads **`availableQuantity`** and **`availableQuantityUnit`** (plus `availability`) to show “in stock”, limits, and hero lines. Legacy or imported rows may only have allocation / limited-availability nested data.

## One-time or bulk fix (all minerals)

1. **Restart the API** after deploying `backend/lib/mineralStockResolve.js` and the minerals routes.
2. Either:
   - **Dashboard**: Minerals → **Sync stock for app** (next to Import from Master Sheet), or  
   - **CLI**: from repo root, `node backend/scripts/normalize-mineral-stock.js`
3. **Reload the Expo app** (pull-to-refresh or reopen the buy flow).

## Ongoing

- **POST / PATCH** a mineral → the API merges your changes with the existing document and **always** writes resolved `availableQuantity` / `availableQuantityUnit` when it can derive them (limited availability, catalog qty, etc.). You do **not** need “Sync stock for app” after normal dashboard saves.
- **Master Sheet import** → after a successful import, the dashboard calls bulk normalize (non-fatal if it fails).

API: `PATCH /api/minerals/bulk-normalize-stock` (authenticated).
