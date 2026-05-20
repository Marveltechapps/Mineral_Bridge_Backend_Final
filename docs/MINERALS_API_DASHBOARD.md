# Minerals API – Buy module & dashboard

All data shown on the **Buy** flow (mineral list and mineral detail) comes from the backend. The dashboard or admin can populate the `minerals` collection; the app reads it via these endpoints.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/minerals` | List all minerals (optional `?category=Precious Metals`) |
| GET | `/api/minerals/:id` | Single mineral by `_id` or `id` or `name` (for detail screen) |

No auth required (public marketplace).

## Response shape (list and detail)

Each mineral object returned by the API includes:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique id (from `_id` or `id`) |
| `name` | string | e.g. "Diamonds", "Gold" |
| `category` | string | e.g. "Precious Metals" |
| `image` | string | URL for hero/card image (from `imageUrl` or `image` in DB) |
| `price` | string | Display price (from `priceDisplay` or `price`) |
| `description` | string | Product description / institutional narrative |
| `origin` | string | e.g. "Ghana, Tarkwa" |
| `purity` | string | e.g. "99.9% Certified" |
| `unit` | string | Optional |

**Optional (for future use – Due Diligence / Market Insights):**

| Field | Type | Description |
|-------|------|-------------|
| `blockchainProof` | object/string | When set, returned by API for Due Diligence UI |
| `marketInsights` | object/string | When set, returned by API for Market Insights UI |
| `availability` | string | When set, returned (e.g. "immediate allocation"); app may hide this line per product design |

The detail screen currently **hides** Due Diligence (Blockchain Proof, Market Insights) and the availability line; when you add them later, the API already returns these fields if present in the document.

## Dashboard / DB

- **Collection:** `minerals`
- **Fields to set:** `name`, `category`, `image` or `imageUrl`, `price` or `priceDisplay`, `description`, `origin`, `purity`, `unit`. Optionally `blockchainProof`, `marketInsights`, `availability` for future UI.
- **Seed:** `backend/seed/seed.js` can insert sample minerals; run as needed.
