# HOROLOGIX Production Starter

## Structure
- `public/index.html` — user-facing HOROLOGIX storefront, based on the supplied prototype.
- `admin.html` — separate admin dashboard.
- `server.js` — Node/Express API with SQLite persistence.
- `package.json` — dependencies and scripts.

## Daily code flow
1. Admin signs in at `/admin.html`.
2. Admin creates today's code.
3. Admin posts the code manually in the official WhatsApp group.
4. User enters that code on the Rewards page.
5. Server verifies the code and awards weighted promotional points.
6. The active code is never returned by the public API.

## Important
This starter is a real backend architecture, but before public launch:
- change `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`;
- put the API behind HTTPS;
- use a managed database if deploying to a serverless host;
- add real M-Pesa Daraja payment callbacks before accepting real money;
- add proper account verification, rate limiting, audit logs and backup procedures.

The points are promotional loyalty points only and are not cash returns or investment profits.
