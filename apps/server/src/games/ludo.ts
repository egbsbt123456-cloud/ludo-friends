import { randomBytes, createHash, randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ludoEngine as engine } from '@board/game-core';
import type { LudoState, LudoRoomView, LudoColor } from '@board/contracts';
import { sessionUser, type SessionUser } from '../auth/session.js';

type Room = {code:string;players:string;status:LudoRoomView['status'];state:string;version:number;created_at:number;updated_at:number};
type Seat = {room_code:string;color:LudoColor;user_id:string;joined_at:number};
class Refusal extends Error {constructor(public status:number,message:string){super(message);}}
const color=z.enum(['red','yellow','blue','green']);
const codeSchema=z.string().regex(/^[A-F0-9]{10}$/);
const action=z.discriminatedUnion('type',[
  z.object({type:z.literal('roll'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict(),
  z.object({type:z.literal('move'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative(),piece:z.number().int().min(0).max(3)}).strict(),
  z.object({type:z.literal('resign'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict(),
  z.object({type:z.literal('cancel'),requestId:z.uuid(),expectedVersion:z.number().int().nonnegative()}).strict(),
]);

const SEAT_PRESETS:Record<string,LudoColor[]> = {
  '2a': ['red','yellow'], '2b': ['blue','green'], '3': ['red','yellow','blue'], '4': ['red','green','yellow','blue']
};

export function registerLudo(app:FastifyInstance,db:Database.Database,origin:string,production:boolean,rollDice:()=>number=()=>randomInt(1,7)){
  app.register(async routes=>{
    const identities=new WeakMap<FastifyRequest,SessionUser>();
    const limits=new Map<string,{n:number;until:number}>();
    routes.addHook('preHandler',async(req,reply)=>{
      if(production&&!origin.startsWith('https://'))return reply.code(503).send({error:'好友同玩需要 HTTPS'});
      const user=sessionUser(db,req.headers.cookie);
      if(!user)return reply.code(401).send({error:'请先登录，再与好友同玩'});
      identities.set(req,user);
      if(req.method==='GET')return;
      if(req.headers.origin!==origin)return reply.code(403).send({error:'请求来源不允许'});
      const now=Date.now();
      for(const [key,v] of limits)if(v.until<now)limits.delete(key);
      if(limits.size>=10000&&!limits.has(user.id))return reply.code(429).send({error:'请求繁忙，请稍后重试'});
      const limit=limits.get(user.id)??{n:0,until:now+60000};limits.set(user.id,limit);
      if(++limit.n>60)return reply.code(429).send({error:'操作太频繁，请稍后重试'});
    });
    routes.setErrorHandler((err,req,reply)=>{
      if(err instanceof Refusal)return reply.code(err.status).send({error:err.message});
      req.log.error(err);return reply.code(500).send({error:'房间服务暂时不可用，请稍后重试'});
    });
    const getRoom=(code:string)=>db.prepare('SELECT * FROM ludo_rooms WHERE code=?').get(code) as Room|undefined;
    const parseCode=(req:FastifyRequest)=>{
      const parsed=z.object({code:codeSchema}).safeParse(req.params);
      if(!parsed.success)throw new Refusal(400,'房间码应为 10 位字母和数字');return parsed.data.code;
    };
    const seatsOf=(code:string)=>db.prepare('SELECT * FROM ludo_seats WHERE room_code=? ORDER BY joined_at').all(code) as Seat[];
    const member=(room:Room|undefined,user:SessionUser):Room=>{
      if(!room||!seatsOf(room.code).some(s=>s.user_id===user.id))throw new Refusal(404,'房间不存在，或你尚未加入');
      return room;
    };
    const view=(room:Room,user:SessionUser):LudoRoomView=>{
      const name=(id:string)=>(db.prepare('SELECT nickname FROM users WHERE id=?').get(id) as {nickname:string}|undefined)?.nickname??'玩家';
      const players=JSON.parse(room.players) as LudoColor[];
      const seats=seatsOf(room.code);
      return {code:room.code,status:room.status,seats:players.map(c=>({color:c,name:seats.find(s=>s.color===c)?.user_id?name(seats.find(s=>s.color===c)!.user_id):null})),yourColor:seats.find(s=>s.user_id===user.id)?.color??null,state:JSON.parse(room.state),updatedAt:room.updated_at};
    };
    routes.get('/rooms',req=>{
      const user=identities.get(req)!;
      const rooms=db.prepare("SELECT r.* FROM ludo_rooms r JOIN ludo_seats s ON s.room_code=r.code WHERE s.user_id=? AND r.status IN ('waiting','playing') ORDER BY r.updated_at DESC LIMIT 3").all(user.id) as Room[];
      return {rooms:rooms.map(r=>view(r,user))};
    });
    routes.post('/rooms',(req,reply)=>{
      const preset=z.object({preset:z.enum(['2a','2b','3','4'])}).strict().safeParse(req.body);
      if(!preset.success)throw new Refusal(400,'建房参数不正确');
      const user=identities.get(req)!;
      const result=db.transaction(()=>{
        const active=db.prepare("SELECT count(*) AS n FROM ludo_rooms r JOIN ludo_seats s ON s.room_code=r.code WHERE s.user_id=? AND r.status IN ('waiting','playing')").get(user.id) as {n:number};
        if(active.n>=3)throw new Refusal(409,'已有 3 个未结束房间，请先继续或结束对局');
        const recent=db.prepare("SELECT count(*) AS n FROM ludo_rooms r JOIN ludo_seats s ON s.room_code=r.code WHERE s.user_id=? AND r.created_at>?").get(user.id,Date.now()-3600000) as {n:number};
        if(recent.n>=20)throw new Refusal(429,'本小时建房较多，请稍后再试');
        let code:string;do{code=randomBytes(5).toString('hex').toUpperCase();}while(getRoom(code));
        const players=SEAT_PRESETS[preset.data.preset],state=engine.createInitialState(players),now=Date.now();
        db.prepare("INSERT INTO ludo_rooms VALUES(?,?,'waiting',?,0,?,?)").run(code,JSON.stringify(players),JSON.stringify(state),now,now);
        db.prepare('INSERT INTO ludo_seats VALUES(?,?,?,?)').run(code,players[0],user.id,now);
        return view(getRoom(code)!,user);
      })();return reply.code(201).send(result);
    });
    routes.get('/rooms/:code',req=>{const user=identities.get(req)!;return view(member(getRoom(parseCode(req)),user),user);});
    routes.post('/rooms/:code/join',req=>{
      if(!z.object({}).strict().safeParse(req.body).success)throw new Refusal(400,'加入参数不正确');
      const code=parseCode(req),user=identities.get(req)!;
      return db.transaction(()=>{
        const room=getRoom(code);
        if(!room)throw new Refusal(404,'没有找到这个房间，请检查房间码');
        const seats=seatsOf(code),players=JSON.parse(room.players) as LudoColor[];
        const mine=seats.find(s=>s.user_id===user.id);
        if(mine)return view(room,user);
        if(room.status!=='waiting'||seats.length>=players.length)throw new Refusal(409,'该房间已满或已结束');
        const active=db.prepare("SELECT count(*) AS n FROM ludo_rooms r JOIN ludo_seats s ON s.room_code=r.code WHERE s.user_id=? AND r.status IN ('waiting','playing')").get(user.id) as {n:number};
        if(active.n>=3)throw new Refusal(409,'请先结束一个已有房间');
        const free=players.find(c=>!seats.some(s=>s.color===c))!;
        db.prepare('INSERT INTO ludo_seats VALUES(?,?,?,?)').run(code,free,user.id,Date.now());
        let state=JSON.parse(room.state) as LudoState;
        state={...state,version:state.version+1};
        db.prepare('UPDATE ludo_rooms SET status=?,state=?,version=?,updated_at=? WHERE code=?').run(seats.length+1===players.length?'playing':'waiting',JSON.stringify(state),state.version,Date.now(),code);
        return view(getRoom(code)!,user);
      })();
    });
    routes.post('/rooms/:code/actions',req=>{
      const parsed=action.safeParse(req.body);if(!parsed.success)throw new Refusal(400,'走棋参数不正确');
      const code=parseCode(req),user=identities.get(req)!,input=parsed.data;
      const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return db.transaction(()=>{
        const room=member(getRoom(code),user);
        const old=db.prepare('SELECT user_id,fingerprint FROM ludo_requests WHERE room_code=? AND request_id=?').get(code,input.requestId) as {user_id:string;fingerprint:string}|undefined;
        if(old){if(old.user_id!==user.id||old.fingerprint!==fingerprint)throw new Refusal(409,'请求编号已被使用');return view(room,user);}
        if(room.version!==input.expectedVersion)throw new Refusal(409,'棋局已更新，请同步后再走');
        const myColor=seatsOf(code).find(s=>s.user_id===user.id)!.color;
        let state=JSON.parse(room.state) as LudoState;
        let status=room.status;
        if(input.type==='cancel'){
          if(status!=='waiting'||myColor!==state.players[0])throw new Refusal(409,'仅房主可取消尚未开始的房间');
          status='cancelled';state={...state,over:true,reason:'cancelled',version:state.version+1};
        }else{
          if(status!=='playing'||state.over)throw new Refusal(409,'对局尚未开始或已结束');
          if(input.type==='resign'){
            state={...state,over:true,reason:'resign',version:state.version+1};status='finished';
          }else{
            if(state.players[state.turnIndex]!==myColor)throw new Refusal(409,'还没有轮到你走棋');
            if(input.type==='roll'){
            const dice=rollDice();
            const next=engine.safeRoll(state,dice);
            if(!next.ok)throw new Refusal(409,'当前不能掷骰子');
            state=next.state;
            if(engine.movablePieces(state).length===0){ // 无子可动：直接跳到下家（保持 rolled 状态可查询）
              const passed=engine.safePass(state);if(!passed.ok)throw new Refusal(409,'当前不能跳过');state=passed.state;
            }
          }else{
            const next=engine.safeMove(state,input.piece);
            if(!next.ok)throw new Refusal(409,next.code==='NOT_ROLLED'?'请先掷骰子':next.code==='NEED_SIX'?'起飞需要掷出 6 点':'这枚棋子当前不能这样走');
            state=next.state;if(state.over)status='finished';
            }
          }
        }
        db.prepare('UPDATE ludo_rooms SET state=?,version=?,status=?,updated_at=? WHERE code=?').run(JSON.stringify(state),state.version,status,Date.now(),code);
        db.prepare('INSERT INTO ludo_requests VALUES(?,?,?,?)').run(code,input.requestId,user.id,fingerprint);
        return view(getRoom(code)!,user);
      })();
    });
  },{prefix:'/api/ludo'});
}
