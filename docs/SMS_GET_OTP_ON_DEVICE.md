# Get OTP via SMS on your device (India)

Your backend and Spear UC both return **success**, but the SMS doesn’t reach the phone. In India that usually means **DLT template or route** is wrong. Fix it as below.

---

## 1. Log the exact message (already in code)

After you call **Send OTP**, the backend terminal will show something like:

```text
[OTP] Sending SMS to 9342788834 | message: Your OTP is 847291. Valid 30 sec.
[OTP] Gateway response 200 OK {"status":"success",...}
```

The **message** line is the **exact text** sent to the gateway. It must match your **DLT-approved template** character-for-character (only the 6-digit OTP can change). If it doesn’t match, operators will drop the SMS.

---

## 2. Set the message to match your DLT template

You already have in `backend/.env`:

```env
OTP_SMS_MESSAGE=Your OTP is %s. Valid 30 sec.
```

- **%s** is replaced by the 6-digit OTP.
- The rest of the string must be **exactly** what is approved on DLT for sender **EVOLGN** and the template linked to `t_id=1707166841244742343`.

**What to do:**

1. **Get the exact approved template** from Spear UC (or your DLT portal).  
   It might look like one of these (your provider will give the real one):
   - `Your OTP is XXXXXX. Valid 30 sec.`
   - `Your OTP for verification is XXXXXX. -EVOLGN`
   - `OTP is XXXXXX. Do not share. -EVOLGN`

2. **Convert it to `OTP_SMS_MESSAGE`:**  
   Replace the OTP placeholder (XXXXXX / {#var#} / etc.) with **`%s`**, and set that in `.env`.  
   Examples:
   - If approved template is: `Your OTP is XXXXXX. Valid 30 sec.`  
     → `OTP_SMS_MESSAGE=Your OTP is %s. Valid 30 sec.`
   - If approved template is: `Your OTP for verification is XXXXXX. -EVOLGN`  
     → `OTP_SMS_MESSAGE=Your OTP for verification is %s. -EVOLGN`

3. **Restart the backend** after changing `.env`.

4. Call **Send OTP** again and check the terminal: the logged **message** must match the DLT template exactly (only the digits differ).

---

## 3. Confirm with Spear UC

Ask them:

1. **Delivery for your campaign**  
   “Please give delivery status for campaign_id XXXXX” (use the `campaign_id` from your backend log, e.g. `35936724`).  
   If they say “failed” or “rejected”, ask the **reason** (e.g. template mismatch, sender not approved).

2. **Transactional route**  
   “Is this SMS going as **transactional** (OTP) or **promotional**?”  
   OTP must go as **transactional**. If it’s going as “Campaign”/promotional, ask them to switch to the transactional route and the correct DLT template for OTP.

3. **Exact DLT template for OTP**  
   “What is the **exact** DLT-approved content template for OTP linked to sender EVOLGN and t_id 1707166841244742343?”  
   Set `OTP_SMS_MESSAGE` to that text with `%s` in place of the OTP.

4. **Sender and template approval**  
   “Confirm EVOLGN is DLT-registered and the OTP template is approved and linked to EVOLGN.”

---

## 4. Optional: try a common DLT-style template

If Spear UC doesn’t reply quickly, you can try a message that many providers have approved (replace with your actual approved text once they give it):

In `backend/.env`:

```env
# Example: short OTP line (match what your provider has approved)
OTP_SMS_MESSAGE=Your OTP is %s. -EVOLGN
```

Restart, send OTP again, and check the terminal log. If the SMS still doesn’t arrive, the template is still not approved or not matched; you’ll need the **exact** template from Spear UC.

---

## 5. Summary

| Step | Action |
|------|--------|
| 1 | Check backend log for the **exact message** sent (after “Sending SMS to … \| message:”). |
| 2 | Get from Spear UC the **exact DLT-approved template** for your OTP. |
| 3 | Set **OTP_SMS_MESSAGE** in `backend/.env` to that template, using **%s** for the OTP. |
| 4 | Restart backend and test again; confirm in the log that the message matches the template. |
| 5 | Ask Spear UC for **delivery status** of your **campaign_id** and confirm **transactional** route and **EVOLGN + template** DLT approval. |

Until the message matches the DLT template and goes on the correct (transactional) route, the gateway can still return success but the SMS will not reach your device.
