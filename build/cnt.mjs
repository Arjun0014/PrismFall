import { readFileSync } from 'node:fs';
const s = readFileSync('build/bundle.min.js', 'utf8');
const nums = s.match(/(?<![\w.$])\d[\d.eE+]*/g) || [];
const strs = s.match(/'[^']*'/g) || [];
console.log('total min chars', s.length);
console.log('numeric literals', nums.length, 'chars', nums.join('').length, (nums.join('').length / s.length * 100).toFixed(1) + '%');
console.log('distinct numbers', new Set(nums).size);
console.log('string literals', strs.length, 'chars', strs.join('').length);
console.log('distinct strings', new Set(strs).size, 'chars', [...new Set(strs)].join('').length);
