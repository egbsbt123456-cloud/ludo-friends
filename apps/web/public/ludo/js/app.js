/* 飞行棋 UI 主逻辑：渲染 + 输入 + 对局流程
 *
 * 双模式：
 *  - local：原版单人/同屏流程（掷骰→选子→结算），引擎规则同源。
 *  - online：只渲染父页 postMessage 下发的权威状态；掷骰/走子都提交给父页，
 *    等服务端确认回推后才更新画面（零乐观更新，断线刷新即恢复）。
 *
 * 棋子坐标沿用原版 POSITIONS 表（602 棋盘的手工标注坐标）。
 */
(function () {
  'use strict';

  var LU = window.LU;
  var mode = new URLSearchParams(window.location ? window.location.search : '').get('mode') || 'local';
  if (mode !== 'online') { mode = 'local'; }

  var boardContainer = document.querySelector('.board-container');
  var messageEl = document.getElementById('gameMessage');
  var rollBtnTemplate = null; // online 模式不显示掷骰按钮

  function tellParent(type, data) {
    window.parent.postMessage({ channel: 'boardgame:ludo', type: type, data: data || {} }, window.location.origin);
  }

  /* ---------------- 坐标表（原版手抄） ---------------- */
  var POSITIONS = [
    { x: 56, y: 195 },   { x: 93, y: 180 },   { x: 126, y: 180 },  { x: 163, y: 196 },
    { x: 194, y: 164 },  { x: 179, y: 128 },  { x: 180, y: 94 },   { x: 194, y: 57 },
    { x: 231, y: 45 },   { x: 265, y: 44 },   { x: 299, y: 45 },   { x: 334, y: 45 },
    { x: 367, y: 45 },   { x: 405, y: 57 },   { x: 420, y: 94 },   { x: 420, y: 129 },
    { x: 404, y: 164 },  { x: 436, y: 196 },  { x: 472, y: 180 },  { x: 505, y: 180 },
    { x: 542, y: 197 },  { x: 555, y: 232 },  { x: 554, y: 265 },  { x: 555, y: 300 },
    { x: 555, y: 332 },  { x: 555, y: 367 },  { x: 542, y: 403 },  { x: 505, y: 418 },
    { x: 472, y: 418 },  { x: 435, y: 404 },  { x: 405, y: 434 },  { x: 420, y: 470 },
    { x: 421, y: 505 },  { x: 404, y: 541 },  { x: 367, y: 555 },  { x: 333, y: 556 },
    { x: 298, y: 556 },  { x: 265, y: 555 },  { x: 231, y: 554 },  { x: 193, y: 542 },
    { x: 178, y: 505 },  { x: 178, y: 471 },  { x: 194, y: 436 },  { x: 164, y: 404 },
    { x: 125, y: 419 },  { x: 93, y: 419 },   { x: 57, y: 403 },   { x: 43, y: 367 },
    { x: 43, y: 333 },   { x: 45, y: 299 },   { x: 44, y: 267 },   { x: 45, y: 232 },
    { x: 93, y: 299 },   { x: 129, y: 299 },  { x: 161, y: 300 },  { x: 195, y: 300 },
    { x: 229, y: 299 },  { x: 269, y: 300 },
    { x: 300, y: 94 },   { x: 298, y: 127 },  { x: 300, y: 162 },  { x: 299, y: 197 },
    { x: 300, y: 231 },  { x: 299, y: 271 },
    { x: 506, y: 301 },  { x: 470, y: 301 },  { x: 437, y: 301 },  { x: 403, y: 301 },
    { x: 369, y: 299 },  { x: 329, y: 301 },
    { x: 299, y: 505 },  { x: 299, y: 471 },  { x: 300, y: 438 },  { x: 298, y: 404 },
    { x: 300, y: 370 },  { x: 299, y: 331 },
    { x: 15, y: 170 },   { x: 429, y: 17 },   { x: 582, y: 430 },  { x: 168, y: 582 },
    { x: 44, y: 45 },    { x: 100, y: 45 },   { x: 45, y: 98 },    { x: 98, y: 96 },
    { x: 500, y: 44 },   { x: 553, y: 45 },   { x: 500, y: 98 },   { x: 555, y: 99 },
    { x: 501, y: 501 },  { x: 555, y: 503 },  { x: 501, y: 554 },  { x: 554, y: 554 },
    { x: 45, y: 501 },   { x: 97, y: 501 },   { x: 44, y: 554 },   { x: 98, y: 554 }
  ];
  var START_POINTS = { yellow: 76, blue: 77, red: 78, green: 79 };
  var HOME_POSITIONS = {
    yellow: [80, 81, 82, 83], blue: [84, 85, 86, 87],
    red: [88, 89, 90, 91], green: [92, 93, 94, 95]
  };
  var MAIN_PATH = POSITIONS.slice(0,52);
  var FINISH_CHANNELS = { yellow: 52, blue: 58, red: 64, green: 70 };
  var PATH_START_INDEX = { yellow: 0, blue: 13, red: 26, green: 39 };
  var ALL_COLORS = ['red', 'yellow', 'blue', 'green'];
  var COLOR_MAIN = { red: '#e74c3c', yellow: '#f39c12', blue: '#3498db', green: '#27ae60' };
  var COLOR_EMOJI = { red: '🔴', yellow: '🟡', blue: '🔵', green: '🟢' };

  /* ---------------- 视图坐标 ---------------- */
  function coordsFor(color, piece, index) {
    if (piece.position === -1 || piece.finished) {
      return POSITIONS[HOME_POSITIONS[color][index]];
    }
    if (piece.position === 0) { return POSITIONS[START_POINTS[color]]; }
    var entry = LU.stepsToEntry(color, 0);
    var fi = piece.position > entry ? piece.position - entry - 1 : -1;
    if (fi >= 0) { return POSITIONS[FINISH_CHANNELS[color] + fi]; }
    return MAIN_PATH[(PATH_START_INDEX[color] + piece.position - 1) % 52];
  }

  /* ---------------- 状态 ---------------- */
  var state = null;          // 引擎权威状态
  var pieceIndex = 0;        // 当前操作棋子序号（用于坐标查询的闭包变量）
  var pieceElements = {};
  var pendingAction = false; // online：等待服务端确认期间锁输入
  var lastRenderedVersion = -1, onlineReady=false, lastDice={};

  /* ---------------- 渲染 ---------------- */
  function ensurePieces() {
    state.players.forEach(function (color) {
      if (!pieceElements[color]) {
        pieceElements[color] = [];
        for (var i = 0; i < 4; i++) {
          var el = document.createElement('button');
          el.type='button';el.setAttribute('aria-label',color+' '+(i+1)+'号飞机');
          el.className = 'piece ' + color;
          el.textContent = i + 1;
          el.id = 'piece-' + color + '-' + i;
          (function (c, idx) {
            el.onclick = function () { handlePieceClick(c, idx); };
          })(color, i);
          boardContainer.appendChild(el);
          pieceElements[color].push(el);
        }
      }
    });
    ALL_COLORS.forEach(function (color) {
      var panel = document.getElementById('panel-' + color);
      if (panel) { panel.style.display = state.players.indexOf(color) >= 0 ? '' : 'none'; }
      if(pieceElements[color])pieceElements[color].forEach(function(el){el.hidden=state.players.indexOf(color)<0;});
    });
  }

  function layoutPiece(color, i, animate) {
    var el = pieceElements[color][i];
    var p = state.pieces[color][i];
    var coords = coordsFor(color, p, i);
    // 同格按稳定的颜色/编号分散，避免每颗都偏向同一处。
    var group=[];
    state.players.forEach(function(oc){state.pieces[oc].forEach(function(op,j){
      if(op.position<0||op.finished)return;
      var pt=coordsFor(oc,op,j);
      if(Math.abs(pt.x-coords.x)<1&&Math.abs(pt.y-coords.y)<1)group.push(oc+':'+j);
    });});
    var rank=group.indexOf(color+':'+i),radius=group.length>1?Math.min(12,group.length*3):0;
    var angle=rank*2*Math.PI/Math.max(1,group.length),dx=radius*Math.cos(angle),dy=radius*Math.sin(angle);
    if (animate) { el.classList.add('moving'); setTimeout(function () { el.classList.remove('moving'); }, 400); }
    el.style.left = ((coords.x + dx)/600*100) + '%';
    el.style.top = ((coords.y + dy)/600*100) + '%';
    el.style.transform = 'translate(-50%, -50%)';
    el.classList.toggle('finished', !!p.finished);
    if (p.finished) { el.textContent = '✓'; } else { el.textContent = i + 1; }
  }

  function renderAll(animateLast) {
    ensurePieces();
    if(state.rolled)lastDice[state.players[state.turnIndex]]=state.dice;
    (state.lastEvents||[]).forEach(function(e){if(e.kind==='roll')lastDice[e.color]=e.to;});
    state.players.forEach(function (color) {
      for (var i = 0; i < 4; i++) { layoutPiece(color, i, animateLast); }
    });
    // 面板高亮 + 骰子显示
    ALL_COLORS.forEach(function (color) {
      var panel = document.getElementById('panel-' + color);
      if (panel && state.players.indexOf(color) >= 0) {
        panel.classList.toggle('active', !state.over && state.players[state.turnIndex] === color);
        var dice = document.getElementById('dice-' + color);
        if (dice) { dice.textContent = lastDice[color] ? '⚀⚁⚂⚃⚄⚅'[lastDice[color] - 1] : '🎲'; }
      }
    });
    // 棋子可选高亮（本地或轮到我的联机且已掷骰）
    var movable = movableForMe();
    state.players.forEach(function (color) {
      for (var i = 0; i < 4; i++) {
        var el = pieceElements[color][i];
        el.classList.toggle('selectable', movable.indexOf(i) >= 0 && color === myColor());
        el.disabled=!(movable.indexOf(i)>=0&&color===myColor())||pendingAction;
        el.classList.toggle('mine', color === myColor() && mode === 'online');
      }
    });
    updatePiecesStatus();
    updateMessageFromState();
    var roll=document.getElementById('rollButton');if(roll)roll.disabled=!state||state.over||state.rolled;
    var choices=document.getElementById('moveChoices');if(choices){
      choices.innerHTML='';
      if(!pendingAction)movable.forEach(function(i){var b=document.createElement('button');b.className='move-choice';b.textContent=(i+1)+'号飞机';b.onclick=function(){handlePieceClick(state.players[state.turnIndex],i);};choices.appendChild(b);});
    }
  }

  function updatePiecesStatus() {
    state.players.forEach(function (color) {
      var container = document.getElementById(color + 'Pieces');
      if (!container) { return; }
      var html = '';
      state.pieces[color].forEach(function (p) {
        var cls = 'home', txt = '●';
        if (p.finished) { cls = 'finished'; txt = '✓'; }
        else if (p.position > -1) { cls = 'active'; txt = '◆'; }
        html += '<span class="piece-dot ' + cls + '" style="background: ' + COLOR_MAIN[color] + ';">' + txt + '</span>';
      });
      container.innerHTML = html;
    });
  }

  function updateMessageFromState() {
    if (state.over) {
      messageEl.textContent = '🎊 ' + (state.winner ? COLOR_EMOJI[state.winner] + '玩家获胜！' : '对局结束') + ' 🎊';
      return;
    }
    var cur = state.players[state.turnIndex];
    var skipped=(state.lastEvents||[]).find(function(e){return e.kind==='skip';});
    if(skipped){messageEl.textContent=COLOR_EMOJI[skipped.color]+'掷出 '+skipped.from+' 点，无子可动；轮到'+COLOR_EMOJI[cur]+'掷骰子';return;}
    if (state.rolled) {
      messageEl.textContent = COLOR_EMOJI[cur] + '掷出 ' + state.dice + ' 点' + (movableForMe().length ? '，请选择要移动的飞机' : '');
    } else {
      messageEl.textContent = '轮到' + COLOR_EMOJI[cur] + '玩家掷骰子';
    }
  }

  /* ---------------- 谁在操作 ---------------- */
  var onlineColor = null;
  function myColor() {
    if (mode === 'online') { return onlineColor; }
    return state?state.players[state.turnIndex]:null;
  }
  function movableForMe() {
    if (mode === 'online' && (!onlineReady || onlineColor !== state.players[state.turnIndex])) { return []; }
    if (state.over) { return []; }
    return LU.movablePieces(state);
  }

  /* ---------------- 输入 ---------------- */
  function handlePieceClick(color, i) {
    if (mode === 'online') {
      if (!onlineReady || pendingAction || !state || state.over || color !== onlineColor) { return; }
      if (!state.rolled || state.dice === null) { return; }
      if (movableForMe().indexOf(i) < 0) { return; }
      pendingAction = true;
      clearSelectable();
      tellParent('move', { piece: i, expectedVersion: state.version });
      return;
    }
    // local
    if (state.over || state.rolled !== true) { return; }
    if (movableForMe().indexOf(i) < 0 || color !== state.players[state.turnIndex]) { return; }
    var res = LU.safeMove(state, i);
    if (!res.ok) { return; }
    state = res.state;
    renderAll(true);
  }

  function clearSelectable() {
    Object.keys(pieceElements).forEach(function (color) {
      pieceElements[color].forEach(function (el) { el.classList.remove('selectable'); });
    });
  }

  /* ---------------- local 模式：掷骰（本地随机） ---------------- */
  function rollLocal() {
    if (!state || state.over || state.rolled) { return; }
    var dice = Math.floor(Math.random() * 6) + 1;
    var res = LU.safeRoll(state, dice);
    if (res.ok) {
      state = res.state;
      // 无子可动 → 原版行为：换下家
      if (LU.movablePieces(state).length === 0) {
        state=LU.safePass(state).state;
      }
      renderAll(false);
    }
  }

  // local 模式掷骰入口挂到各面板点击（online 模式掷骰按钮由父页控制）
  ALL_COLORS.forEach(function (color) {
    var panel = document.getElementById('panel-' + color);
    if (panel) {
      panel.addEventListener('click', function () {
        if (mode === 'local' && state && state.players[state.turnIndex] === color) { rollLocal(); }
      });
      panel.title = mode === 'local' ? '点击掷骰子' : '';
    }
  });

  /* ---------------- local：玩家选择界面 ---------------- */
  var selectedPlayers = null;
  function initPlayerSelect() {
    if (mode === 'online') {
      document.getElementById('playerSelectOverlay').style.display = 'none';
      return;
    }
    var buttons = document.querySelectorAll('.player-option-btn');
    var startBtn = document.getElementById('startGameBtn');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        selectedPlayers = btn.dataset.colors.split(',');
        startBtn.disabled = false;
      });
    });
  }
  window.startGame = function () {
    if (!selectedPlayers) { return; }
    document.getElementById('playerSelectOverlay').style.display = 'none';
    lastDice={};state = LU.createInitialState(selectedPlayers);
    renderAll(false);
    messageEl.textContent = '游戏开始！点击当前玩家的面板掷骰子';
  };

  /* ---------------- online：父页消息 ---------------- */
  if (mode === 'online') {
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent || event.origin !== window.location.origin || !event.data || event.data.channel !== 'boardgame:ludo:control') { return; }
      var room = event.data.room;
      if (!room || !room.state || !Array.isArray(room.state.players)) { return; }
      if (room.code === lastRoomCode && room.state.version < lastRenderedVersion) { return; }
      if (room.code === lastRoomCode && room.state.version === lastRenderedVersion && !pendingAction) { return; }
      lastRoomCode = room.code;
      onlineColor = room.yourColor;onlineReady=room.status==='playing';
      state = room.state;
      var animate = lastRenderedVersion >= 0 && room.state.version > lastRenderedVersion;
      lastRenderedVersion = room.state.version;
      pendingAction = false;
      renderAll(animate);
      if (room.status === 'waiting') { messageEl.textContent = '等待好友加入…'; }
    });
    tellParent('ready', {});
  }
  var lastRoomCode = null;
  initPlayerSelect();
  var localControls=document.getElementById('localControls');if(localControls)localControls.hidden=mode==='online';
  document.getElementById('rollButton').addEventListener('click',rollLocal);
  document.getElementById('newGameBtn').addEventListener('click',function(){if(mode==='local')document.getElementById('playerSelectOverlay').style.display='flex';});


  /* ---------------- 测试钩子 ---------------- */
  window.__LUDO_TEST__ = {
    getState: function () { return state; },
    setState: function (s) { state = s; lastRenderedVersion = -1; onlineColor = s.players[0]; renderAll(false); },
    handlePieceClick: handlePieceClick,
    rollLocal: rollLocal,
    startWith: function (colors) { selectedPlayers = colors; window.startGame(); },
    getMode: function () { return mode; },
    getOnlineColor: function () { return onlineColor; },
    setPendingAction: function (v) { pendingAction = v; }
  };
})();
