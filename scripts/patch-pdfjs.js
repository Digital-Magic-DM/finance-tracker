const fs = require('fs');
const path = require('path');

const targets = [
  path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'),
  path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')
];

for (const target of targets) {
  if (fs.existsSync(target)) {
    let content = fs.readFileSync(target, 'utf8');
    if (content.includes('import(/*webpackIgnore: true*/this.workerSrc)') && !content.includes('@vite-ignore')) {
      content = content.replace(
        'import(/*webpackIgnore: true*/this.workerSrc)',
        'import(/* @vite-ignore */ /*webpackIgnore: true*/this.workerSrc)'
      );
      fs.writeFileSync(target, content, 'utf8');
      console.log(`[patch-pdfjs] Patched ${path.basename(path.dirname(target))}/${path.basename(target)} with /* @vite-ignore */`);
    }
  }
}
