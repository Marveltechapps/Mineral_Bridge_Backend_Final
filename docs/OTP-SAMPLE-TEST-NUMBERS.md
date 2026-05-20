# Sample African test numbers for OTP (dev/test only)

Use these **10 numbers with country code** to test login without real SMS.  
**OTP for all: `1234`**

| Country      | Country code | Phone (national) | Full number     | Use in app                         |
|--------------|--------------|------------------|-----------------|------------------------------------|
| Ghana        | +233         | 201234567        | +233 201234567  | Select Ghana, enter 201234567      |
| Kenya        | +254         | 712345678        | +254 712345678  | Select Kenya, enter 712345678      |
| Tanzania     | +255         | 712345678        | +255 712345678  | Select Tanzania, enter 712345678   |
| Nigeria      | +234         | 8012345678       | +234 8012345678 | Select Nigeria, enter 8012345678   |
| South Africa | +27          | 821234567        | +27 821234567   | Select South Africa, enter 821234567 |
| Uganda       | +256         | 712345678        | +256 712345678  | Select Uganda, enter 712345678     |
| Zambia       | +260         | 971234567        | +260 971234567  | Select Zambia, enter 971234567     |
| Zimbabwe     | +263         | 712345678        | +263 712345678  | Select Zimbabwe, enter 712345678   |
| Senegal      | +221         | 701234567        | +221 701234567  | Select Senegal, enter 701234567    |
| Ethiopia     | +251         | 911234567        | +251 911234567  | Select Ethiopia, enter 911234567   |

- **Send OTP:** `POST /api/auth/send-otp` with `{ "countryCode": "+233", "phone": "201234567" }` (or any country code + phone from the table).
- **Verify OTP:** `POST /api/auth/verify-otp` with `{ "countryCode": "+233", "phone": "201234567", "otp": "1234" }`.
- In **non-production**, the send-otp response includes `otp` in the JSON so you can copy it.

These are the only test numbers; the previous env-based options (`OTP_DEV_ANY_NUMBER`, `OTP_TEST_PHONE`, `OTP_TEST_OTP`) are no longer used.
