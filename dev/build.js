// Inlines CSS and JS into one self-contained app.html
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const js = src('core.js') + '\n' + src('ui.js');
if (js.includes('</scr' + 'ipt')) throw new Error('script end tag inside JS');
const html = src('shell.html').replace('/*CSS*/', () => src('app.css')).replace('/*JS*/', () => js);
fs.writeFileSync(path.join(__dirname, '..', 'app.html'), html);
console.log('app.html', html.length, 'bytes');
