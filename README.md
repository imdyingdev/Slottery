# slotsbackend

Puppeteer image renderer for the Slots Telegram bot (tgcloud can't run a browser).

## Run

    npm install
    API_KEY=<secret> PORT=3000 npm start

## API

`POST /gkas` — header `x-api-key: <API_KEY>`, JSON body:

    { "name": "Juan", "balance": 6300, "number": "091 234 899" }

Returns `image/png` of the GKas wallet card (`templates/gkas.html`).

`GET /health` — returns `ok`.
