const fs = require('fs');
const path = require('path');

function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) {
            walk(p);
        } else if (/\.(ts|html|scss|json)$/.test(f)) {
            const content = fs.readFileSync(p, 'utf8');
            if (content.includes('\r\n')) {
                fs.writeFileSync(p, content.replace(/\r\n/g, '\n'), 'utf8');
            }
        }
    }
}

walk('src/app');
console.log('Normalized src/app line endings to LF');
