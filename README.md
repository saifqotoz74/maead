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
