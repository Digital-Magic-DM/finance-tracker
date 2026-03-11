const https = require('https');

https.get('https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log("Keys:", Object.keys(json.data));
            console.log("Price (pricecurrent):", json.data.pricecurrent);
            console.log("Close:", json.data.priceprevclose);
        } catch(e) { console.error(e); }
    });
});
