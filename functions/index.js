const { onRequest } = require("firebase-functions/v2/https");

// The application now fetches market data directly from Yahoo Finance via proxies
// for a truly free, zero-maintenance architecture. This file is kept as a 
// placeholder for future secure backend logic.

exports.api = onRequest({ 
    region: "us-central1",
    memory: "256MiB",
}, (req, res) => {
    res.json({ status: "alive" });
});
