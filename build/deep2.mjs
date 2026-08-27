import { readFileSync, writeFileSync } from 'node:fs';
import { Packer } from 'roadroller';
const min = readFileSync('build/bundle.min.js', 'utf8');
const p = new Packer([{ data: min, type: 'js', action: 'eval' }], { maxMemoryMB: 700, numAbbreviations: 32 });
const r = await p.optimize(2);
const keep = {};
for (const k of ['sparseSelectors','precision','modelMaxCount','recipLearningRate','modelRecipBaseCount','learningRateNum','learningRateDenom'])
  if (p.options[k] !== undefined) keep[k] = p.options[k];
writeFileSync('build/roadroller-l2.json', JSON.stringify(keep, null, 1));
console.log('level2 est', r && r.best ? r.best.size : '?', JSON.stringify(keep));
