# TICOH HOTEL POS

A starter hotel POS app with owner/worker login, food and drinks catalogue, orders, kitchen/bar tickets, payment recording, receipt printing, worker management, and basic daily reports.

## Requirements
- Node.js 18 or newer
- npm
- Android: Termux is suitable for local testing

## Setup
1. Install Node.js on your computer or in Termux.
2. Copy `.env.example` to `.env`.
3. Edit `.env`. Set `OWNER_PASSWORD` to a private password with at least 12 characters and set `JWT_SECRET` to a long random secret (at least 24 characters).
4. In this project folder run:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:3000` in the device browser.
6. Sign in with the `OWNER_USERNAME` and `OWNER_PASSWORD` values you placed in `.env`.

The owner account is created on the first database initialization when a valid `OWNER_PASSWORD` is set. If you start before setting it, configure `.env` and restart.

## Android / Termux quick start
Install Node.js in Termux, place the project in a folder, then:
```bash
pkg update
pkg install nodejs
cd ticoh-hotel-pos
cp .env.example .env
nano .env
npm install
npm start
```
Keep the terminal running while using the local app. Open `http://127.0.0.1:3000` in Chrome on the same phone.

## Receipt printing
Open an order and choose Receipt, then select **Print / Save PDF**. The browser print dialog can print to a compatible printer or save a PDF. Thermal printer behavior varies by browser, printer driver, and paper size; test with your printer and adjust `public/receipt.css` if needed.

## Important production notes
- This is a starter implementation. Before exposing it to the public internet, use HTTPS, set a strong private `JWT_SECRET`, add rate limiting and stronger operational monitoring, and review access permissions.
- Do not commit `.env`, the `data/` folder, or database backups to a public GitHub repository.
- The app records payments but does not initiate M-Pesa STK Push or verify transactions with Safaricom. M-Pesa references are entered by a cashier.
- Tax, service charge, inventory deduction, expenses, refunds, room management, and cloud/offline synchronization are not fully implemented in this starter version.
- Back up `data/hotel-pos.db` regularly.
