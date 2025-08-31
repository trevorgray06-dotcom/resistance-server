// Online multiplayer client for The Resistance
// Set this to your deployed Socket.IO server origin (e.g., 'https://your-app.onrender.com')
const SERVER_URL = localStorage.getItem('server_url') || ''; // prompt user if empty

// Basic constants
const TEAM_SIZES = {5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
const SPY_COUNT = {5:2,6:2,7:3,8:3,9:3,10:4};

const app = document.getElementById('app');
let socket = null;
let state = {
  ui: 'connect', // connect | lobby | vote | mission | results | gameover
  // Public state from server:
  roomCode: '',
  me: null,         // {playerId, name, isHost, roleKnown: bool}
  players: [],      // [{id,name,connected}]
  phase: 'lobby',
  round: 1,
  leaderIndex: 0,
  voteTrack: 0,
  missionResults: [],
  teamSelection: [],
  twoFailsRequired: true,
  // Local ephemeral
  myVote: null,
  myMissionCard: null,
  failCount: 0,
  spiesListForMe: [],
  serverUrl: SERVER_URL
};

function setServer(url) {
  state.serverUrl = url;
  localStorage.setItem('server_url', url);
}

function connectSocket() {
  if (!state.serverUrl) {
    return render();
  }
  socket = io(state.serverUrl, {transports:['websocket'], withCredentials:false});
  socket.on('connect', ()=>{ console.log('connected'); render(); });
  socket.on('disconnect', ()=>{ console.log('disconnected'); });
  socket.on('error_message', msg => showToast(msg));
  socket.on('state', s => { applyState(s); render(); });
  socket.on('private_role', payload => {
    state.me.roleKnown = true;
    state.spiesListForMe = payload.otherSpies || [];
    showModal('Your Role', roleCardHtml(payload.role, payload.otherSpies||[]), [{label:'Close',primary:true}]);
  });
}

function applyState(s) {
  // Merge public state
  state.roomCode = s.roomCode;
  state.players = s.players;
  state.phase = s.phase;
  state.round = s.round;
  state.leaderIndex = s.leaderIndex;
  state.voteTrack = s.voteTrack;
  state.missionResults = s.missionResults;
  state.teamSelection = s.teamSelection;
  state.twoFailsRequired = s.twoFailsRequired;
  state.failCount = s.failCount || 0;
  state.ui = s.phase==='lobby'?'lobby':(s.phase==='vote'?'vote':(s.phase==='mission'?'mission':(s.phase==='results'?'results':(s.phase==='gameover'?'gameover':'lobby'))));
  if (s.me) state.me = s.me;
}

function header() {
  const successes = state.missionResults.filter(r=>r==='S').length;
  const fails = state.missionResults.filter(r=>r==='F').length;
  return `
  <div class="header">
    <div class="brand">
      <span class="shield"></span>
      <div><div class="badge">The Resistance</div><h1>Online</h1></div>
    </div>
    <div class="tokens">
      <span class="token"><strong>${successes}</strong>&nbsp;Success</span>
      <span class="token"><strong>${fails}</strong>&nbsp;Fail</span>
    </div>
  </div>`;
}

function render() {
  let html = header();
  switch (state.ui) {
    case 'connect': html += screenConnect(); break;
    case 'lobby': html += screenLobby(); break;
    case 'vote': html += screenVote(); break;
    case 'mission': html += screenMission(); break;
    case 'results': html += screenResults(); break;
    case 'gameover': html += screenGameOver(); break;
  }
  app.innerHTML = html;
  attachHandlers();
}

function screenConnect() {
  return `
  <div class="card">
    <h2>Connect</h2>
    <div class="small">Enter your server URL (e.g., https://resistance-server.onrender.com)</div>
    <div class="row" style="margin-top:8px">
      <input id="server-url" class="input" placeholder="Server URL" value="${escapeHtml(state.serverUrl||'')}" style="flex:1"/>
      <button class="btn" data-action="setServer">Save</button>
    </div>
    <div class="divider"></div>
    <div class="grid two">
      <div class="card" style="padding:12px">
        <div class="small">Create Room</div>
        <input id="name-create" class="input" placeholder="Your name"/>
        <label class="pill" style="margin-top:8px"><input type="checkbox" id="opt-twofails" ${state.twoFailsRequired?'checked':''}/> Mission 4 needs 2 fails (7+)</label>
        <button class="btn primary block" data-action="createRoom" style="margin-top:8px">Create</button>
      </div>
      <div class="card" style="padding:12px">
        <div class="small">Join Room</div>
        <input id="room-code" class="input" placeholder="Code (ABCD)" maxlength="6" style="text-transform:uppercase"/>
        <input id="name-join" class="input" placeholder="Your name" style="margin-top:6px"/>
        <button class="btn block" data-action="joinRoom" style="margin-top:8px">Join</button>
      </div>
    </div>
    <div class="notice small" style="margin-top:8px">Share the room code so friends can join from their own phones.</div>
  </div>`;
}

function screenLobby() {
  const leader = state.players[state.leaderIndex] || {};
  const isLeader = state.me && leader && leader.id===state.me.playerId;
  const count = state.players.length;
  const needed = TEAM_SIZES[count] ? TEAM_SIZES[count][state.round-1] : 0;
  return `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <div><div class="small">Room</div><div style="font-size:22px">${escapeHtml(state.roomCode)}</div></div>
      <div><div class="small">Round</div><div style="font-size:22px">${state.round}/5</div></div>
      <div><div class="small">Vote Track</div><div class="tokens">${Array.from({length:5},(_,i)=>`<span class="circle ${i<state.voteTrack?'loss':''}"></span>`).join('')}</div></div>
    </div>
    <div class="divider"></div>
    <div class="small">Players</div>
    <div class="row" style="margin-top:6px">${state.players.map((p,i)=>`<span class="player-tag ${i===state.leaderIndex?'selected':''}"><span class="pill small">#${i+1}</span>${escapeHtml(p.name)}${p.connected?'':' (dc)'}</span>`).join('')}</div>
    <div class="divider"></div>
    <div class="small">Leader: <strong>${escapeHtml(leader.name||'')}</strong></div>
    ${isLeader ? `
      <div class="small" style="margin-top:6px">Select ${needed} players:</div>
      <div class="row" style="margin-top:6px">
        ${state.players.map(p=>{
          const on = state.teamSelection.includes(p.id);
          return `<button class="player-tag ${on?'selected':''}" data-action="toggleMember" data-id="${p.id}">${escapeHtml(p.name)}</button>`;
        }).join('')}
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn" data-action="clearTeam">Clear</button>
        <button class="btn primary" data-action="proposeTeam">Propose Team</button>
      </div>
    ` : `<div class="notice small" style="margin-top:6px">Waiting for leader to propose a team…</div>`}
    ${state.me && state.me.isHost && state.players.length>=5 ? `<div class="row" style="margin-top:12px"><button class="btn success" data-action="startGame">Start / Redeal</button></div>`:''}
  </div>`;
}

function screenVote() {
  const leader = state.players[state.leaderIndex] || {};
  const myVoted = state.myVote!==null;
  const count = state.players.length;
  const needed = TEAM_SIZES[count] ? TEAM_SIZES[count][state.round-1] : 0;
  const teamNames = state.players.filter(p=>state.teamSelection.includes(p.id)).map(p=>p.name).join(', ');
  return `
  <div class="card">
    <h2>Team Vote</h2>
    <div class="small">Leader <strong>${escapeHtml(leader.name||'')}</strong> proposed: ${escapeHtml(teamNames)} (need ${needed})</div>
    <div class="grid two" style="margin-top:10px">
      <button class="btn success" data-action="vote" data-v="yes" ${myVoted?'disabled':''}>Approve</button>
      <button class="btn danger" data-action="vote" data-v="no" ${myVoted?'disabled':''}>Reject</button>
    </div>
    ${myVoted?'<div class="notice small" style="margin-top:8px">Vote submitted. Waiting for others…</div>':''}
  </div>`;
}

function screenMission() {
  const onTeam = state.teamSelection.includes(state.me.playerId);
  return `
  <div class="card">
    <h2>Mission</h2>
    ${onTeam ? `
      <div class="small">Choose your mission card:</div>
      <div class="grid two" style="margin-top:8px">
        <button class="btn success" data-action="missionCard" data-c="S">Success</button>
        <button class="btn danger" data-action="missionCard" data-c="F">Fail</button>
      </div>
      <div class="help" style="margin-top:8px">If you're Resistance, Fail is disabled on server.</div>
    ` : `<div class="notice small">You're not on this mission. Waiting for results…</div>`}
  </div>`;
}

function screenResults() {
  const needsTwo = state.twoFailsRequired && state.players.length>=7 && state.round===4;
  const missionFailed = needsTwo ? (state.failCount>=2) : (state.failCount>=1);
  const status = missionFailed ? 'FAILED' : 'SUCCEEDED';
  const color = missionFailed ? '#e04444' : '#22a65b';
  return `
  <div class="card">
    <h2>Mission Results</h2>
    <div class="pill">Fails revealed: <strong>${state.failCount}</strong>${needsTwo?' (need ≥2 to fail)':''}</div>
    <div class="role-card" style="margin-top:10px">
      <div class="role-name" style="color:${color}">${status}</div>
    </div>
    ${state.me && state.me.isHost ? `<div class="row" style="margin-top:10px"><button class="btn primary" data-action="nextRound">Continue</button></div>`:''}
  </div>`;
}

function screenGameOver() {
  const succ = state.missionResults.filter(r=>r==='S').length;
  const winRes = succ>=3;
  const spies = state.players.filter(p=> (state.spiesListForMe||[]).includes(p.name)); // fallback if server exposes later
  return `
  <div class="card">
    <h2>Game Over</h2>
    <div class="role-card">
      <div class="role-name" style="color:${winRes?'#22a65b':'#e04444'}">${winRes?'RESISTANCE VICTORY':'SPIES WIN'}</div>
      <div class="role-team small">Missions: ${state.missionResults.map(r=>r==='S'?'✅':'❌').join(' ')}</div>
    </div>
    <div class="divider"></div>
    <div class="small">Ask the host to reveal the spies to everyone.</div>
  </div>`;
}

// ---------- Utilities ----------
function escapeHtml(s){return (s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));}
function roleCardHtml(role, others){
  const isSpy = role==='SPY';
  return `<div class="role-card">
    <div class="shield ${isSpy?'spy':'res'}" style="margin-bottom:8px"></div>
    <div class="small">${isSpy?'You are a':'You are'}</div>
    <div class="role-name">${isSpy?'A SPY':'RESISTANCE'}</div>
    ${isSpy?`<hr/><div class="help">Other spies: <strong>${others.join(', ')||'(none)'}</strong></div>`:''}
  </div>`;
}

function attachHandlers(){
  document.querySelectorAll('[data-action]').forEach(el=>el.addEventListener('click', onAction));
}

function onAction(e){
  const a = e.currentTarget.dataset.action;
  switch(a){
    case 'setServer': {
      const url = document.getElementById('server-url').value.trim();
      if(!url){alert('Enter server URL'); return;}
      setServer(url);
      connectSocket();
      break;
    }
    case 'createRoom': {
      if (!socket || !socket.connected) { alert('Connect to server first'); return; }
      const name = document.getElementById('name-create').value.trim() || 'Host';
      const two = document.getElementById('opt-twofails').checked;
      socket.emit('create_room', {name, twoFailsRequired: two}, (res)=>{
        if(!res.ok){ alert(res.error||'Failed'); return; }
        applyState(res.state);
        state.me = res.me;
        state.ui = 'lobby'; render();
      });
      break;
    }
    case 'joinRoom': {
      if (!socket || !socket.connected) { alert('Connect to server first'); return; }
      const code = (document.getElementById('room-code').value||'').toUpperCase().trim();
      const name = document.getElementById('name-join').value.trim() || 'Player';
      socket.emit('join_room', {code, name}, (res)=>{
        if(!res.ok){ alert(res.error||'Failed'); return; }
        applyState(res.state);
        state.me = res.me;
        state.ui = 'lobby'; render();
      });
      break;
    }
    case 'toggleMember': {
      const id = e.currentTarget.dataset.id;
      socket.emit('toggle_member', {room: state.roomCode, memberId: id});
      break;
    }
    case 'clearTeam': {
      socket.emit('clear_team', {room: state.roomCode});
      break;
    }
    case 'proposeTeam': {
      socket.emit('propose_team', {room: state.roomCode});
      break;
    }
    case 'startGame': {
      socket.emit('start_game', {room: state.roomCode});
      break;
    }
    case 'vote': {
      const v = e.currentTarget.dataset.v==='yes';
      state.myVote = v;
      socket.emit('submit_vote', {room: state.roomCode, approve: v});
      render();
      break;
    }
    case 'missionCard': {
      const c = e.currentTarget.dataset.c;
      state.myMissionCard = c;
      socket.emit('submit_mission', {room: state.roomCode, card: c});
      render();
      break;
    }
    case 'nextRound': {
      socket.emit('next_round', {room: state.roomCode});
      break;
    }
  }
}

function showModal(title, html, actions=[{label:'OK',primary:true}]){
  const tpl = document.getElementById('modal-template');
  const node = tpl.content.cloneNode(true);
  const backdrop = node.querySelector('.modal-backdrop');
  const content = node.querySelector('.modal-content');
  const acts = node.querySelector('.modal-actions');
  content.innerHTML = `<h3>${title}</h3><div class="help" style="margin-top:6px">${html}</div>`;
  actions.forEach(a=>{
    const b = document.createElement('button');
    b.className = 'btn'+(a.primary?' primary':'')+(a.danger?' danger':'');
    b.textContent = a.label;
    b.addEventListener('click', ()=>document.body.removeChild(backdrop));
    acts.appendChild(b);
  });
  document.body.appendChild(backdrop);
}
function showToast(msg){ console.log(msg); }

// Boot
render();
if (state.serverUrl) connectSocket();
