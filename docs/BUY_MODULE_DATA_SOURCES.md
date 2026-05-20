# Buy Module – Data Sources & Endpoints

All data shown in the Buy module comes from the **dashboard** (admin-editable) or the **app** (user/order data). These endpoints are ready so the app can fetch everything from the API; the dashboard can manage content and catalog.

---

## 1. Content (copy, images, options) – **Dashboard**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/content/buy` | GET | No | Full Buy module content: banner image URL, search placeholder, step labels, delivery option text, form labels, quantity options (mineral types, buyer categories, units, presets), lock policy text, payment defaults, order-confirmed/success/tracking copy. App uses this so all text and media can be driven from the dashboard. |
| `/api/content/buy` | PATCH | Yes | Update Buy content (partial merge). Dashboard uses this to edit copy, image URLs, and options. |

**Response shape (GET)** includes:
- `bannerImageUrl`, `searchPlaceholder`
- `quantityStep`: `stepLabel`, `stepSublabel`, `mineralTypeOptions[]`, `buyerCategoryOptions[]`, `unitOptions[]`, `presetQuantities[]`, `lockPolicyText`, `defaultStock`
- `deliveryStep`: `stepLabel`, `stepSublabel`, delivery titles/subtitles, vault price, `complianceText`, form labels, button text
- `paymentStep`: `defaultTransport`, `feePercent`
- `orderConfirmed`, `success`, `tracking`: titles, subtitles, optional image URLs

---

## 2. Minerals (catalog, images, pricing) – **Dashboard**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/minerals` | GET | No | List all minerals for Buy list. Returns `id`, `name`, `category`, `image` (URL), `price`/`priceDisplay`, `description`, `origin`, `purity`, `unit`. Optional `?category=...`. |
| `/api/minerals/:id` | GET | No | Single mineral for detail screen and quantity/payment steps. Same fields; dashboard can set `image`/`imageUrl` for hero and cards. |
| `/api/minerals` | POST | Yes | Create mineral (dashboard). Body: `name`, `category`, `imageUrl`/`image`, `priceDisplay`/`price`, `description`, `origin`, `purity`, `unit`, etc. |
| `/api/minerals/:id` | PATCH | Yes | Update mineral (dashboard). Same fields. |

**Images**: Store image URLs in `image` or `imageUrl`; dashboard can upload assets elsewhere and set these URLs. App uses them in Buy list, Mineral Detail, and Quantity screens.

---

## 3. Addresses (delivery locations) – **App (user data)**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/addresses` | GET | Yes | User’s saved addresses for Delivery step. |
| `/api/addresses` | POST | Yes | Save new address from Delivery form. |
| `/api/addresses/:id` | PATCH | Yes | Update address. |

---

## 4. Orders (place order, confirm, track) – **App (user data)**

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/orders` | POST | Yes | Place order. Body: `mineralId`, `mineralName`, `quantity`, `amount`, `addressId`, `deliveryDetails`, `type`, etc. |
| `/api/orders/:id` | GET | Yes | Single order for Order Confirmed and Tracking screens. |

---

## Summary

- **Dashboard-driven**: Buy **content** (GET/PATCH `/api/content/buy`) and **minerals** (GET/POST/PATCH `/api/minerals`). Text, images, and options for the Buy flow come from here.
- **App/user-driven**: **Addresses** and **orders**. User-specific data and actions.

The app can be wired to GET `/api/content/buy` on load (or per module) and use the response for all labels, step text, banner image, quantity/delivery options, and optional image URLs. Minerals and orders endpoints already return the fields needed for the Buy module (including images and text).
