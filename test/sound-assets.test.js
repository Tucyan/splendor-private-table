import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const selected=['card-shuffle.ogg','chips-handle-2.ogg','card-place-1.ogg','card-slide-4.ogg','cards-pack-open-1.ogg','chip-lay-2.ogg','card-fan-1.ogg'];

test('selected CC0 sound files and their source license are bundled locally',async()=>{
  const directory=new URL('public/assets/audio/',root);
  for(const file of selected){
    const info=await stat(new URL(file,directory));
    assert.ok(info.size>1000&&info.size<50000,`${file} should be a compact non-empty clip`);
  }
  const license=await readFile(new URL('LICENSE.txt',directory),'utf8');
  assert.match(license,/Creative Commons Zero, CC0/i);
  assert.match(license,/Kenney\.nl/i);
});

test('the app wires state cues, gesture unlock, persistence, and controls on desktop and mobile',async()=>{
  const [app,styles,mobile]=await Promise.all([
    readFile(new URL('public/app.js',root),'utf8'),
    readFile(new URL('public/styles.css',root),'utf8'),
    readFile(new URL('public/mobile-table.css',root),'utf8'),
  ]);
  assert.match(app,/from '\.\/sound-effects\.js'/);
  assert.match(app,/stateSoundCues\(state,next\)/);
  assert.match(app,/soundPlayer\.unlock\(\)/);
  assert.match(app,/splendor\.sound-muted/);
  assert.match(app,/data-do="toggle-sound"/);
  assert.match(app,/aria-pressed="\$\{!soundMuted\}"/);
  assert.match(styles,/\.sound-toggle/);
  assert.match(mobile,/\.at-table \.header nav>\.sound-toggle/);
});
