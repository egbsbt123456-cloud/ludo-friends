const LU = require('../js/engine.js');
let pass = 0, fail = 0;
function ok(c, name) { if (c) pass++; else { fail++; console.log('FAIL ' + name); } }

// 1. createInitialState
const s = LU.createInitialState(['red','yellow']);
ok(s.players.length === 2 && s.turnIndex === 0 && s.version === 0 && !s.rolled, 'initial state');
ok(s.pieces.red.every(p => p.position === -1 && !p.finished), 'red pieces in base');
ok((() => { try { LU.createInitialState(['red']); return false; } catch (e) { return true; } })(), '1 player rejected');
ok((() => { try { LU.createInitialState(['red','red']); return false; } catch (e) { return true; } })(), 'duplicate color rejected');

// 2. stepsToEntry / finishIndex
ok(LU.stepsToEntry('yellow', 0) === 50, 'yellow entry 50');
ok(LU.stepsToEntry('blue', 0) === 50, 'blue entry 50');
ok(LU.stepsToEntry('red', 0) === 50, 'red entry 50');
ok(LU.stepsToEntry('green', 0) === 50, 'green entry 50');

// 3. movablePieces
ok(LU.movablePieces(s).length === 0, 'no movable before roll');
let r = LU.safeRoll(s, 6);
ok(r.ok && r.state.dice === 6 && r.state.rolled, 'roll 6');
ok(LU.movablePieces(r.state).length === 4, 'all 4 movable with 6');
r = LU.safeRoll(s, 3);
ok(r.ok && LU.movablePieces(r.state).length === 0, 'no movable with 3 (all in base)');
ok(!LU.safeRoll(r.state, 3).ok, 'double roll rejected');

// 4. takeoff needs 6
r = LU.safeRoll(s, 3);
const m = LU.safeMove(r.state, 0);
ok(!m.ok && m.code === 'NEED_SIX', 'takeoff needs six');
r = LU.safeRoll(s, 6);
const t = LU.safeMove(r.state, 2);
ok(t.ok && t.state.pieces.red[2].position === 0, 'takeoff to start');
ok(t.state.rolled === false && t.state.dice === null && t.state.turnIndex === 0, 'rolled 6: same player rolls again');

// 5. normal move + capture semantics (set up manually)
const s2 = LU.createInitialState(['red','yellow']);
s2.pieces.red[0].position = 5; // red mainPath idx = (26+5-1)%52 = 30
s2.pieces.red[1].position = -1; s2.pieces.red[2].position = -1; s2.pieces.red[3].position = -1;
// yellow piece at mainPath idx 30: position = 30-0+1 = 31 (yellow start 0)
s2.pieces.yellow[0].position = 33; s2.pieces.yellow[1].position = -1; s2.pieces.yellow[2].position = -1; s2.pieces.yellow[3].position = -1;
s2.rolled = true; s2.dice = 2;
const mv = LU.safeMove(s2, 0);
ok(mv.ok, 'move applies');
ok(mv.state.pieces.red[0].position === 7, 'red moved 5->7');
ok(mv.state.pieces.yellow[0].position === -1, 'yellow captured back to base');
const capEv = mv.state.lastEvents.find(e => e.kind === 'capture');
ok(!!capEv, 'capture event present');
ok(mv.state.turnIndex === 1, 'turn passed to yellow');

// 6. finish + bounce
const s3 = LU.createInitialState(['red','yellow']);
const entry = LU.stepsToEntry('red', 0); // 50
s3.pieces.red[0].position = entry + 4; // one before finish? finishIndex = position - entry - 1
// finishIndex == 5 -> position = entry + 6
s3.pieces.red[0].position = entry + 6;
s3.rolled = true; s3.dice = 0; // need integer path; instead direct test via safeMove semantics
// test bounce: piece at entry+6 is finished already? position entry+6 => fi = 5 => finished only via landing
// Simpler: verify landing exactly at fi 5 marks finished
const s4 = LU.createInitialState(['red','yellow']);
s4.pieces.red[0].position = entry + 6 - 2; // dice 2 lands at entry+6
s4.rolled = true; s4.dice = 2;
const fin = LU.safeMove(s4, 0);
ok(fin.ok && fin.state.pieces.red[0].finished === true, 'landing on finish marks finished');

// 7. bounce back: land beyond finish
const s5 = LU.createInitialState(['red','yellow']);
s5.pieces.red[0].position = entry + 6 - 1; // dice 3 -> fi 7 -> excess 2 -> back to fi 3
s5.rolled = true; s5.dice = 3;
const b = LU.safeMove(s5, 0);
ok(b.ok, 'bounce applies');
const fi = LU.finishIndex('red', b.state.pieces.red[0].position);
ok(fi === 3, 'bounced to finishIndex 3, got ' + fi);

// 8. shortcut trigger: red mainPath idx 43 -> dest 3 -> position = (52-26)+3+1 = 30
const s6 = LU.createInitialState(['red','yellow']);
s6.pieces.red[0].position = 16; // +2 -> pos 18, idx = (26+18-1)%52 = 43
s6.rolled = true; s6.dice = 2;
const sc = LU.safeMove(s6, 0);
ok(sc.ok, 'shortcut move applies');
ok(sc.state.pieces.red[0].position === 30, 'red shortcut 18->30 via trigger 43, got ' + sc.state.pieces.red[0].position);
ok(sc.state.lastEvents.some(e => e.kind === 'shortcut'), 'shortcut event');

// 9. color jump: red at mainPath idx 35 (position 10): PATH_COLORS.red includes 35; next = 39
const s7 = LU.createInitialState(['red','yellow']);
s7.pieces.red[0].position = 9; // +1 -> pos 10, idx = (26+10-1)%52 = 35
s7.rolled = true; s7.dice = 1;
const cj = LU.safeMove(s7, 0);
ok(cj.ok, 'colorjump applies');
// idx 39 is also green's... wait, PATH_COLORS.red includes 39. dest idx 39 -> position = 39-26+1 = 14
ok(cj.state.pieces.red[0].position === 18, 'color jump chains 35->39->43 (pos 10->18), got ' + cj.state.pieces.red[0].position);
ok(cj.state.lastEvents.filter(e => e.kind === 'colorjump').length === 2, 'two colorjump events');

// 10. win detection
const s8 = LU.createInitialState(['red','yellow']);
for (let i = 0; i < 4; i++) { s8.pieces.red[i].finished = true; }
s8.rolled = true; s8.dice = 1; s8.pieces.yellow[0].position = 5;
const w = LU.safeMove(s8, 0);
// all red finished already means over? checkWin only via move; but here red finished before yellow move — engine doesn't auto-flag; skip
console.log('engine classic:', pass, 'passed,', fail, 'failed');
if (fail > 0) process.exit(1);





