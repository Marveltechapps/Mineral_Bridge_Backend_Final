# Mineral Bridge – DB schema (all modules)

Collections and main fields. MongoDB is schemaless; this documents intended shape for APIs and frontend.

---

## Auth & onboarding

- **users** – `phone` (unique), `countryCode`, `name`, `email`, `location` (optional `{ lat, lng }` or `grantedAt`), `createdAt`
- **otps** – `key` (e.g. `+1|1234567890`), `otp`, `expiresAt` (TTL index for cleanup)
- **profiles** – `userId` (unique), `kycStatus`, `avatarUrl`, `updatedAt`

---

## KYC

- **kyc_documents** – `userId` (unique), `idType` (National ID / Passport / Corporate License), `frontUrl`, `backUrl`, `selfieUrl`, `status`, `submittedAt`, `digitalIdentityHash`, `createdAt`, `updatedAt`

---

## Buy flow

- **orders** – `userId`, `orderId` (e.g. MB-ORDER-88219), `mineralId`, `mineralName`, `quantity`, `amount`, `addressId`, `type` (buy|sell), `status` (Submitted | Contact | Sample/Price | Logistics | Complete), `mineralType`, `buyerCategory`, `deliveryMethod`, `subtotal`, `transportFee`, `feePercent`, `totalDue`, `escrowStatus`, `timeline` (array of `{ step, label, at }`), `createdAt`, `updatedAt`
- **addresses** – `userId`, `label`, `facilityName`, `street`, `city`, `state`, `country`, `postalCode`, `phone`, `institutionalPermitNumber`, `proofOfFacilityUrl`, `regulatoryCompliance`, `isDefault`, `createdAt`

---

## Sell flow (Dashboard ↔ App)

Data for sell module screens: app creates listings/orders/addresses; dashboard reads all and updates status/content; minerals and sell content are dashboard-driven, app reads.

- **listings** – `userId`, `mineralId`, `category`, `quantity`, `unit`, `type` (raw|semi-processed|processed), `buyerType`, `origin`, `photos[]`, `documents[]`, `extractionDate` (ISO date), `originYear`, `targetBuyerType`, `verificationStatus`, `assayRequired`, `aiEstimatedPayout`, `escrowStatus`, `pickupMethod`, `pickupAddressId`, `sampleTestRequired`, `billOfSaleUrl`, `status` (draft|submitted|contact|sample_price|logistics|complete), `createdAt`, `updatedAt`
- **orders** – `userId`, `orderId`, `listingId` (when type=sell), `mineralId`, `mineralName`, `quantity`, `amount`, `addressId`, `type` (buy|sell), `status`, `mineralType`, `buyerCategory`, `deliveryMethod`, `subtotal`, `transportFee`, `feePercent`, `totalDue`, `escrowStatus`, `timeline[]`, `createdAt`, `updatedAt`
- **addresses** – (used by sell pickup location) `userId`, `label`, `facilityName`, `street`, `city`, `state` (or stateRegion), `country`, `postalCode`, `phone`, `email`, `countryCode`, `institutionalPermitNumber`, `proofOfFacilityUrl`, `regulatoryCompliance`, `isDefault`, `createdAt`
- **minerals** – (dashboard CRUD, app GET) `id`, `name`, `category`, `image`/`imageUrl`, `price`/`priceDisplay`, `description`, `origin`, `purity`, `unit`
- **content** – key `sell`: dashboard-driven copy/options for sell module (same pattern as `buy`). `key`, `value`, `updatedAt`

---

## Artisanal / Mining (Home → Access → Steps 1–7 → Success)

Data flows app ↔ dashboard via GET/POST `/api/artisanal/profile`; both use the same profile.

- **artisanal_profiles** – `userId` (unique), `minerType`, `siteName`, `gps`, `district`, `region` (stateProvince), `country`, `countryCode`, `village`, `miningAreaType`, `mineralType`, `method` (miningMethod), `yearsExperience`, `workers` (numberOfWorkers), `monthlyOutput` (estimatedMonthlyOutput), `outputUnit`, `equipment[]`, `licenseNumber`, `licenseUrl` (licenseUri), `licenseName`, `childLaborFree` (childLaborProhibition), `safePractices`, `compliance`, `ethicalAnswers`, `laborPledgeSigned` (laborPledge), `completionScore`, `minerStatus`, `blockchainAnchor`, `eligibilityVerifiedAt`, `status`, `createdAt`, `updatedAt`
- **safety_training** – `userId` (unique), `modules` (array of `{ id, name, status: completed|in_progress|locked }`), `updatedAt`
- **equipment_requests** – `userId`, `itemName`, `status` (queued|approved|delivered), `requestedAt`, `tier`, `creditRatio`
- **certifications** – `userId` (unique), `tier`, `blockchainHash`, `gpsAnchored`, `l1Accredited`, `pdfUrl`, `updatedAt`
- **incident_reports** – `userId`, `category` (Safety|Injury|Environmental), `description`, `photoUrl`, `status`, `dispatchedAt`, `createdAt`

---

## More / Profile

- **payment_methods** – `userId`, `type` (Bank|Crypto), Bank: `holderName`, `bankName`, `accountNumber`, `swift`; Crypto: `label`, `network`, `address`; `verified`, `createdAt`
- **transactions** – `userId`, `orderId`, `type` (Buy|Sell), `itemName`, `date`, `status`, `subtotal`, `serviceFee`, `networkFee`, `total`, `invoiceUrl`, `createdAt`
- **app_settings** – `userId` (unique), `language`, `currency`, `theme`, `priceAlerts`, `auctionUpdates`, `miningStatus`, `showMarketPredictions`, `updatedAt`

---

## Other

- **notifications** – `userId`, `title`, `body`, `read`, `type`, `data`, `createdAt`
- **market_insights** (optional) – `slug`, `label`, `value`, `updatedAt`
- **minerals** – catalog (`id`, `name`, `category`, `image`, `price`, etc.)
- **content** – keyed docs for module content: `buy`, `sell`. Each: `key`, `value` (object), `updatedAt`

---

## Indexes

Run `npm run ensure-indexes` to create indexes for `userId`, `createdAt`, unique constraints, and TTL on `otps.expiresAt`.
