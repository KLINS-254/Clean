# SAMRYC DISHES POS

A mobile-friendly hotel point-of-sale starter built with HTML, CSS, vanilla JavaScript, Supabase and Vercel.

## Included

- Staff login with role selection (Owner, Waiter 1–4, Cashier)
- Shared menu and orders stored in Supabase
- Database-priced order creation through a PostgreSQL function
- Order status updates
- Cashier payment recording with one payment/receipt per order
- Receipt preview and browser printing
- Owner-only menu, staff and hotel receipt settings
- Daily paid-sales summaries
- Sample Kenyan food and drink menu
- 58mm/80mm-friendly print styles

## 1. Create the Supabase project

1. Create a project at https://supabase.com.
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste all of `supabase-schema.sql` and run it.
4. In **Project Settings → API**, copy the Project URL and publishable/anon key.
5. Open `script.js`, replace:
   - `YOUR_SUPABASE_PROJECT_URL`
   - `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`

The publishable/anon key is designed for browser use when Row Level Security is enabled. **Never place a service-role key in `script.js`.**

## 2. Create the first Owner account

The initial owner must be bootstrapped securely once:

1. In Supabase **Authentication → Users**, create a user with the owner's email and a strong password. Confirm the email if required.
2. Copy that user's UUID.
3. In SQL Editor, run the following after replacing the example values:

```sql
insert into public.profiles (id, full_name, role, active)
values ('PASTE-AUTH-USER-UUID-HERE', 'Hotel Owner', 'Owner', true);
```

Do not create an Owner profile for an untrusted user. Once the owner can log in, use the Staff Accounts page for further accounts.

## 3. Deploy the secure staff-creation Edge Function

The owner creates accounts through this function. It keeps the Supabase service-role key server-side.

Install the Supabase CLI on a computer, authenticate, and link the project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
supabase functions deploy create-staff
```

Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to Edge Functions in standard projects. If your project does not, set those function secrets as well. Do not put the service-role key in this repository or Vercel frontend variables.

For a phone-only workflow, the function folder can be committed through GitHub, but deployment of the Edge Function still requires the Supabase CLI or an equivalent supported deployment workflow.

## 4. Run locally

You can open `index.html` through a local static server, or use VS Code Live Server. Because Supabase is remote, an internet connection is required. Opening the file directly may work in some browsers, but a local server is recommended.

## 5. Deploy on GitHub + Vercel

1. Upload all project files to a GitHub repository.
2. On Vercel, choose **Add New → Project** and import the repository.
3. Framework preset: **Other**. Build command and output directory can be left blank for this static project.
4. Deploy. No server-side Vercel environment variables are needed for this frontend version because the URL and publishable key are set in `script.js`.
5. Test the deployed site using the Owner account.

## 6. Important security and operating notes

- Supabase Auth hashes and manages passwords; this app does not store plain-text passwords in the database.
- RLS protects database reads/writes. The SQL functions validate current staff role and obtain item prices from the database.
- Payments are inserted by a database function and `payments.order_id` is unique, preventing duplicate payment/receipt records for the same order.
- The browser UI hides restricted sections, but actual protection is enforced by database policies and server-side functions.
- Waiter access to order status is intentionally enabled. Cashier/Owner can record payments.
- The receipt print button uses the browser's print dialog. Choose a 58mm or 80mm printer in the printer settings; browser/printer drivers vary.
- This is a practical starter, not a certified fiscal/eTIMS integration. It does not send M-Pesa STK Pushes or verify M-Pesa transaction codes. “M-Pesa” currently records the method selected by staff.
- For production, review the SQL policies and test each role using separate test accounts before entering real sales. Consider audit logging, backup policy, and a server-side verified M-Pesa integration.
- Do not disable RLS or expose the service-role key to make a feature work.

## Troubleshooting

**“Supabase is not configured”** — check the two constants at the top of `script.js`.

**Login works but profile is missing** — add a `profiles` row matching the Auth user's UUID. The first owner is bootstrapped in step 2.

**Staff creation fails** — deploy `create-staff` and set its server-side `SUPABASE_SERVICE_ROLE_KEY` secret.

**Permission denied** — confirm the user's `profiles.role`, `active` status and RLS policies. Never fix this by exposing a service-role key in the browser.

**Orders or payments do not load** — check the browser console and Supabase logs for the precise error.
