const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (_, res)=>res.send('Resistance server running'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

const TEAM_SIZES = {5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
const SPY_COUNT = {5:2,6:2,7:3,8:3,9:3,10:4};
const rooms = new Map(); // code -> room

function codeGen(len=4){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  if (rooms.has(s)) return codeGen(len);
  return s;
}
function shuffle(a){
  const arr = a.slice();
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}
function publicState(room, meId){
  const me = room.players.find(p=>p.id===meId);
  return {
    roomCode: room.code,
    players: room.players.map(p=>({id:p.id,name:p.name,connected: p.socketId?true:false})),
    phase: room.phase,
    round: room.round,
    leaderIndex: room.leaderIndex,
    voteTrack: room.voteTrack,
    missionResults: room.missionResults.slice(),
    teamSelection: room.teamSelection.slice(),
    twoFailsRequired: room.twoFailsRequired,
    failCount: room.failCount||0,
    me: me?{playerId: me.id, name: me.name, isHost: me.isHost, roleKnown: !!me.role}:null
  };
}
function neededForRound(room){
  const count = room.players.length;
  return TEAM_SIZES[count][room.round-1];
}

io.on('connection', (socket)=>{
  let boundRoom = null;
  let meId = null;

  function emitRoom(){
    if (!boundRoom) return;
    io.to(boundRoom.code).emit('state', publicState(boundRoom, null));
    // Personal state to each player (me field)
    boundRoom.players.forEach(p=>{
      if (p.socketId) io.to(p.socketId).emit('state', publicState(boundRoom, p.id));
    });
  }

  socket.on('create_room', (payload, cb)=>{
    try{
      const code = codeGen(4);
      const room = {
        code,
        players: [],
        phase: 'lobby',
        round: 1,
        leaderIndex: 0,
        voteTrack: 0,
        missionResults: [],
        teamSelection: [],
        votes: new Map(), // playerId -> true/false
        missionCards: new Map(), // playerId -> 'S'|'F'
        twoFailsRequired: !!payload.twoFailsRequired,
        failCount: 0
      };
      rooms.set(code, room);
      const player = {
        id: socket.id, // simplest id
        name: (payload.name||'Host').slice(0,24),
        isHost: true,
        socketId: socket.id,
        role: null
      };
      room.players.push(player);
      socket.join(code);
      boundRoom = room;
      meId = player.id;
      cb({ok:true, state: publicState(room, meId), me: {playerId: meId, name: player.name, isHost: true}});
      emitRoom();
    }catch(e){ cb({ok:false,error:e.message}); }
  });

  socket.on('join_room', (payload, cb)=>{
    try{
      const code = (payload.code||'').toUpperCase();
      const room = rooms.get(code);
      if (!room) return cb({ok:false, error:'Room not found'});
      if (room.phase!=='lobby') return cb({ok:false, error:'Game already started'});
      if (room.players.length>=10) return cb({ok:false, error:'Room full'});
      const player = { id: socket.id, name: (payload.name||'Player').slice(0,24), isHost:false, socketId: socket.id, role: null };
      room.players.push(player);
      socket.join(code);
      boundRoom = room; meId = player.id;
      cb({ok:true, state: publicState(room, meId), me:{playerId: meId, name: player.name, isHost:false}});
      emitRoom();
    }catch(e){ cb({ok:false,error:e.message}); }
  });

  socket.on('start_game', ({room: code})=>{
    const room = rooms.get(code);
    if (!room) return;
    const host = room.players.find(p=>p.isHost);
    if (!host || host.id!==socket.id) return;
    if (room.players.length<5) return io.to(socket.id).emit('error_message','Need at least 5 players');
    // deal roles
    room.phase = 'lobby';
    room.round = 1;
    room.voteTrack = 0;
    room.missionResults = [];
    room.teamSelection = [];
    room.votes = new Map();
    room.missionCards = new Map();
    room.failCount = 0;
    room.leaderIndex = Math.floor(Math.random()*room.players.length);
    const count = room.players.length;
    const spiesNeeded = SPY_COUNT[count];
    const idxs = shuffle(room.players.map((_,i)=>i));
    const spyIdx = new Set(idxs.slice(0, spiesNeeded));
    room.players.forEach((p,i)=> p.role = spyIdx.has(i) ? 'SPY' : 'RES' );
    const spies = room.players.filter(p=>p.role==='SPY').map(p=>p.name);
    // private role DM
    room.players.forEach(p=>{
      if (p.socketId) io.to(p.socketId).emit('private_role', {role: p.role, otherSpies: p.role==='SPY' ? spies.filter(n=>n!==p.name) : []});
    });
    emitRoom();
  });

  socket.on('toggle_member', ({room: code, memberId})=>{
    const room = rooms.get(code); if(!room) return;
    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id!==socket.id) return;
    const needed = neededForRound(room);
    const i = room.teamSelection.indexOf(memberId);
    if (i>=0) room.teamSelection.splice(i,1);
    else if (room.teamSelection.length<needed) room.teamSelection.push(memberId);
    emitRoom();
  });

  socket.on('clear_team', ({room: code})=>{
    const room = rooms.get(code); if(!room) return;
    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id!==socket.id) return;
    room.teamSelection = [];
    emitRoom();
  });

  socket.on('propose_team', ({room: code})=>{
    const room = rooms.get(code); if(!room) return;
    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id!==socket.id) return;
    const needed = neededForRound(room);
    if (room.teamSelection.length!==needed) return;
    room.phase = 'vote';
    room.votes = new Map();
    emitRoom();
  });

  socket.on('submit_vote', ({room: code, approve})=>{
    const room = rooms.get(code); if(!room) return;
    const player = room.players.find(p=>p.id===socket.id); if(!player) return;
    if (room.phase!=='vote') return;
    room.votes.set(player.id, !!approve);
    if (room.votes.size === room.players.length){
      // tally
      let yes=0; room.votes.forEach(v=>{ if(v) yes++; });
      const approved = yes > (room.players.length - yes); // ties reject
      if (!approved){
        room.voteTrack += 1;
        room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
        if (room.voteTrack >= 5){
          // spies win
          room.missionResults = ['F','F','F'];
          room.phase = 'gameover';
        } else {
          room.phase = 'lobby';
          room.teamSelection = [];
        }
      } else {
        room.voteTrack = 0;
        room.phase = 'mission';
        room.missionCards = new Map();
      }
      emitRoom();
    } else {
      emitRoom();
    }
  });

  socket.on('submit_mission', ({room: code, card})=>{
    const room = rooms.get(code); if(!room) return;
    const player = room.players.find(p=>p.id===socket.id); if(!player) return;
    if (room.phase!=='mission') return;
    if (!room.teamSelection.includes(player.id)) return;
    if (player.role==='RES' && card==='F') return; // block cheating
    room.missionCards.set(player.id, card==='F'?'F':'S');
    if (room.missionCards.size === room.teamSelection.length){
      // reveal fails count, compute result
      let fails = 0; room.missionCards.forEach(c=>{ if(c==='F') fails++; });
      room.failCount = fails;
      room.phase = 'results';
      emitRoom();
    } else {
      emitRoom();
    }
  });

  socket.on('next_round', ({room: code})=>{
    const room = rooms.get(code); if(!room) return;
    const host = room.players.find(p=>p.isHost);
    if (!host || host.id!==socket.id) return;
    if (room.phase!=='results') return;
    const needsTwo = room.twoFailsRequired && room.players.length>=7 && room.round===4;
    const missionFailed = needsTwo ? (room.failCount>=2) : (room.failCount>=1);
    room.missionResults.push(missionFailed?'F':'S');
    const succ = room.missionResults.filter(r=>r==='S').length;
    const fail = room.missionResults.filter(r=>r==='F').length;
    if (succ>=3 || fail>=3){
      room.phase = 'gameover';
      emitRoom();
      return;
    }
    room.round += 1;
    room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
    room.teamSelection = [];
    room.votes = new Map();
    room.missionCards = new Map();
    room.failCount = 0;
    room.phase = 'lobby';
    emitRoom();
  });

  socket.on('disconnect', ()=>{
    // mark player as disconnected in their room
    if (boundRoom){
      const p = boundRoom.players.find(p=>p.id===socket.id);
      if (p){ p.socketId = null; }
      emitRoom();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log('Server listening on '+PORT));
