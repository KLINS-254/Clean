# SAMRYC DISHES — Hotel POS

A React + Vite point-of-sale starter for SAMRYC DISHES, designed for GitHub and Vercel with Supabase Auth/PostgreSQL. It includes a mobile-first POS interface, role-aware navigation, menu catalogue, order and kitchen views, payment entry, printable customer receipts, and CSV order exports.

## Important status and scope

This repository is a **functional starter**, not yet a fully audited production POS. It persists data in Supabase and has RLS policies, but before processing real money you must finish the transactional payment/order RPC, test every role with separate accounts, and harden inventory deduction and cancellation/refund workflows. The browser-based M-Pesa form records a cashier-entered reference; it does **not** confirm payment with Safaricom. Do not use it to claim a verified M-Pesa transaction.

Some requested advanced functions are intentionally staged: owner staff provisioning UI, full business settings editor, ingredient recipes, stock movement adjustment UI, refund/cancellation workflow, PDF export, shift closeout, charts, and Daraja STK Push are not implemented in this initial release. The receipt's Download button currently downloads a text copy; use Print and the browser's Save as PDF option for a PDF. Receipt address and phone placeholders should be replaced by settings integration before use.

## Stack

- React 18 + Vite
- Supabase Auth and PostgreSQL with RLS
- Vercel static hosting
- Browser print stylesheet for thermal printers

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env.local`.
3. Create a Supabase project and copy its project URL and anon/public key into `.env.local`.
4. In Supabase → SQL Editor, run `supabase/schema.sql`.
5. Create the first owner using Supabase Authentication → Users → Add user. Use a strong unique password.
6. Copy that user's UUID. In SQL Editor, run the following after replacing the values:

```sql
insert into public.profiles (id, full_name, username, role, active)
values ('AUTH-USER-UUID-HERE', 'Hotel Owner', 'owner', 'owner', true);
```

Never expose a service-role key in `.env.local`, frontend code, or GitHub. Only the anon key belongs in the Vite frontend.

7. Install and run:

```bash
npm install
npm run dev
```

## Add staff securely

1. In Supabase Authentication, create a separate user for each waiter/cashier/kitchen account, with a unique email and strong temporary password.
2. Insert the corresponding profile with that exact auth user UUID. Example:

```sql
insert into public.profiles (id, full_name, username, role, active)
values
('WAITER-AUTH-UUID', 'Waiter 1', 'waiter1', 'waiter', true),
('CASHIER-AUTH-UUID', 'Cashier', 'cashier', 'cashier', true);
```

3. Give staff their own credentials and have them change temporary passwords. Deactivate staff by setting `active = false`; this prevents normal access through the RLS helper functions. Remove access in Supabase Auth as well when employment ends.
4. The role dropdown is a consistency check only. It does not grant permissions.

## GitHub and Vercel deployment

1. Create a new GitHub repository named `samryc-dishes-pos`.
2. Upload the project files or push the folder using Git.
3. Create/configure Supabase and run `supabase/schema.sql`.
4. In Vercel, choose **Add New → Project**, import the GitHub repository, and keep the Vite default build command `npm run build` and output directory `dist`.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Vercel Project → Settings → Environment Variables for Production, Preview, and Development as needed.
6. Deploy. After changing environment variables, redeploy the application.
7. Sign in with the owner account and test staff roles using separate browser sessions/devices.

## Receipt printing

- Open a receipt and choose Print receipt.
- In Android Chrome, use the system print dialog and select a compatible network/Bluetooth printer if it is exposed to Android, or select Save as PDF.
- In desktop Chrome/Edge, select the thermal printer and set paper width to 58 mm or 80 mm where supported.
- The stylesheet currently uses an 80 mm page size. For 58 mm printers, change `@page { size:80mm auto; }` and `.receipt-paper { width:72mm; }` in `src/styles.css` to `size:58mm auto` and `width:52mm`.
- ESC/POS direct printing requires compatible hardware and a suitable Android/desktop bridge or local print service; a browser web page cannot universally connect to arbitrary Bluetooth/USB printers.

## Production hardening checklist — required before live service

- Implement a server-side Postgres function (RPC) that creates an order and its items atomically, validates prices from the database, and reserves/decrements stock with row locks.
- Implement a payment RPC that locks the order, recomputes balance, prevents concurrent double collection, inserts the payment and updates paid amount/status in one transaction. Reconcile payment sums against `amount_paid_minor`.
- Remove direct browser update access to financial fields (`total_minor`, `amount_paid_minor`, discounts, tax, finalized status). Use narrow RPCs with role checks.
- Make order numbers and receipt numbers generated server-side; create receipts as immutable records and log reprints.
- Add stock movement RPCs and low-stock notifications; decide whether stock means sellable items or recipe ingredients.
- Add explicit discount, refund, cancellation, shift closeout and audit workflows.
- Use separate database test accounts to test owner/waiter/cashier/kitchen policies. Test unauthenticated, inactive, cross-role and direct API calls.
- Enable MFA for owner accounts and configure Supabase Auth rate limits / password policy.
- Add tests for totals, decimal rounding, partial payment, duplicate submissions, race conditions and RLS.
- Integrate Safaricom Daraja only from a server-side function with secrets in Vercel environment variables; verify callbacks and reconcile transaction IDs before marking payments confirmed.

## Useful commands

```bash
npm run dev
npm run build
npm run preview
```
