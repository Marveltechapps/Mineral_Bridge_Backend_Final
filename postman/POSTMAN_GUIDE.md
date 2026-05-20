# Postman – Backend & DB Testing Guide

## 1. Import collection

1. Open Postman.
2. **Import** → **Upload Files** → select `Mineral_Bridge_API.postman_collection.json`.
3. Set **baseUrl** if needed: Collection → Variables → `baseUrl` = `http://localhost:5000` (or `http://192.168.1.25:5000` if testing from another device).

---

## 2. Get a token (required for most endpoints)

Run these in order under **1. Auth**:

| Order | Request        | Body / notes |
|-------|----------------|--------------|
| 1     | **Send OTP**   | `{"countryCode":"+1","phone":"9876543210"}` |
| 2     | **Verify OTP** | `{"countryCode":"+1","phone":"9876543210","otp":"123456"}` (dev OTP is `123456`) |
| 3     | **Register or Login** | Same phone + optional `name`, `email`, `location`. Response includes `token`. |

- The collection has a **test script** on "Register or Login" that saves the token into the collection variable `token`.
- If you run the full **1. Auth** folder (Run collection), the token is set automatically.
- Or copy `token` from the response and set it: Collection → Variables → `token` = `<paste>`.

**Auth header for protected routes:**  
`Authorization: Bearer {{token}}`  
(The collection already adds this for all auth-required requests.)

---

## 3. Recommended test order (so you have data to check)

1. **0. Health** – GET `/health` → `{"status":"ok",...}`  
2. **1. Auth** – Send OTP → Verify OTP → Register or Login → copy/save `token`.  
3. **2. Public** – GET minerals, market-insights, help/faqs, artisanal/eligibility (no token).  
4. **3. Users** – GET `/api/users/me` (with token).  
5. **5. Addresses** – POST one address → GET addresses → copy an address `id`.  
6. **6. Orders** – POST order using that `addressId` (replace `USE_ADDRESS_ID_FROM_GET_ADDRESSES` in body) → GET orders → copy an `orderId` for PATCH/GET by id.  
7. **4. KYC** – POST documents → POST submit → GET status.  
8. **7. Listings** – POST listing → GET mine → copy `id` for GET/PATCH by id.  
9. **8. Notifications** – POST notification → GET list → copy `id` for PATCH read.  
10. **9. Activity** – POST activity → GET activity.  
11. **10. Help** – POST contact (email or callback).  
12. **11. Payment Methods** – POST Bank or Crypto → GET list → copy `id` for DELETE.  
13. **12. Transactions** – POST transaction → GET list.  
14. **13. App Settings** – GET → PATCH.  
15. **14. Artisanal** – GET profile → POST profile → safety-training, equipment-requests, certifications, incident-reports.

---

## 4. All endpoints quick reference

**Base URL:** `http://localhost:5000` (or your server)

**Auth:** `Authorization: Bearer <token>` for all except Health and "Public" group.

### No auth

| Method | URL | Body (if any) |
|--------|-----|----------------|
| GET | `/health` | — |
| POST | `/api/auth/send-otp` | `{"countryCode":"+1","phone":"9876543210"}` |
| POST | `/api/auth/verify-otp` | `{"countryCode":"+1","phone":"9876543210","otp":"123456"}` |
| POST | `/api/auth/register-or-login` | `{"countryCode":"+1","phone":"9876543210","name":"Test","email":"test@mb.com"}` |
| GET | `/api/minerals` | — |
| GET | `/api/minerals?category=Precious Metals` | — |
| GET | `/api/minerals/gold` | — (or use any mineral id from list) |
| GET | `/api/market-insights` | — |
| GET | `/api/help/faqs` | — |
| GET | `/api/help/faqs?category=Payments` | — |
| GET | `/api/help/categories` | — |
| GET | `/api/artisanal/eligibility?country=Ghana` | — |

### With auth (Bearer token)

| Method | URL | Sample body |
|--------|-----|-------------|
| GET | `/api/users/me` | — |
| PATCH | `/api/users/me` | `{"name":"Test","email":"t@mb.com"}` |
| PATCH | `/api/users/me/profile` | `{"avatarUrl":"https://..."}` |
| GET | `/api/users/me/security` | — |
| PATCH | `/api/users/me/security` | `{"twoFactorEnabled":true}` |
| GET | `/api/users/me/sessions` | — |
| POST | `/api/users/me/sessions` | `{"deviceName":"Postman"}` |
| DELETE | `/api/users/me/sessions/:id` | — |
| POST | `/api/kyc/documents` | `{"idType":"National ID","frontUrl":"...","backUrl":"...","selfieUrl":"..."}` |
| POST | `/api/kyc/submit` | — |
| GET | `/api/kyc/status` | — |
| GET | `/api/addresses` | — |
| POST | `/api/addresses` | See “Post Address” in collection |
| PATCH | `/api/addresses/:id` | `{"label":"New Label"}` |
| DELETE | `/api/addresses/:id` | — |
| POST | `/api/orders` | mineralId, quantity, addressId required; see collection |
| GET | `/api/orders` | — |
| GET | `/api/orders?type=buy` | — |
| GET | `/api/orders/:id` | — |
| PATCH | `/api/orders/:id` | `{"step":2}` or `{"status":"Contact"}` |
| POST | `/api/listings` | mineralId, quantity required; see collection |
| GET | `/api/listings?mine=1` | — |
| GET | `/api/listings/:id` | — |
| PATCH | `/api/listings/:id` | `{"status":"pending"}` |
| GET | `/api/notifications` | — |
| GET | `/api/notifications?unreadOnly=1` | — |
| POST | `/api/notifications` | `{"title":"...","body":"..."}` |
| PATCH | `/api/notifications/:id/read` | — |
| GET | `/api/activity` | — |
| POST | `/api/activity` | `{"title":"...","message":"..."}` |
| POST | `/api/help/contact` | `{"type":"email","subject":"...","message":"..."}` |
| GET | `/api/payment-methods` | — |
| POST | `/api/payment-methods` | Bank: type, holderName, bankName, accountNumber, swift; Crypto: type, label, network, address |
| DELETE | `/api/payment-methods/:id` | — |
| GET | `/api/transactions` | — |
| GET | `/api/transactions/:id` | — |
| POST | `/api/transactions` | orderId, type, itemName, total required |
| GET | `/api/app-settings` | — |
| PATCH | `/api/app-settings` | `{"currency":"USD","theme":"dark",...}` |
| GET | `/api/artisanal/profile` | — |
| POST | `/api/artisanal/profile` | See “Post Profile” in collection |
| GET | `/api/artisanal/safety-training` | — |
| PATCH | `/api/artisanal/safety-training` | `{"moduleId":"advanced-tools","status":"completed"}` |
| GET | `/api/artisanal/equipment-requests` | — |
| POST | `/api/artisanal/equipment-requests` | `{"itemName":"Pneumatic Drill"}` |
| GET | `/api/artisanal/certifications` | — |
| GET | `/api/artisanal/incident-reports` | — |
| POST | `/api/artisanal/incident-reports` | `{"category":"Safety","description":"..."}` (category: Safety \| Injury \| Environmental) |

---

## 5. Sample data for POST body (copy-paste)

**Address (for orders):**
```json
{
  "label": "Warehouse A",
  "facilityName": "Export Warehouse A",
  "street": "123 Mineral St",
  "city": "Addis Ababa",
  "state": "Addis Ababa",
  "country": "Ethiopia",
  "postalCode": "1000",
  "phone": "+251911234567",
  "institutionalPermitNumber": "ET-EXP-2026",
  "regulatoryCompliance": true,
  "isDefault": true
}
```

**Order (replace addressId with real id from GET /api/addresses):**
```json
{
  "mineralId": "gold",
  "mineralName": "Gold",
  "quantity": 10,
  "amount": "24000",
  "addressId": "PASTE_ADDRESS_ID_HERE",
  "type": "buy",
  "mineralType": "raw",
  "buyerCategory": "Supplier",
  "deliveryMethod": "Direct Delivery",
  "subtotal": 24000,
  "transportFee": 500,
  "feePercent": 1,
  "totalDue": 24740
}
```

**Listing:**
```json
{
  "mineralId": "gold",
  "category": "Precious Metals",
  "quantity": 500,
  "unit": "kg",
  "type": "raw",
  "buyerType": "Refinery",
  "origin": "Ghana",
  "originYear": 2025,
  "photos": ["https://example.com/mineral1.jpg"],
  "pickupMethod": "Pickup",
  "aiEstimatedPayout": 120000,
  "sampleTestRequired": true
}
```

**Transaction:**
```json
{
  "orderId": "MB-ORDER-12345",
  "type": "Buy",
  "itemName": "Gold",
  "subtotal": 24000,
  "serviceFee": 600,
  "networkFee": 50,
  "total": 24650
}
```

---

## 6. Ensure DB has data

- **Minerals:** Run `node seed/seed.js` from `backend` (or your npm script) so GET `/api/minerals` returns list.
- **Market insights:** Optional – `node scripts/seed-market-insights.js`; otherwise API returns default labels.
- **Indexes:** Run `npm run ensure-indexes` from `backend` once.

After that, use the collection and this guide to hit every endpoint and verify backend + DB.
