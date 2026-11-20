/* 飞行棋规则引擎（纯逻辑，零 DOM 依赖）
 * 浏览器：window.LU；Node：module.exports
 *
 * 坐标模型沿用 netmanfisher/chinese-ludo 的 position 数值语义（保持游玩行为一致）：
 *   -1 基地未起飞；0 起飞点；1..52 主路径（每色起点不同：黄0/蓝13/红26/绿39，循环52格）；
 *   > stepsToEntry 进入终点通道（6格）；恰好停在终点格 finished；超过则弹回（原版边界行为）。
 * 飞行通道与颜色飞跃的判定照搬原作：主路径索引触发（优先级 通道 > 颜色），通道后不再连跳。
 */
(function (root) {
  'use strict';

  var COLORS = ['red', 'yellow', 'blue', 'green'];

  var PATH_START_INDEX = { yellow: 0, blue: 13, red: 26, green: 39 };
  var FINISH_CHANNELS = {
    yellow: { start: 52, end: 57, entry: 49 },
    blue: { start: 58, end: 63, entry: 10 },
    red: { start: 64, end: 69, entry: 23 },
    green: { start: 70, end: 75, entry: 36 }
  };
  var SHORTCUTS = {
    yellow: { trigger: 17, destination: 29 },
    blue: { trigger: 30, destination: 42 },
    red: { trigger: 43, destination: 3 },
    green: { trigger: 4, destination: 16 }
  };
  var PATH_COLORS = {
    yellow: [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49],
    blue: [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50],
    red: [3, 7, 11, 15, 19, 23, 27, 31, 35, 39, 43, 47, 51],
    green: [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]
  };
  var FINISH_ENTRY_INDEX = { yellow: 49, blue: 10, red: 23, green: 36 };

  function validColors(players) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 4) { return false; }
    var seen = {};
    for (var i = 0; i < players.length; i++) {
      if (COLORS.indexOf(players[i]) < 0 || seen[players[i]]) { return false; }
      seen[players[i]] = true;
    }
    return true;
  }

  // 从起点出发走到终点通道入口需要的步数（含入口那格）
  function stepsToEntry(color, position) {
    var startIndex = PATH_START_INDEX[color];
    var entryIndex = FINISH_CHANNELS[color].entry;
    if (entryIndex >= startIndex) { return entryIndex - startIndex + 1; }
    return (52 - startIndex) + entryIndex + 1;
  }

  // 终点通道内的格序号（0-5）；不在通道内返回 -1
  function finishIndex(color, position) {
    var ch = FINISH_CHANNELS[color];
    var s = stepsToEntry(color, 0);
    if (position > s) { return position - s - 1; }
    return -1;
  }

  function mainPathIndex(color, position) {
    return (PATH_START_INDEX[color] + position - 1) % 52;
  }

  function inFinishStretch(color, position) {
    return position > stepsToEntry(color, 0);
  }

  // 停落后的飞跃判定：返回落点 position（含连跳）与事件序列
  function landResolve(color, position, events) {
    var cur = position;
    for (var hop = 0; hop < 2; hop++) { // 颜色飞跃后还可能再触发一次通道
      if (cur === -1 || inFinishStretch(color, cur)) { break; }
      var idx = mainPathIndex(color, cur);
      var sc = SHORTCUTS[color];
      if (idx === sc.trigger) {
        var dest = sc.destination >= PATH_START_INDEX[color]
          ? sc.destination - PATH_START_INDEX[color] + 1
          : (52 - PATH_START_INDEX[color]) + sc.destination + 1;
        events.push({ kind: 'shortcut', color: color, from: cur, to: dest });
        cur = dest;
        break; // 飞行通道后不再连跳
      }
      var entryIdx = FINISH_ENTRY_INDEX[color];
      if (idx === entryIdx) { break; }
      var cs = PATH_COLORS[color];
      if (cs.indexOf(idx) >= 0) {
        var nextIdx = cs[(cs.indexOf(idx) + 1) % cs.length];
        var dest2 = nextIdx >= PATH_START_INDEX[color]
          ? nextIdx - PATH_START_INDEX[color] + 1
          : (52 - PATH_START_INDEX[color]) + nextIdx + 1;
        if (inFinishStretch(color, dest2)) { break; }
        events.push({ kind: 'colorjump', color: color, from: cur, to: dest2 });
        cur = dest2;
        continue;
      }
      break;
    }
    return cur;
  }

  // 击落：落点（主路径）上对方棋子回基地；起飞点/终点通道不受攻击（原版规则）
  function resolveCaptures(state, color, events) {
    var pieces = state.pieces[color];
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.position === -1 || p.finished || p.position === 0) { continue; }
      if (inFinishStretch(color, p.position)) { continue; }
      var myIdx = mainPathIndex(color, p.position);
      for (var j = 0; j < state.players.length; j++) {
        var other = state.players[j];
        if (other === color) { continue; }
        var ops = state.pieces[other];
        for (var k = 0; k < ops.length; k++) {
          var op = ops[k];
          if (op.position === -1 || op.finished || op.position === 0) { continue; }
          if (inFinishStretch(other, op.position)) { continue; }
          if (mainPathIndex(other, op.position) === myIdx) {
            op.position = -1;
            events.push({ kind: 'capture', color: color, from: myIdx, to: myIdx, captured: [{ color: other, piece: k }] });
          }
        }
      }
    }
  }

  function cloneState(state) {
    var pieces = {};
    for (var c = 0; c < COLORS.length; c++) {
      var col = COLORS[c];
      if (!state.pieces[col]) { continue; }
      pieces[col] = state.pieces[col].map(function (p) { return { position: p.position, finished: p.finished }; });
    }
    return {
      players: state.players.slice(),
      turnIndex: state.turnIndex,
      dice: state.dice,
      rolled: state.rolled,
      pieces: pieces,
      over: state.over, winner: state.winner, reason: state.reason,
      version: state.version, lastEvents: []
    };
  }

  function checkWin(state) {
    for (var i = 0; i < state.players.length; i++) {
      var col = state.players[i];
      var all = state.pieces[col].every(function (p) { return p.finished; });
      if (all) { return col; }
    }
    return null;
  }

  function validStateShape(state) {
    if (!state || !Array.isArray(state.players) || !validColors(state.players)) { return false; }
    if (!Number.isInteger(state.turnIndex) || state.turnIndex < 0 || state.turnIndex >= state.players.length) { return false; }
    if (state.dice !== null && !(Number.isInteger(state.dice) && state.dice >= 1 && state.dice <= 6)) { return false; }
    if (!state.pieces || typeof state.over !== 'boolean' || typeof state.rolled !== 'boolean') { return false; }
    for (var i = 0; i < state.players.length; i++) {
      var col = state.players[i];
      if (!Array.isArray(state.pieces[col]) || state.pieces[col].length !== 4) { return false; }
      for (var j = 0; j < 4; j++) {
        var p = state.pieces[col][j];
        if (!p || !Number.isInteger(p.position) || p.position < -1 || p.position > 56 || typeof p.finished !== 'boolean' || p.finished !== (p.position === 56)) { return false; }
      }
    }
    if (!Number.isInteger(state.version) || state.version < 0) { return false; }
    return true;
  }

  function createInitialState(players) {
    if (!validColors(players)) { throw new Error('players 需为 2-4 种不重复颜色'); }
    var pieces = {};
    for (var i = 0; i < players.length; i++) {
      pieces[players[i]] = [];
      for (var j = 0; j < 4; j++) { pieces[players[i]].push({ position: -1, finished: false }); }
    }
    return {
      players: players.slice(),
      turnIndex: 0,
      dice: null,
      rolled: false,
      pieces: pieces,
      over: false, winner: null, reason: null,
      version: 0,
      lastEvents: []
    };
  }

  // 可动棋子（在基地需掷出 6）——与原版 checkMovablePieces 同口径
  function movablePieces(state) {
    if (!state || state.over || !state.rolled || state.dice === null) { return []; }
    var color = state.players[state.turnIndex];
    var out = [];
    var pieces = state.pieces[color];
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].finished) { continue; }
      if (pieces[i].position === -1) {
        if (state.dice === 6) { out.push(i); }
      } else {
        out.push(i);
      }
    }
    return out;
  }

  // 掷骰（服务端掷，客户端不可指定点数）
  function safeRoll(state, dice) {
    if (!validStateShape(state)) { return { ok: false, code: 'BAD_STATE' }; }
    if (state.over) { return { ok: false, code: 'GAME_OVER' }; }
    if (state.rolled) { return { ok: false, code: 'ALREADY_ROLLED' }; }
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) { return { ok: false, code: 'BAD_DICE' }; }
    var next = cloneState(state);
    next.dice = dice;
    next.rolled = true;
    next.version = state.version + 1;
    next.lastEvents = [{ kind: 'roll', color: state.players[state.turnIndex], from: 0, to: dice }];
    return { ok: true, state: next };
  }

  // 无子可动后换手；本地与服务端共用，保留骰子事件供界面说明。
  function safePass(state) {
    if (!validStateShape(state)) return {ok:false,code:'BAD_STATE'};
    if (state.over) return {ok:false,code:'GAME_OVER'};
    if (!state.rolled || state.dice === null) return {ok:false,code:'NOT_ROLLED'};
    if (movablePieces(state).length) return {ok:false,code:'MOVE_AVAILABLE'};
    var next=cloneState(state);
    next.turnIndex=(state.turnIndex+1)%state.players.length;
    next.rolled=false; next.dice=null; next.version=state.version+1;
    next.lastEvents=(state.lastEvents||[]).concat([{kind:'skip',color:state.players[state.turnIndex],from:state.dice,to:0}]);
    return {ok:true,state:next};
  }

  // 走子（完整结算：起飞/主路径/终点弹回/飞跃连跳/击落/胜负/换人）
  function safeMove(state, pieceIndex) {
    if (!validStateShape(state)) { return { ok: false, code: 'BAD_STATE' }; }
    if (state.over) { return { ok: false, code: 'GAME_OVER' }; }
    if (!state.rolled || state.dice === null) { return { ok: false, code: 'NOT_ROLLED' }; }
    if (!Number.isInteger(pieceIndex) || pieceIndex < 0 || pieceIndex > 3) { return { ok: false, code: 'BAD_PIECE' }; }
    var color = state.players[state.turnIndex];
    var pc = state.pieces[color][pieceIndex];
    if (pc.finished) { return { ok: false, code: 'PIECE_FINISHED' }; }
    if (pc.position === -1 && state.dice !== 6) { return { ok: false, code: 'NEED_SIX' }; }

    var next = cloneState(state);
    var np = next.pieces[color][pieceIndex];
    var events = [];

    if (pc.position === -1) {
      np.position = 0;
      events.push({ kind: 'takeoff', color: color, from: -1, to: 0 });
    } else {
      var target = pc.position + state.dice;
      var s = stepsToEntry(color, 0);
      var fi = target > s ? target - s - 1 : -1;
      var ch = FINISH_CHANNELS[color];
      if (fi === 5) {
        np.position = target;
        np.finished = true;
        events.push({ kind: 'finish', color: color, from: pc.position, to: target });
      } else if (fi > 5) {
        var excess = fi - 5;
        var back = 5 - excess;
        np.position = s + 1 + back;
        events.push({ kind: 'bounce', color: color, from: pc.position, to: np.position });
      } else {
        np.position = target;
        events.push({ kind: 'move', color: color, from: pc.position, to: target });
        var landed = landResolve(color, np.position, events);
        np.position = landed;
      }
    }

    resolveCaptures(next, color, events);
    var winner = checkWin(next);
    if (winner) {
      next.over = true; next.winner = winner; next.reason = 'finished';
    } else {
      if (state.dice === 6) {
        next.rolled = false; next.dice = null; // 6 再掷一次
      } else {
        next.turnIndex = (state.turnIndex + 1) % state.players.length;
        next.rolled = false; next.dice = null;
      }
    }
    next.version = state.version + 1;
    next.lastEvents = events;
    return { ok: true, state: next };
  }

  var LU = {
    COLORS: COLORS,
    PATH_START_INDEX: PATH_START_INDEX,
    FINISH_CHANNELS: FINISH_CHANNELS,
    SHORTCUTS: SHORTCUTS,
    PATH_COLORS: PATH_COLORS,
    FINISH_ENTRY_INDEX: FINISH_ENTRY_INDEX,
    stepsToEntry: stepsToEntry,
    finishIndex: finishIndex,
    mainPathIndex: mainPathIndex,
    inFinishStretch: inFinishStretch,
    validColors: validColors,
    createInitialState: createInitialState,
    movablePieces: movablePieces,
    safeRoll: safeRoll,
    safePass: safePass,
    safeMove: safeMove
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = LU; }
  root.LU = LU;
})(typeof window !== 'undefined' ? window : globalThis);
