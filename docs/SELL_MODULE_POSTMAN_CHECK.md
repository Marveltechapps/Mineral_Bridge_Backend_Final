# Sell Module – Postman Check (Endpoints + Sample Data)

Use these in Postman to verify sell screens. **Base URL:** `http://localhost:5000` (or your `API_BASE`). No code changes required.

---

## 1. Get a JWT (required for listings, orders, addresses)

**POST** `http://localhost:5000/api/auth/register-or-login`  
**Headers:** `Content-Type: application/json`  
**Body (raw JSON):**

```json
{
  "countryCode": "+91",
  "phone": "9876543210",
  "otp": "123456"
}
```

(If your app uses send-otp → verify-otp first, do that; then use the token from the response.)

**Expected:** `200` – response includes `token`. Copy `token` for steps 3–10.

---

## 2. Minerals (no auth – used by Sell home, category list, mineral list)

**GET** `http://localhost:5000/api/minerals`  
**Expected:** `200` – array of minerals, e.g. `[{ "id": "gold", "name": "Gold", "category": "Precious Metals", "image": "...", ... }]`

**GET** `http://localhost:5000/api/minerals?category=Precious%20Metals`  
**Expected:** `200` – array filtered by category

**GET** `http://localhost:5000/api/minerals/gold`  
**Expected:** `200` – single mineral object

---

## 3. Sell content (no auth – optional for sell screens)

**GET** `http://localhost:5000/api/content/sell`  
**Expected:** `200` – e.g. `{ "searchPlaceholder": "Search mineral type...", "whatAreYouSellingTitle": "What are you selling?", "acceptFormats": ["Raw", "Semi-Processed", "Processed"], "requiredCompliance": [...], "stepLabels": { "step1": "STEP 1 OF 3", ... }, "saleConfirmed": { "title": "Sale Confirmed", "subtitle": "..." } }`

---

## 4. Addresses (auth – used by Logistics screen)

**Headers for 4–10:**  
`Authorization: Bearer YOUR_TOKEN`  
`Content-Type: application/json`

**GET** `http://localhost:5000/api/addresses`  
**Expected:** `200` – array of user’s addresses (or `[]`)

**POST** `http://localhost:5000/api/addresses`  
**Body (raw JSON):**

```json
{
  "label": "Pickup Location",
  "facilityName": "Test Facility",
  "street": "123 Export St",
  "city": "Mumbai",
  "stateRegion": "Maharashtra",
  "country": "India",
  "postalCode": "400001",
  "phone": "9876543210",
  "email": "seller@example.com",
  "institutionalPermitNumber": "PERMIT-001",
  "regulatoryCompliance": true
}
```

**Expected:** `201` – created address with `id`. Save `id` for step 6 (orders).

---

## 5. Listings (auth – created on Confirm Sale from Settlement screen)

**POST** `http://localhost:5000/api/listings`  
**Headers:** same as above  
**Body (raw JSON):**

```json
{
  "mineralId": "gold",
  "category": "Precious Metals",
  "quantity": 10,
  "unit": "grams",
  "type": "raw",
  "origin": "Mumbai, India",
  "photos": [],
  "documents": []
}
```

**Expected:** `201` – created listing with `id`. Save `id` for step 6 (orders) as `listingId`.

**GET** `http://localhost:5000/api/listings?mine=1`  
**Expected:** `200` – array including the listing you just created

**GET** `http://localhost:5000/api/listings/LISTING_ID`  
Replace `LISTING_ID` with the `id` from POST response.  
**Expected:** `200` – single listing

---

## 6. Orders (auth – created after listing on Confirm Sale)

**POST** `http://localhost:5000/api/orders`  
**Headers:** same as above  
**Body (raw JSON)** – use address `id` from step 4 and optional `listingId` from step 5:

```json
{
  "mineralId": "gold",
  "mineralName": "Gold",
  "quantity": 10,
  "addressId": "ADDRESS_ID_FROM_STEP_4",
  "type": "sell",
  "listingId": "LISTING_ID_FROM_STEP_5"
}
```

**Expected:** `201` – created order with `orderId`, `id`

**GET** `http://localhost:5000/api/orders?type=sell`  
**Expected:** `200` – array of sell orders (SellerDashboard uses this)

**GET** `http://localhost:5000/api/orders/ORDER_ID`  
Replace `ORDER_ID` with the order’s `id` from POST response.  
**Expected:** `200` – single order

---

## 7. Quick checklist (order to run)

| # | Method | URL | Auth | Purpose |
|---|--------|-----|------|--------|
| 1 | POST | `/api/auth/register-or-login` | No | Get token |
| 2a | GET | `/api/minerals` | No | Sell home / mineral list |
| 2b | GET | `/api/minerals?category=Precious Metals` | No | Category list |
| 2c | GET | `/api/minerals/gold` | No | Mineral detail (intro) |
| 3 | GET | `/api/content/sell` | No | Sell copy (optional) |
| 4a | GET | `/api/addresses` | Yes | Logistics – load addresses |
| 4b | POST | `/api/addresses` | Yes | Create pickup address |
| 5a | POST | `/api/listings` | Yes | Confirm Sale – create listing |
| 5b | GET | `/api/listings?mine=1` | Yes | My Sales list |
| 6a | POST | `/api/orders` | Yes | Confirm Sale – create order |
| 6b | GET | `/api/orders?type=sell` | Yes | My Sales orders |

Use the token from step 1 in header `Authorization: Bearer <token>` for steps 4–6.

---

## 8. Optional – PATCH and DELETE (auth)

**PATCH** `http://localhost:5000/api/listings/LISTING_ID`  
**Body:** `{ "status": "submitted" }`  
**Expected:** `200`

**PATCH** `http://localhost:5000/api/orders/ORDER_ID`  
**Body:** `{ "step": 2 }` or `{ "status": "Contact" }`  
**Expected:** `200`

**PATCH** `http://localhost:5000/api/addresses/ADDRESS_ID`  
**Body:** `{ "facilityName": "Updated Name" }`  
**Expected:** `200`

**DELETE** `http://localhost:5000/api/listings/LISTING_ID`  
**Expected:** `200` – `{ "success": true }`

**DELETE** `http://localhost:5000/api/addresses/ADDRESS_ID`  
**Expected:** `200` – `{ "success": true }`

---

## 9. Dashboard-style (optional)

If `DASHBOARD_SECRET` is set in backend `.env`, add header:  
`x-dashboard-key: <value of DASHBOARD_SECRET>`

**GET** `http://localhost:5000/api/listings?all=1`  
**GET** `http://localhost:5000/api/orders?all=1`  
**Expected:** `200` – all users’ listings/orders (with same Bearer token).
