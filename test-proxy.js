const https = require('https');

const tests = [
    'https://cors-anywhere.herokuapp.com/https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS',
    'https://jsonp.afeld.me/?url=' + encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d'),
    'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=1d&interval=1d')
];

tests.forEach((url, i) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0'} }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log(`Test ${i} [${res.statusCode}] len:`, data.length, data.substring(0, 100)));
    }).on('error', err => console.error(`Test ${i} err:`, err.message));
});
