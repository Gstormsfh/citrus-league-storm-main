# Apple Developer — Citrus Fantasy Sports Organization Signup Guide
*(links verified live against Apple's pages, Aug 24 2026)*

**Golden rule: enroll as ORGANIZATION, never Individual.** Individual accounts publish with your personal legal name — "Garrett Storms" — as the App Store seller, and converting later is a weeks-long process. Organization accounts show **the company's legal name** as the seller.

Apple's four organization requirements (from the enrollment page itself):
1. **Legal binding authority** — you enroll as the Account Holder with authority to bind the company (owner/founder qualifies — that's you).
2. **A legal entity** — your registered Canadian corporation qualifies. Apple does NOT accept DBAs, trade names, or branches; the name you enter must match the incorporation exactly, punctuation included ("Inc."/"Ltd." matters). Whatever is registered is what appears as the seller.
3. **D-U-N-S number** — nine-digit D&B identifier.
4. **A functional public website on a domain associated with the org** — citrusfantasysports.com ✓ (make sure a contact/about page mentions the company name).

---

## Step-by-step (60–90 minutes of your time, then Apple's clock)

**STEP 1 — D-U-N-S lookup (do first; decides your timeline)**
→ https://developer.apple.com/enroll/duns-lookup/
Search the exact legal entity name + address. Registered Canadian corporations often already have a D-U-N-S — if found, it's emailed to you and your biggest delay is gone. If NOT found, submit the request on that same page — **free through Apple's tool** (ignore paid D&B upsell emails); issuance up to 5 business days + up to 2 more to reach Apple's systems.

**STEP 2 — Company Apple ID**
→ https://account.apple.com
Create a fresh Apple ID on your citrus email (e.g. dev@ / garrett@citrusfantasysports.com — a company-domain email also smooths verification). Then enable **two-factor authentication** on it (Settings on an Apple device, or the site) — enrollment requires 2FA.

**STEP 3 — Enroll (choose ONE path)**
- **Web:** https://developer.apple.com/programs/enroll/ → sign in with the company Apple ID → entity type **Company / Organization** → enter legal entity name (exact), D-U-N-S, website, your role (Owner/Founder), and a **corporate phone number that gets answered** — Apple sometimes verifies by phoning the number D&B has on file.
- **iPhone (often faster):** App Store → download **"Apple Developer"** app → Account tab → Enroll → same organization flow with in-app identity verification. Reference: https://developer.apple.com/support/app-account/

**STEP 4 — Pay** USD $99/year when prompted at approval.

**STEP 5 — If "pending" for more than ~48 hours**
→ https://developer.apple.com/contact/ → phone support → ask to **expedite**, citing your launch. This genuinely moves queues. Common silent blockers: entity-name punctuation mismatch vs D&B records, or the listed phone ringing out.

**STEP 6 — The moment it activates**
1. https://appstoreconnect.apple.com → Business/Agreements → accept the **free app** agreement (no banking/tax forms needed for a free app).
2. Certificates/IDs: register the App ID `com.citrussports.app`, enable **Sign In with Apple** + **Push Notifications** capabilities, create the SIWA **Services ID** + key → I hand you the exact Supabase values same-hour (task #192 has the full click-path).
3. Xcode → sign in with the account → archive → **TestFlight** → your 20-minute device smoke (both OAuth round trips, push prompt, throwaway-account deletion).
4. App Store Connect listing: screenshots (6.7" iPhone required; iPad 13" since the app supports iPad), description, keywords, support URL, privacy policy URL, **App Privacy** labels (collects: email/user ID/app interactions, linked to identity, not used for tracking), and a **demo reviewer account** in Review Notes joined to a populated league.
5. Submit. Review is typically 24–48h.

## Timeline honestly stated
- D-U-N-S already exists: **enrollment verification is the only wait — commonly 2–5 business days** (org verification can stretch longer; the expedite call is your lever).
- D-U-N-S needed: add up to ~5–7 business days in front.
- Everything in Step 6 is same-day once the account is live — the app side is finished and audited.

## While Apple's clock runs (parallel work, zero wasted days)
- Google Play org account + Android closed test (scaffold is in the repo; `ANDROID_PLAY_PATH.md`).
- Screenshots + listing copy (I can draft the listing text on request).
- Nano Banana art batch (`NANO_BANANA_PROMPTS.md`).
