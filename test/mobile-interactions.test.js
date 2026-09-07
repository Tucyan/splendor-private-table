import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';

const mobileModule=import('../public/mobile-interactions.js').catch(()=>({}));

test('market page follows the closest horizontal snap position',async()=>{
  const {marketViewIndex}=await mobileModule;
  assert.equal(typeof marketViewIndex,'function');
  assert.equal(marketViewIndex(0,360,3),0);
  assert.equal(marketViewIndex(210,360,3),1);
  assert.equal(marketViewIndex(800,360,3),2);
  assert.equal(marketViewIndex(100,0,3),0);
});

test('mobile card information only opens from a long press',async()=>{
  const {shouldShowContextTooltip}=await mobileModule;
  assert.equal(typeof shouldShowContextTooltip,'function');
  assert.equal(shouldShowContextTooltip({mobile:true,trigger:'hover',pointerType:'mouse'}),false);
  assert.equal(shouldShowContextTooltip({mobile:true,trigger:'focus'}),false);
  assert.equal(shouldShowContextTooltip({mobile:true,trigger:'longpress'}),true);
  assert.equal(shouldShowContextTooltip({mobile:false,trigger:'hover',pointerType:'mouse'}),true);
});

test('a deliberate horizontal swipe changes exactly one mobile market page',async()=>{
  const {swipePageIndex}=await mobileModule;
  assert.equal(typeof swipePageIndex,'function');
  assert.equal(swipePageIndex(0,-80,3),1);
  assert.equal(swipePageIndex(1,80,3),0);
  assert.equal(swipePageIndex(2,-80,3),2);
  assert.equal(swipePageIndex(1,20,3),1);
});

test('touch swipe tracker recognizes a right swipe from the gem details page',async()=>{
  const {createTouchSwipeTracker}=await mobileModule;
  assert.equal(typeof createTouchSwipeTracker,'function');
  const swipes=[];
  const tracker=createTouchSwipeTracker({onSwipe:deltaX=>swipes.push(deltaX)});
  tracker.start([{identifier:7,clientX:80,clientY:300}]);
  assert.equal(tracker.move([{identifier:7,clientX:150,clientY:305}]),'horizontal');
  assert.equal(tracker.finish([{identifier:7,clientX:170,clientY:306}]),90);
  assert.deepEqual(swipes,[90]);
});

test('touch swipe tracker ignores short and vertical gestures',async()=>{
  const {createTouchSwipeTracker}=await mobileModule;
  const swipes=[];
  const tracker=createTouchSwipeTracker({onSwipe:deltaX=>swipes.push(deltaX)});
  tracker.start([{identifier:1,clientX:100,clientY:200}]);
  assert.equal(tracker.finish([{identifier:1,clientX:120,clientY:204}]),null);
  tracker.start([{identifier:2,clientX:100,clientY:200}]);
  assert.equal(tracker.finish([{identifier:2,clientX:165,clientY:290}]),null);
  assert.deepEqual(swipes,[]);
});

test('long press triggers once and marks the following click for suppression',async()=>{
  const {createLongPressTracker}=await mobileModule;
  assert.equal(typeof createLongPressTracker,'function');
  const triggered=[],released=[];
  const tracker=createLongPressTracker({delay:5,onTrigger:value=>triggered.push(value),onRelease:value=>released.push(value)});
  tracker.start('card-a',{x:10,y:10});
  await delay(15);
  assert.deepEqual(triggered,['card-a']);
  assert.equal(tracker.finish(),'card-a');
  assert.deepEqual(released,['card-a']);
  assert.equal(tracker.finish(),null);
});

test('moving a finger cancels long press without suppressing a normal tap',async()=>{
  const {createLongPressTracker}=await mobileModule;
  assert.equal(typeof createLongPressTracker,'function');
  const triggered=[];
  const tracker=createLongPressTracker({delay:5,tolerance:8,onTrigger:value=>triggered.push(value)});
  tracker.start('card-a',{x:10,y:10});
  tracker.move({x:30,y:11});
  await delay(15);
  assert.deepEqual(triggered,[]);
  assert.equal(tracker.finish(),null);
});

test('cancelling an active long press releases its visible information',async()=>{
  const {createLongPressTracker}=await mobileModule;
  const released=[];
  const tracker=createLongPressTracker({delay:5,onRelease:value=>released.push(value)});
  tracker.start('card-a',{x:10,y:10});
  await delay(15);
  tracker.cancel();
  assert.deepEqual(released,['card-a']);
});

test('the mobile market carousel reserves horizontal swipes for its page controller',async()=>{
  const css=await readFile(new URL('../public/mobile-table.css',import.meta.url),'utf8');
  assert.match(css,/\.market-column \.market\{[^}]*flex-direction:row/);
  assert.match(css,/\.market-column \.market\{[^}]*touch-action:pan-y/);
});

test('the enlarged mobile inventory also enlarges its gem icons',async()=>{
  const css=await readFile(new URL('../public/mobile-table.css',import.meta.url),'utf8');
  assert.match(css,/\.inventory-summary \.gem\{[^}]*width:20px[^}]*height:20px/);
});
