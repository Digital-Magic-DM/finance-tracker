const https = require('https');

const yfUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d');

https.get(yfUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log(`YF [${res.statusCode}] length:`, data.length, data.substring(0, 100)));
}).on('error', err => console.error(err));
