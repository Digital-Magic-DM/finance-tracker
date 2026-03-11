const https = require('https');

const yfUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d');

https.get(yfUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log(`YF /get [${res.statusCode}] length:`, data.length, data.substring(0, 100)));
}).on('error', err => console.error(err));

const mfUrl = 'https://api.mfapi.in/mf/120503/latest';
https.get(mfUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log(`MFAPI [${res.statusCode}] length:`, data.length, data.substring(0, 100)));
}).on('error', err => console.error(err));
