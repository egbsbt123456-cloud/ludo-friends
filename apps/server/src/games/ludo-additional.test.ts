import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../app.js';
import {openDatabase,migrate} from '../database/index.js';
import {ludoEngine as E} from '@board/game-core';
const origin='https://board.test',headers=(id:string)=>({origin,cookie:'board_session='+id});
it('preserves dice/pass events, rejects corrupted states and completes all four planes',()=>{
 let state=E.createInitialState(['red','yellow']);const roll=E.safeRoll(state,2);if(!roll.ok)throw Error(roll.code);
 const skip=E.safePass(roll.state);expect(skip.ok&&skip.state.turnIndex).toBe(1);expect(skip.ok&&skip.state.lastEvents.map(e=>e.kind)).toEqual(['roll','skip']);
 const six=E.safeRoll(state,6);if(!six.ok)throw Error(six.code);expect(E.safePass(six.state)).toMatchObject({ok:false,code:'MOVE_AVAILABLE'});
 state.pieces.red.forEach(p=>{p.position=56;p.finished=true;});state.pieces.red[3]={position:55,finished:false};state.rolled=true;state.dice=1;
 const win=E.safeMove(state,3);expect(win.ok&&win.state.winner).toBe('red');expect(win.ok&&win.state.over).toBe(true);
 expect(E.safeRoll({...state,pieces:null} as any,1)).toMatchObject({ok:false,code:'BAD_STATE'});
});
it.each(['3','4'])('fills a %s-player room with one seat per account, versions partial joins and persists no-move skips',async preset=>{
 const dir=mkdtempSync(join(tmpdir(),'ludo-multi-')),path=join(dir,'db.sqlite');const db=openDatabase(path);migrate(db.sqlite);
 const users=['a','b','c','d','e'];for(const u of users){db.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(u,u,u,'unused',Date.now());db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(u).digest('hex'),u,Date.now()+60000);}db.sqlite.close();
 const app=createApp({databasePath:path,origin,logger:false,production:true,rollDice:()=>2}).app;
 const post=(url:string,user:string,payload:any)=>app.inject({method:'POST',url,headers:headers(user),payload});
 try{
  const made=await post('/api/ludo/rooms','a',{preset});expect(made.statusCode).toBe(201);const base='/api/ludo/rooms/'+made.json().code;let room=made.json();
  const first=await post(base+'/join','b',{});room=first.json();expect(room.status).toBe('waiting');expect(room.state.version).toBe(1);
  expect((await post(base+'/actions','b',{type:'cancel',requestId:randomUUID(),expectedVersion:1})).statusCode).toBe(409);
  expect((await post(base+'/join','b',{})).json().state.version).toBe(1);
  for(const u of users.slice(2,Number(preset))){const result=await post(base+'/join',u,{});expect(result.statusCode).toBe(200);room=result.json();}
  expect(room.status).toBe('playing');expect(room.seats.filter((s:any)=>s.name)).toHaveLength(Number(preset));
  expect((await post(base+'/join','e',{})).statusCode).toBe(409);
  const action={type:'roll',requestId:randomUUID(),expectedVersion:room.state.version};const result=await post(base+'/actions','a',action);expect(result.statusCode).toBe(200);room=result.json();expect(room.state.turnIndex).toBe(1);expect(room.state.rolled).toBe(false);expect(room.state.lastEvents.at(-1).kind).toBe('skip');
  expect((await post(base+'/actions','a',action)).json().state.version).toBe(room.state.version);
  expect((await post(base+'/actions','a',{...action,requestId:randomUUID(),dice:6})).statusCode).toBe(400);
  expect((await post(base+'/actions','a',{...action,requestId:randomUUID()})).statusCode).toBe(409);
  expect((await app.inject({url:base,headers:headers('a')})).json().state).toEqual(room.state);
 }finally{await app.close();if(dirname(dir)===tmpdir()&&basename(dir).startsWith('ludo-multi-'))rmSync(dir,{recursive:true,force:true});}
});
