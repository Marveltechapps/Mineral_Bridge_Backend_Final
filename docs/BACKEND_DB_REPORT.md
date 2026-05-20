# Mineral Bridge – Backend & DB Completion Report

**Date:** February 2025  
**Scope:** All modules/screens from the product flows (Auth, Home, Buy, Sell, Profile/More, Artisanal/Mining, Help, Security).

---

## 1. Executive Summary

| Layer        | Status   | Notes |
|-------------|----------|--------|
| **Database**| Complete | 20 collections used; schema doc + indexes script in place. |
| **Backend API** | Complete | 14 route modules, 55+ endpoints; all documented flows covered. |

The backend and DB are implemented for the full app: auth, onboarding, KYC, Home dashboard, Buy flow, Sell flow, Profile/More (addresses, payment methods, order/transaction history, security, app settings, help), and Artisanal (eligibility, profile, safety training, equipment, certifications, incident reporting).

---

## 2. Database (MongoDB)

### 2.1 Collections in Use

| Collection | Purpose | Used By |
|------------|---------|---------|
| **users** | Auth: phone, name, email, location | auth, users, middleware |
| **otps** | OTP storage (TTL expiry) | auth |
| **profiles** | kycStatus, avatarUrl, twoFactorEnabled | users, kyc |
| **kyc_documents** | ID type, front/back/selfie URLs, digitalIdentityHash | kyc |
| **addresses** | Delivery/facility addresses | addresses |
| **orders** | Buy/sell orders, 5-step timeline | orders |
| **listings** | Sell listings (mineral, quantity, logistics) | listings |
| **minerals** | Catalog (name, category, image, price, origin, purity) | minerals, seed |
| **notifications** | In-app notifications (title, body, readAt) | notifications |
| **artisanal_profiles** | ASM profile (7-step flow) | artisanal |
| **safety_training** | Training modules (completed/in_progress/locked) | artisanal |
| **equipment_requests** | Equipment requests (queued, etc.) | artisanal |
| **certifications** | Tier, blockchainHash, L1 accredited | artisanal |
| **incident_reports** | Safety/Injury/Environmental reports | artisanal |
| **payment_methods** | Bank & crypto payment methods | payment_methods |
| **transactions** | Financial ledger (buy/sell, fees, invoice) | transactions |
| **app_settings** | Language, currency, theme, notification toggles | app_settings |
| **market_insights** | Dashboard price alerts (optional seed) | market_insights |
| **activity_feed** | Dashboard activity (verification, triggers) | activity |
| **support_requests** | Help contact (email/callback/chat) | help |
| **user_sessions** | Active sessions for Security & Privacy | users |

### 2.2 Schema Documentation

- **Location:** `backend/docs/DB_SCHEMA.md`
- **Content:** Field-level description for all main collections (auth, KYC, buy, sell, artisanal, profile, notifications, market_insights, minerals).
- **Gap:** Schema doc does not yet list `activity_feed`, `support_requests`, `user_sessions`, or `profiles.twoFactorEnabled`. These are used by the code and can be added to the doc later.

### 2.3 Indexes

- **Script:** `backend/scripts/ensure-indexes.js`
- **Run:** `npm run ensure-indexes` (or `node scripts/ensure-indexes.js`)
- **Coverage:** Unique indexes on `users.phone`, `profiles.userId`, `kyc_documents.userId`, `orders.orderId` (sparse); compound indexes on `userId` + `createdAt`/`date`/`requestedAt` for lists; TTL on `otps.expiresAt`; minerals by `name` and `category`.
- **Optional:** For production you may add indexes on `activity_feed` (userId, createdAt), `user_sessions` (userId), `support_requests` (userId, createdAt), `market_insights` (order). Collections work without them for moderate load.

### 2.4 Seed Data

- **Minerals:** `backend/seed/seed.js` – inserts 14 minerals (Gold, Silver, Diamond, Emerald, etc.) into `minerals`. Run manually or via your own npm script.
- **Market insights:** `backend/scripts/seed-market-insights.js` – optional seed for `market_insights`. API returns in-memory defaults if collection is empty.

---

## 3. Backend API (Express)

### 3.1 Route Modules & Mount Points

| Mount Path | Module | Description |
|------------|--------|-------------|
| `/api/auth` | auth.js | Send OTP, verify OTP, register-or-login |
| `/api/users` | users.js | Me, profile, security (2FA), sessions |
| `/api/notifications` | notifications.js | List, create, mark read |
| `/api/orders` | orders.js | CRUD + timeline (5 steps) |
| `/api/addresses` | addresses.js | CRUD + delete |
| `/api/kyc` | kyc.js | Documents, submit, status |
| `/api/listings` | listings.js | CRUD for sell listings |
| `/api/artisanal` | artisanal.js | Eligibility, profile, safety, equipment, certifications, incidents |
| `/api/payment-methods` | payment_methods.js | List, add, delete |
| `/api/transactions` | transactions.js | List, get by id, create |
| `/api/app-settings` | app_settings.js | Get, patch (upsert) |
| `/api/market-insights` | market_insights.js | Dashboard price alerts |
| `/api/activity` | activity.js | Activity feed list + create |
| `/api/help` | help.js | FAQs, categories, contact |
| `/api/minerals` | minerals.js | List + get by id |
| — | — | `GET /health` (root) |

### 3.2 Endpoint List (by Module)

**Auth** (no auth header)

- `POST /api/auth/send-otp` – body: `countryCode`, `phone`
- `POST /api/auth/verify-otp` – body: `countryCode`, `phone`, `otp`
- `POST /api/auth/register-or-login` – body: `countryCode`, `phone`, `name?`, `email?`, `location?` → returns `token`, `user`

**Users** (auth)

- `GET /api/users/me` – current user + kycStatus, avatarUrl
- `PATCH /api/users/me` – body: `name?`, `email?`
- `PATCH /api/users/me/profile` – body: `avatarUrl?`
- `GET /api/users/me/security` – twoFactorEnabled, public/private data text
- `PATCH /api/users/me/security` – body: `twoFactorEnabled`
- `GET /api/users/me/sessions` – active sessions
- `POST /api/users/me/sessions` – body: `deviceName?`
- `DELETE /api/users/me/sessions/:id` – revoke session

**KYC** (auth)

- `POST /api/kyc/documents` – body: `idType`, `frontUrl?`, `backUrl?`, `selfieUrl?`
- `POST /api/kyc/submit` – submit KYC → under_review, digitalIdentityHash
- `GET /api/kyc/status` – kycStatus + documents (incl. digitalIdentityHash)

**Orders** (auth)

- `POST /api/orders` – body: mineralId, quantity, addressId, type, mineralType, buyerCategory, deliveryMethod, subtotal, transportFee, feePercent, totalDue, etc.
- `GET /api/orders` – query: `?type=buy|sell`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id` – body: `status?`, `step?` (1–5 for timeline)

**Addresses** (auth)

- `GET /api/addresses`
- `POST /api/addresses` – full address + compliance fields
- `PATCH /api/addresses/:id`
- `DELETE /api/addresses/:id`

**Listings** (auth)

- `POST /api/listings` – mineralId, quantity, type, buyerType, origin, photos, logistics, etc.
- `GET /api/listings` – query: `?mine=1`, `?status=...`
- `GET /api/listings/:id`
- `PATCH /api/listings/:id`

**Minerals** (public)

- `GET /api/minerals` – query: `?category=...`
- `GET /api/minerals/:id` – single mineral (origin, purity, etc.)

**Notifications** (auth)

- `GET /api/notifications` – query: `?unreadOnly=1`
- `POST /api/notifications` – body: `title`, `body?`
- `PATCH /api/notifications/:id/read`

**Artisanal** (eligibility public; rest auth)

- `GET /api/artisanal/eligibility` – query: `?country=...`
- `GET /api/artisanal/profile`
- `POST /api/artisanal/profile` – full 7-step profile body
- `GET /api/artisanal/safety-training`
- `PATCH /api/artisanal/safety-training` – body: `modules?` or `moduleId` + `status`
- `GET /api/artisanal/equipment-requests`
- `POST /api/artisanal/equipment-requests` – body: `itemName`
- `GET /api/artisanal/certifications`
- `GET /api/artisanal/incident-reports`
- `POST /api/artisanal/incident-reports` – body: `category`, `description?`, `photoUrl?`

**Payment methods** (auth)

- `GET /api/payment-methods`
- `POST /api/payment-methods` – body: Bank or Crypto fields
- `DELETE /api/payment-methods/:id`

**Transactions** (auth)

- `GET /api/transactions` – query: `?type=Buy|Sell`, `?status=...`, `?limit=...`
- `GET /api/transactions/:id`
- `POST /api/transactions` – body: orderId, type, itemName, subtotal, serviceFee, networkFee, total, invoiceUrl?

**App settings** (auth)

- `GET /api/app-settings`
- `PATCH /api/app-settings` – language, currency, theme, notification toggles, showMarketPredictions

**Market insights** (public)

- `GET /api/market-insights` – dashboard price alerts

**Activity** (auth)

- `GET /api/activity` – activity feed
- `POST /api/activity` – body: `type?`, `title`, `message?`, `metadata?`

**Help**

- `GET /api/help/faqs` – query: `?category=...`, `?q=...`
- `GET /api/help/categories`
- `POST /api/help/contact` (auth) – body: `type`, `category?`, `subject?`, `message?`

**Health**

- `GET /health` – { status: 'ok', service: 'mineral-bridge-api' }

---

## 4. Flow Coverage (from Product Doc)

| Flow | DB | Backend | Notes |
|------|----|---------|--------|
| Splash → Onboarding → Sign On (phone, OTP, location) | users, otps, profiles | auth (send-otp, verify-otp, register-or-login with location) | Complete |
| Profile setup → KYC (ID type, upload, live bio, processing, success) | kyc_documents, profiles | kyc (documents, submit, status) + users/me | Complete |
| Home: header, market insights, quick actions, activity | market_insights, activity_feed | market-insights, activity, users/me | Complete |
| Buy: landing → detail → quantity → delivery → payment → tracking → success | minerals, orders, addresses | minerals (list + :id), orders, addresses | Complete |
| Sell: categories → list → intro → details → logistics → settlement → success | minerals, listings, addresses | minerals, listings, addresses | Complete |
| Artisanal: eligibility → 7-step profile → dashboard (safety, equipment, cert, incident, sell) | artisanal_profiles, safety_training, equipment_requests, certifications, incident_reports | artisanal/* | Complete |
| Profile: personal info, KYC status, saved addresses | profiles, kyc_documents, addresses | users/me, kyc/status, addresses CRUD + DELETE | Complete |
| Profile: artisanal mining profile | artisanal_profiles | artisanal/profile GET/POST | Complete |
| Profile: payment methods | payment_methods | payment-methods GET/POST/DELETE | Complete |
| Profile: order history | orders | orders GET (type=buy|sell), GET/:id | Complete |
| Profile: transaction history | transactions | transactions GET, GET/:id | Complete |
| Profile: security & privacy (2FA, active sessions) | profiles (twoFactorEnabled), user_sessions | users/me/security, users/me/sessions | Complete |
| Profile: app settings | app_settings | app-settings GET/PATCH | Complete |
| Profile: help & support (FAQs, contact) | support_requests | help/faqs, help/categories, help/contact | Complete |
| Logout | — | Client drops token; optional DELETE session | Client-side |

---

## 5. Gaps / Optional Improvements

1. **DB_SCHEMA.md** – Add `activity_feed`, `support_requests`, `user_sessions`, and `profiles.twoFactorEnabled` for full doc coverage.
2. **ensure-indexes.js** – Optionally add indexes for `activity_feed`, `user_sessions`, `support_requests`, `market_insights` for higher load.
3. **notifications** – Schema doc mentions `read`; implementation uses `readAt`. Code is consistent; doc can be aligned.
4. **Invoice PDF** – Transaction has `invoiceUrl`; actual PDF generation is not implemented (frontend can show “Download” when URL exists or integrate a separate service later).
5. **KYC verified status** – Backend can set `kycStatus` to `verified` via profile or a small admin/verification endpoint when review is done (not required for app flows).

---

## 6. Conclusion

**DB:** Complete for all modules. 20 collections, schema documented in `DB_SCHEMA.md`, indexes in `ensure-indexes.js`, optional seeds for minerals and market_insights.

**Backend:** Complete for all modules. 55+ endpoints across 14 route files, covering auth, onboarding, KYC, Home, Buy, Sell, Profile/More, Artisanal, Help, and Security. New routes (market-insights, activity, help, users/me/security, users/me/sessions, addresses DELETE, minerals/:id, notifications POST/PATCH read) are wired in `server.js`.

You can build the full React Native (Expo) app against this backend and DB as-is.
