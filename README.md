# ميعاد (Maead)

WhatsApp appointment reminders for small clinics that still run on Excel or a paper book. Prototype, not a product.

- `index.html` sales page (Arabic, RTL). `app.html` the working tool. Open them in a browser, no build step, no server.
- Paste an Excel table, get a ready WhatsApp message per patient (official wa.me link, sent manually from the clinic's own number), mark came / no-show, compare no-show for reminded vs not reminded.
- Data stays in the browser (localStorage). Nothing is uploaded.
- Set the public contact number in `config.js` (empty on purpose).

## Honest scope
- Sending is manual, one patient at a time. No bulk or automatic sending.
- Not tested on a real clinic yet. Demo data is fake.
- Evidence for reminders: Cochrane 2013 (8 RCTs, 6,615 patients, attendance RR 1.14, moderate quality, non-Egyptian). No Egyptian demand evidence beyond vendor blogs.
- Full clinic systems (e.g. Zahw, 200 EGP/month) already exist. This only fits owners who refuse to migrate.
- Patient phone numbers are personal data. The clinic is responsible for patient consent. Not legal advice.

## Tests
`node --test lib.test.js` (8 unit tests). `node e2e.mjs` (11 checks in real Chrome, needs google-chrome).

## Structure and data model (v2)

- `lib.js`: pure functions only (phone and date parsing, message building, stats, `migrateState`, `dayProgress`, `checkTemplate`). No DOM. Tested with `node --test lib.test.js`.
- `app.js`: DOM and storage. One `state` object, saved to `localStorage` under `maead.v1` and passed through `migrateState` on every load, so an old or corrupted save cannot break the page.
- State: `{ v, text, clinic, fee, tpl, day, sample, marks }`. `marks` maps a row id to `{ sent: bool, outcome: '' | 'confirmed' | 'came' | 'noshow' }`.
- Nothing leaves the browser. Sending is a `wa.me` link the user taps. No server, no account, no automatic sending.
- Checks: `node --test lib.test.js` (unit) and `node e2e.mjs` (real Chrome, needs `google-chrome`).

## Tests

- `node --test lib.test.js xlsx.test.js`: unit tests (parsing, state migration, backup, real .xlsx file; the xlsx test reads `/tmp/sample.xlsx` if present).
- `node e2e.mjs`, `node e2e-files.mjs`, `node devices.mjs`: real Chrome over CDP (core flow, xlsx upload and backup/restore, no sideways scroll at 320 to 1280px, keyboard-only walk).
- Only Chrome was available for testing. Safari and Firefox were not tested.
