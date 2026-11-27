# Gold scheme MVP (web)

Two journeys in one small site: **customer** and **jeweller**. No company, no app store, no paid APIs.

## Run
```
npm install
npm run dev        # demo: mock rates, DEV clock buttons, OTP 123456
npm start          # live gold/silver rates (needs internet), no dev buttons
```
Open http://localhost:3000. To try it on your phone, use the laptop's LAN address on the same Wi-Fi, or `npx cloudflared tunnel --url http://localhost:3000`.
`npm test` runs 18 tests (rates, PAN/GSTIN, ledger, weekend pricing, auto-confirm, maturity).

## Try it
1. Jeweller: log in (any 10-digit number starting 6-9, OTP 123456), create shop, Setup > tick checks > Go live. Note the 6-letter shop code.
2. Customer (another browser/incognito): log in, name + DOB + PAN, enter shop code, create plan, Pay now.
3. Pay with a real UPI app for Rs 100 or fake it: enter any 12-digit UTR. Jeweller taps Received (or posts a bank SMS to the hook).
4. DEV buttons move the clock +335 days to test maturity/redeem, +365 for the refund.

## Fixed scheme options (lib/schemes.js)
Metals: Gold 24K, 22K, 18K, Silver 999 (separate gram balances). Frequency: daily, weekly, monthly, one-time.
Amount Rs 100-2,000 per payment (presets 500/1000/1500/2000; daily 100/200/500). 11-month tenure, redeem from month 11, refund by day 364.
Rs 5,000 per user per day. No cancellation after payment.

## Codes
Permanent 6-char shop code (no 0/O/1/I/L) + optional single-use 8-char invite (7 days). 5 wrong tries then a 15-minute lock. Optional "approve each customer" switch.
Customers can only join through a code, so they cannot browse jewellers.

## Rates (lib/rates.js)
24K/g = XAU USD/oz / 31.1035 x USD/INR x (1 + 15% duty). 22K x0.916, 18K x0.75, silver 999 uses XAG. Customer price = that x (1 + calibration) x (1 + your margin) x 1.03 GST.
Feeds: gold-api.com (XAU, XAG) and open.er-api.com (USD/INR, fallback frankfurter). Polled every 60s on the server. Quoting halts if data is stale (10 min), outside sanity bounds, or jumps >3% in one refresh.
The calibration box lets the jeweller type today's board rate and the system matches it (rejects typos beyond +-3% change / 8% total).
Market hours Mon-Fri 9:00-23:30 IST (MARKET_HOLIDAYS, MCX_CLOSE_MIN env). Paid while closed => priced at first rate after reopening.

## Payment confirmation, no manual work
UPI intent has no callback, so the money is confirmed from the jeweller's bank credit SMS:
shop phone forwards bank SMS to `/api/hooks/bank-sms/<token>` (URL in Setup) -> parsed -> matched on UTR + exact amount -> ledger credited.
Works in either order (SMS first or customer UTR first). Mismatch or no SMS => the jeweller sees it in "Payments to confirm".

## Ledger
Append-only, hash-chained per jeweller; every row stores UTR, amount, rate, rate source/time, grams, running balance. Jeweller > Ledger verifies the chain.

## Before real customers' money (not needed for your own-shop trial)
Real OTP (WhatsApp), PAN verification API (PAN_PROVIDER, lib/kyc.js), UPI AutoPay via a gateway, privacy policy/terms, company, lawyer/CA review, hosting + backups, set DATA_KEY.
