# Sell Module – API Endpoints

Data for sell module screens: **Dashboard → App** (minerals, sell content) and **App → Dashboard** (listings, orders, addresses). Use same endpoints for realtime: app GETs data from DB; dashboard GETs/PATCHes the same data.

**Base URL:** `http://localhost:5000` (or your API host)

**Auth:** Send JWT in header: `Authorization: Bearer <token>`

**Dashboard access:** Set env `DASHBOARD_SECRET` and send `x-dashboard-key: <DASHBOARD_SECRET>` with the same Bearer token. Then: GET listings/orders with `?all=1` returns all; GET/PATCH/DELETE by id can target any user’s resource.

---

## Minerals (Dashboard ↔ App)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/minerals` | No | List all minerals. Query: `?category=Precious Metals` |
| GET | `/api/minerals/:id` | No | Single mineral by id or name (for sell intro/detail) |
| POST | `/api/minerals` | Yes | Create mineral (dashboard) |
| PATCH | `/api/minerals/:id` | Yes | Update mineral (dashboard) |

Response shape: `id`, `name`, `category`, `image`, `price`/`priceDisplay`, `description`, `origin`, `purity`, `unit`.

---

## Sell content (Dashboard → App)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/content/sell` | No | Sell module copy/options (labels, acceptFormats, stepLabels, etc.) |
| PATCH | `/api/content/sell` | Yes | Update sell content (dashboard) |

---

## Listings (App + Dashboard)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/listings` | Yes | Create listing (app). Body below. |
| GET | `/api/listings` | Yes | List. Query: `?mine=1` (user’s), `?all=1` (dashboard: all), `?status=...` |
| GET | `/api/listings/:id` | Yes | Single listing (owner or dashboard) |
| PATCH | `/api/listings/:id` | Yes | Update (owner or dashboard) |
| DELETE | `/api/listings/:id` | Yes | Delete (owner or dashboard) |

**POST body:** `mineralId`, `category?`, `quantity`, `unit?`, `type?`, `buyerType?`, `origin?`, `photos?[]`, `documents?[]`, `extractionDate?`, `originYear?`, `targetBuyerType?`, `verificationStatus?`, `assayRequired?`, `aiEstimatedPayout?`, `escrowStatus?`, `pickupMethod?`, `pickupAddressId?`, `sampleTestRequired?`, `billOfSaleUrl?`

**Response:** `id`, `userId`, `mineralId`, `category`, `quantity`, `unit`, `type`, `origin`, `photos`, `documents`, `extractionDate`, `status`, `createdAt`, `updatedAt`, …

---

## Orders (App + Dashboard)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/orders` | Yes | Create order (app). For sell: include `listingId`, `type: 'sell'`. |
| GET | `/api/orders` | Yes | List. Query: `?type=sell`, `?all=1` (dashboard: all) |
| GET | `/api/orders/:id` | Yes | Single order (owner or dashboard) |
| PATCH | `/api/orders/:id` | Yes | Update status/timeline (owner or dashboard). Body: `status?`, `step?` (1–5) |

**POST body (sell):** `mineralId`, `mineralName?`, `quantity`, `addressId`, `type: 'sell'`, `listingId?`, `mineralType?`, `amount?`, …

**Response:** `id`, `orderId`, `userId`, `listingId`, `mineralId`, `mineralName`, `quantity`, `addressId`, `type`, `status`, `timeline`, `createdAt`, `updatedAt`, …

---

## Addresses (Pickup / Sell logistics)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/addresses` | Yes | User’s saved addresses |
| POST | `/api/addresses` | Yes | Create address. Body: `street`, `city`, `country`, `state?`, `stateRegion?`, `postalCode?`, `phone?`, `email?`, `facilityName?`, `label?`, `institutionalPermitNumber?`, `proofOfFacilityUrl?`, `regulatoryCompliance?`, `isDefault?` |
| PATCH | `/api/addresses/:id` | Yes | Update address (same fields) |
| DELETE | `/api/addresses/:id` | Yes | Delete address |

Response includes `state` and `stateRegion` (same value).

---

## Database collections (Sell)

- **listings** – sell listings (userId, mineralId, quantity, unit, type, origin, photos, documents, extractionDate, status, pickupAddressId, …)
- **orders** – sell/buy orders (userId, orderId, listingId for sell, mineralId, addressId, type, status, timeline, …)
- **addresses** – pickup/delivery (userId, facilityName, street, city, state, country, …)
- **minerals** – catalog (id, name, category, image, price, …)
- **content** – key `sell`: sell module copy/options

Run `npm run ensure-indexes` (from backend) to create indexes.
