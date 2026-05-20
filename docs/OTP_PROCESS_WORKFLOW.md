# OTP Process Workflow ? Mineral Bridge

Realtime **6-digit OTP via SMS** for sign-in. This document is the project spec: config location, endpoints, and flow so **send OTP** works.

---

## 1. Purpose

- **Send OTP** ? backend generates a 6-digit code, sends it via SMS (using gateway in config), stores it with **60-second** expiry. Response includes `otp` for testing.
- **Verify OTP** ? user enters the code (from SMS or from the send-otp response); backend validates and returns a JWT.
- **Resend OTP** ? same number gets a new 6-digit code via SMS.

Config (and optional env) control the SMS gateway. The backend loads config from **`backend/config.json`** or **`backend/config/config.json`**.

---

## 2. Config (SMS gateway)

OTP sending uses the **smsvendor** URL. The backend loads it in this order:

1. **Environment:** `SMS_VENDOR_URL` or `smsvendor` in `backend/.env`
2. **File:** `backend/config.json` or **`backend/config/config.json`** (must contain valid JSON with `smsvendor` key)

### Config file: `backend/config/config.json` (or `backend/config.json`)

| Key        | Used for OTP | Description |
|------------|--------------|-------------|
| `smsvendor` | Yes         | Full SMS gateway URL. Must end with `&` so the backend can append `to_mobileno=` and `sms_text=`. |

**Example structure (do not commit real secrets):**

```json
{
  "smsvendor": "https://your-sms-gateway.com/api?type=smsquicksend&user=YOUR_USER&pass=YOUR_PASS&sender=SENDER_ID&t_id=TEMPLATE_ID&"
}
```

- **This project:** Config is in [backend/config/config.json](../config/config.json). It must be **valid JSON** (single object).
- **JWT:** Set `JWT_SECRET` in `backend/.env`. Token is issued after successful OTP verification (see [backend/routes/auth.js](../routes/auth.js)).

---

## 3. Flow (realtime SMS)

```mermaid
sequenceDiagram
    participant User
    participant App
    participant Backend
    participant SMS
    participant DB

    User->>App: Enter phone (countryCode + phone)
    App->>Backend: POST /api/auth/send-otp { countryCode, phone }
    Backend->>Backend: Generate 6-digit OTP, expiry 60s
    Backend->>SMS: GET smsvendor URL (to_mobileno, sms_text with OTP)
    SMS-->>User: SMS with OTP
    SMS-->>Backend: success/fail
    Backend->>DB: Save otps (key, otp, expiresAt)
    Backend-->>App: 200 OTP sent / 400 or 500

    User->>App: Enter 6-digit OTP
    App->>Backend: POST /api/auth/verify-otp { countryCode, phone, otp }
    Backend->>DB: Find otps by key, check match and expiry
    Backend->>DB: Delete OTP; find or create user
    Backend->>Backend: Generate JWT
    Backend-->>App: 200 { token, userId, user, ... }

    opt Resend
        User->>App: Resend OTP
        App->>Backend: POST /api/auth/resend-otp { countryCode, phone }
        Backend->>Backend: New 6-digit OTP, 60s expiry
        Backend->>SMS: Send SMS
        Backend->>DB: Update otps
        Backend-->>App: 200 OTP resent / 400 or 500
    end
```

---

## 4. Data (OTP)

- **Collection:** `otps`
  - `key`: string, e.g. `"+91|9876543210"` (countryCode + normalized digits).
  - `otp`: string, 6-digit code.
  - `expiresAt`: date, 60 seconds from generation.
- After successful verify, the OTP document is deleted. User is stored in **users** ([backend/routes/auth.js](../routes/auth.js)).

---

## 5. API (this project)

Base path: **`/api/auth`**. All bodies **JSON**.

### 5.1 Send OTP

| Item   | Value |
|--------|--------|
| Method | `POST` |
| Path   | `/api/auth/send-otp` |
| Body   | `{ "countryCode": "+91", "phone": "9876543210" }` |
| Notes  | `phone` = digits only, min length 9. |

**Responses:**  
200 ? `{ "success": true, "message": "OTP sent successfully", "otp": "123456", "expiresInSeconds": 60, "smsGatewayConfigured", "smsSent" }`  
400 ? invalid/missing phone  
500 ? SMS failed or server error  

### 5.2 Verify OTP

| Item   | Value |
|--------|--------|
| Method | `POST` |
| Path   | `/api/auth/verify-otp` |
| Body   | `{ "countryCode": "+91", "phone": "9876543210", "otp": "123456" }` |

**Responses:**  
200 ? `{ "message": "OTP verified successfully", "token": "JWT...", "userId", "user", "isVerified", "name" }`  
400 ? no OTP, expired, or incorrect OTP  
500 ? server error  

### 5.3 Resend OTP

| Item   | Value |
|--------|--------|
| Method | `POST` |
| Path   | `/api/auth/resend-otp` |
| Body   | `{ "countryCode": "+91", "phone": "9876543210" }` |

**Responses:**  
200 ? `{ "success": true, "message": "OTP resent successfully", "otp", "expiresInSeconds": 60 }`  
400 ? phone required or user not found (send-otp first)  
500 ? SMS failed or server error  

---

## 6. Business rules (this project)

- **OTP:** 6-digit numeric, 100000?999999. `Math.floor(100000 + Math.random() * 900000).toString()`.
- **Expiry:** 60 seconds. Stored as `expiresAt` in `otps`.
- **SMS:** HTTP GET to `{smsvendor}to_mobileno={number}&sms_text={encoded message}`. Message from `OTP_SMS_MESSAGE` in `.env` (use `%s` for OTP) or default. Success when response contains `"success"` or `"sent"`.
- **Verify:** Key = `getOtpKey(countryCode, phone)` (normalized). Compare `doc.otp` with entered OTP; reject if expired. On success: delete OTP doc, find/create user, issue JWT.

---

## 7. Project files

| File | Role |
|------|------|
| [backend/config/config.json](../config/config.json) | SMS gateway URL (`smsvendor`). **Use this for send OTP.** |
| [backend/config.json](../config.json) | Alternative config path (if present). |
| [backend/routes/auth.js](../routes/auth.js) | Implements send-otp, verify-otp, resend-otp; reads config and env. |
| [backend/.env](../.env) | Optional: `SMS_VENDOR_URL`, `OTP_SMS_MESSAGE`, `OTP_TEST_PHONE`, `OTP_TEST_OTP`. |

---

## 8. Realtime OTP on device

- **Config is correct** when the backend loads `smsvendor` from **`backend/config/config.json`** (or `backend/config.json`). On startup you should see: `[OTP] SMS gateway: configured (config.json)`.
- **Backend behaviour:** When you call `POST /api/auth/send-otp`, the backend calls the SMS gateway and returns 200 with `otp` in the response. In the terminal you should see: `[OTP] Sending SMS to ...` and `[OTP] Gateway response 200 OK`.
- **If the gateway returns success but SMS does not reach the phone (India):** The cause is **DLT/delivery** ? template or sender not approved, or wrong route. Your .env and config are not at fault. To get realtime SMS on the device, follow section 9 below.

---

## 9. Get SMS on the phone (India / Spear UC)

1. **Contact Spear UC** (your SMS provider) with:
   - The **`campaign_id`** from your backend logs (shown when the gateway responds).
   - **Sender:** EVOLGN  
   - **Template id:** 1707166841244742343  
   - **Request:** Confirm DLT approval, use the **transactional** route, and provide the **exact DLT-approved template text**.

2. **Set the exact template in .env:**  
   In `backend/.env`, add or update:
   ```env
   OTP_SMS_MESSAGE=Your exact DLT-approved text here. Use %s where the OTP goes.
   ```
   Example: `OTP_SMS_MESSAGE=Your OTP for verification is %s. - EVOLGN`  
   Restart the backend after changing `.env`.

3. **Re-test:** Call `POST /api/auth/send-otp` again. Once DLT and route are fixed by Spear UC, realtime OTP via SMS will work; no further code changes are needed.

---

## 10. Send OTP ? quick steps

1. Ensure **`backend/config/config.json`** exists and contains valid JSON with **`smsvendor`** (full URL ending with `&`).
2. Restart the backend so it loads config.
3. Call **`POST /api/auth/send-otp`** with body: `{ "countryCode": "+91", "phone": "9876543210" }`.
4. Backend will call the SMS gateway and return 200 with `otp` in the response. User can enter that code (or the one from SMS if delivered) and call **`POST /api/auth/verify-otp`** with `countryCode`, `phone`, and `otp` to get the JWT.

If SMS does not reach the phone (India), see section 9.