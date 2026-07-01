import fs from 'fs';
const content = fs.readFileSync('scratch/diff_index.patch', 'utf16le');
fs.writeFileSync('scratch/diff_index_utf8.patch', content, 'utf8');
console.log("Converted!");
