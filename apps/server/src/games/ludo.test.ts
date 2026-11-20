import {it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {openDatabase,migrate} from '../database/index.js';
import {createApp} from '../app.js';
const origin='https://board.test';
const headers=(user:string)=>({origin,cookie:`board_session=${user}`});
it('keeps server and browser rule engines identical',()=>{
  expect(readFileSync(new URL('../../../../packages/game-core/src/ludo-engine.cjs',import.meta.url),'utf8')).toBe(readFileSync(new URL('../../../web/public/ludo/js/engine.js',import.meta.url),'utf8'));
});
it('authenticates rooms, serializes joins and moves, rejects forgery, survives restart and ends by resignation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'board-ludo-')),path=join(dir,'db.sqlite');
  const data=openDatabase(path);migrate(data.sqlite);
  for(const user of ['alice','bob','carol']){
   data.sqlite.prepare('INSERT INTO users(id,username,nickname,password_hash,created_at) VALUES(?,?,?,?,?)').run(user,user,user,'unused',Date.now());
   data.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(user).digest('hex'),user,Date.now()+60000);
  }data.sqlite.close();
  let app=createApp({databasePath:path,origin,production:true,logger:false,rollDice:()=>6}).app;
  const post=(url:string,user:string,payload:object)=>app.inject({method:'POST',url,headers:headers(user),payload});
  const cmd=(type:string,expectedVersion:number,extra:object={},requestId=randomUUID())=>({type,expectedVersion,requestId,...extra});
  try{
   expect((await app.inject('/api/ludo/rooms')).statusCode).toBe(401);
   expect((await app.inject({method:'POST',url:'/api/ludo/rooms',headers:{...headers('alice'),origin:'https://evil.test'},payload:{preset:'2a'}})).statusCode).toBe(403);
   const created=await post('/api/ludo/rooms','alice',{preset:'2a'});expect(created.statusCode).toBe(201);
   const room=created.json(),base=`/api/ludo/rooms/${room.code}`;
   expect(room.status).toBe('waiting');expect(room.yourColor).toBe('red');expect(room.seats.map((s:{color:string})=>s.color)).toEqual(['red','yellow']);
   expect(JSON.stringify(room)).not.toContain('user_id');
   expect((await post(base+'/actions','alice',cmd('roll',0))).statusCode).toBe(409);
   expect((await app.inject({url:base,headers:headers('bob')})).statusCode).toBe(404);
   expect((await post(base+'/join','alice',{})).json().yourColor).toBe('red');
   const joins=await Promise.all([post(base+'/join','bob',{}),post(base+'/join','carol',{})]);
   expect(joins.map(r=>r.statusCode).sort()).toEqual([200,409]);const second=joins[0]!.statusCode===200?'bob':'carol',third=second==='bob'?'carol':'bob';
   expect((await post(base+'/join',second,{})).json().yourColor).toBe('yellow');
   expect((await app.inject({url:base,headers:headers(third)})).statusCode).toBe(404);
   expect((await post(base+'/actions',third,cmd('resign',1))).statusCode).toBe(404);
   expect((await post(base+'/actions',second,cmd('roll',1))).statusCode).toBe(409); // 没轮到黄
   const roll=cmd('roll',1);const rolled=await post(base+'/actions','alice',roll);
   expect(rolled.statusCode).toBe(200);expect(rolled.json().state.rolled).toBe(true);expect(rolled.json().state.dice).toBeGreaterThanOrEqual(1);
   expect((await post(base+'/actions','alice',roll)).json().state.version).toBe(2); // 幂等重放
   expect((await post(base+'/actions','alice',{...roll,requestId:randomUUID(),type:'move',piece:9} as object)).statusCode).toBe(400); // piece 越界拒收
   const version=rolled.json().state.version;
   const move=cmd('move',version,{piece:0});
   const moved=await post(base+'/actions','alice',move);
   if(moved.json().state?.dice===null&&moved.json().state?.rolled===false){/*可能无子可动被跳过*/}
   expect(moved.statusCode).toBe(200);
   expect((await post(base+'/actions','alice',cmd('cancel',999))).statusCode).toBe(409);
   await app.close();app=createApp({databasePath:path,origin,production:true,logger:false,rollDice:()=>6}).app;
   const saved=(await app.inject({url:base,headers:headers('alice')})).json();expect(saved.state.version).toBe(moved.json().state.version);
   expect((await app.inject({url:'/api/ludo/rooms',headers:headers(second)})).json().rooms).toHaveLength(1);
   const resign=cmd('resign',moved.json().state.version);
   const ended=await post(base+'/actions',second,resign);expect(ended.statusCode).toBe(200);expect(ended.json().status).toBe('finished');
   expect((await post(base+'/actions',second,resign)).statusCode).toBe(200); // 幂等
   const pending=(await post('/api/ludo/rooms','alice',{preset:'2a'})).json();
   const cancelled=await post(`/api/ludo/rooms/${pending.code}/actions`,'alice',cmd('cancel',0));expect(cancelled.json().status).toBe('cancelled');
   expect((await post(`/api/ludo/rooms/${pending.code}/join`,second,{})).statusCode).toBe(409);
   const check=openDatabase(path);check.sqlite.prepare("UPDATE users SET status='disabled' WHERE id='alice'").run();check.sqlite.close();
   expect((await app.inject({url:base,headers:headers('alice')})).statusCode).toBe(401);
  }finally{await app.close();if(dirname(dir)===tmpdir()&&basename(dir).startsWith('board-ludo-'))rmSync(dir,{recursive:true,force:true});}
});
it('does not open friend rooms on production HTTP',async()=>{
  const {app}=createApp({databasePath:':memory:',origin:'http://board.test',production:true,logger:false,rollDice:()=>6});
  try{expect((await app.inject('/api/ludo/rooms')).statusCode).toBe(503);}finally{await app.close();}
});
