<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import type {LudoRoomView,LudoColor} from '@board/contracts';
import AccountPanel from '../components/AccountPanel.vue';
const mode=ref<'select'|'local'|'friends'>('select'),frame=ref<HTMLIFrameElement>();
const user=ref<{id:string;nickname:string}|null>(null),room=ref<LudoRoomView|null>(null),rooms=ref<LudoRoomView[]>([]);
const code=ref(''),error=ref(''),busy=ref(false),syncing=ref(false),uncertain=ref(false),confirmEnd=ref(false),copied=ref(false);
let timer:ReturnType<typeof setTimeout>|undefined,stopped=false,epoch=0;
const frameSrc=computed(()=>mode.value==='friends'?'/ludo/index.html?mode=online&theme=wood-1':`/ludo/index.html?mode=${mode.value}&theme=wood-1`);
const preset=ref<'2a'|'2b'|'3'|'4'>('2a');
const colorNames:Record<LudoColor,string>={red:'红色',yellow:'黄色',blue:'蓝色',green:'绿色'};
const currentColor=computed(()=>room.value?.state.players[room.value.state.turnIndex]);
const turnLabel=computed(()=>!room.value?'':room.value.status==='waiting'?'等待好友加入':room.value.status==='cancelled'?'房间已取消':room.value.state.over?(room.value.state.winner?colorNames[room.value.state.winner]+'获胜':'本局已结束'):colorNames[currentColor.value!]+'回合');
const canRoll=computed(()=>!!room.value&&room.value.status==='playing'&&!room.value.state.over&&!room.value.state.rolled&&room.value.yourColor===currentColor.value&&!busy.value&&!uncertain.value);
class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
async function api(path:string,body?:unknown){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();if(!response.ok)throw new ApiError(result.error||'操作失败',response.status);return result;
}
function publish(){if(room.value)frame.value?.contentWindow?.postMessage({channel:'boardgame:ludo:control',room:JSON.parse(JSON.stringify(room.value))},location.origin);}
async function account(){
 const current=++epoch;room.value=null;rooms.value=[];uncertain.value=false;confirmEnd.value=false;
 try{const data=await api('/api/auth/me');if(current!==epoch)return;user.value=data.user;await listRooms(current);}
 catch{if(current===epoch)user.value=null;}
}
async function listRooms(current=epoch){try{const data=await api('/api/ludo/rooms');if(current===epoch)rooms.value=data.rooms;}catch(e){if(current===epoch)error.value=e instanceof Error?e.message:'房间暂时不可用';}}
function choose(next:typeof mode.value){mode.value=next;error.value='';confirmEnd.value=false;if(next==='friends'&&user.value)void listRooms();}
function enter(next:LudoRoomView){room.value=next;uncertain.value=false;confirmEnd.value=false;copied.value=false;error.value='';publish();}
async function createOrJoin(join:boolean){
 if(busy.value)return;busy.value=true;error.value='';const current=epoch;
 try{const key=code.value.trim().toUpperCase();if(join&&!/^[A-F0-9]{10}$/.test(key))throw new Error('请输入好友发来的 10 位房间码');const result=await api(join?`/api/ludo/rooms/${key}/join`:'/api/ludo/rooms',join?{}:{preset:preset.value});if(current===epoch)enter(result);}
 catch(e){error.value=e instanceof Error?e.message:'连接失败，请重试';}finally{busy.value=false;}
}
async function resume(key:string){try{const current=epoch;const result=await api(`/api/ludo/rooms/${key}`);if(current===epoch)enter(result);}catch(e){error.value=e instanceof Error?e.message:'恢复失败';}}
async function poll(){
 if(stopped)return;
 if(mode.value==='friends'&&room.value&&user.value&&!busy.value&&!syncing.value){
  syncing.value=true;const current=epoch,key=room.value.code;
  try{const next=await api(`/api/ludo/rooms/${key}`);if(current===epoch&&key===room.value?.code&&!busy.value&&next.state.version>=room.value.state.version){room.value=next;if(uncertain.value)error.value='';uncertain.value=false;publish();}}
  catch(e){if(current===epoch){uncertain.value=true;error.value=e instanceof Error?e.message:'连接中断，正在重试';if(e instanceof ApiError&&e.status===401){user.value=null;room.value=null;window.dispatchEvent(new Event('boardgame:account-changed'));}}}
  finally{syncing.value=false;}
 }
 timer=setTimeout(poll,1200);
}
async function act(type:'roll'|'move'|'resign'|'cancel',piece?:number,expectedVersion?:number){
 if(!room.value||busy.value)return;busy.value=true;error.value='';const current=epoch,key=room.value.code;
 const payload={type,requestId:crypto.randomUUID(),expectedVersion:expectedVersion??room.value.state.version,...(piece!==undefined?{piece}:{})};
 try{const next=await api(`/api/ludo/rooms/${key}/actions`,payload);if(current===epoch&&room.value?.code===key){room.value=next;uncertain.value=false;publish();}}
 catch(e){if(current===epoch){error.value=e instanceof Error?e.message:'走棋未确认，正在同步';uncertain.value=true;}}
 finally{busy.value=false;confirmEnd.value=false;}
}
function receive(event:MessageEvent){
 if(event.origin!==location.origin||event.source!==frame.value?.contentWindow||event.data?.channel!=='boardgame:ludo'||mode.value!=='friends')return;
 if(event.data.type==='ready')publish();
 if(event.data.type==='move'&&!uncertain.value)void act('move',event.data.data.piece,event.data.data.expectedVersion);
 else if(event.data.type==='move')publish();
}
async function copyCode(){if(!room.value)return;try{await navigator.clipboard.writeText(room.value.code);copied.value=true;}catch{error.value='复制失败，请手动选择房间码复制';}}
function back(){epoch++;room.value=null;confirmEnd.value=false;error.value='';uncertain.value=false;mode.value='select';}
onMounted(()=>{void account();void poll();window.addEventListener('message',receive);window.addEventListener('boardgame:account-changed',account);});
onUnmounted(()=>{stopped=true;epoch++;clearTimeout(timer);window.removeEventListener('message',receive);window.removeEventListener('boardgame:account-changed',account);});
</script>
<template>
 <main class="ludo-page">
  <nav><a href="#" @click.prevent="back">← 玩法首页</a><button v-if="mode!=='select'" @click="back">选择玩法</button><span class="nav-title">飞行棋</span><AccountPanel compact /></nav>
  <section v-if="mode==='select'" class="choice">
   <p class="kicker">一起起飞 · 趣味同桌</p><h1>这一局，和谁起飞？</h1><p class="intro">2–4 人，掷骰起飞，向终点前进。</p>
   <div class="choices">
    <button @click="choose('local')"><span class="piece">✈</span><h2>本地同玩</h2><p>共用一块屏幕，轮流掷骰。<br>选择 2–4 人，无需账号。</p><span>同屏开局 →</span></button>
    <button @click="choose('friends')"><span class="piece black">⚄</span><h2>好友同玩</h2><p>创建房间，分享房间码。<br>各用自己的设备，一起起飞。</p><span>邀请好友 →</span></button>
   </div>
  </section>
  <section v-if="mode==='friends'&&!room" class="friend-panel">
   <p class="kicker">好友同玩</p><h1>邀上好友，准备起飞。</h1>
   <p v-if="!user">请先点击右上角“登录 / 注册”。每位好友需要登录自己的账号。</p>
   <template v-else><p>你好，{{user.nickname}}。创建房间时选择人数，大家到齐后自动开始。</p>
    <div class="friend-actions"><div><label for="preset">人数与颜色</label><select id="preset" v-model="preset"><option value="2a">2 人 · 红 / 黄</option><option value="2b">2 人 · 蓝 / 绿</option><option value="3">3 人 · 红 / 黄 / 蓝</option><option value="4">4 人 · 红 / 绿 / 黄 / 蓝</option></select><button class="primary" :disabled="busy" @click="createOrJoin(false)">创建好友房间</button></div><span>或</span><form @submit.prevent="createOrJoin(true)"><label for="room-code">好友房间码</label><div><input id="room-code" v-model="code" maxlength="10" autocomplete="off" placeholder="10 位房间码"><button :disabled="busy">加入房间</button></div></form></div>
    <div v-if="rooms.length" class="resume"><h2>继续我的房间</h2><button v-for="item in rooms" :key="item.code" @click="resume(item.code)">{{item.code}} · {{item.status==='waiting'?'等待好友':'对局中'}} →</button></div>
   </template>
  </section>
  <div v-if="mode==='friends'&&room" class="room-bar">
   <div><strong>房间 <code>{{room.code}}</code></strong> <button @click="copyCode">{{copied?'已复制':'复制房间码'}}</button><p>你执{{room.yourColor?colorNames[room.yourColor]:'—'}} · {{turnLabel}}</p><div class="seats"><span v-for="seat in room.seats" :key="seat.color" :class="seat.color">{{colorNames[seat.color]}}：{{seat.name||'等待加入'}}</span></div></div>
   <div class="room-actions"><strong role="status">{{uncertain?'连接中断，正在同步…':turnLabel}}</strong><button v-if="room.status==='playing'" class="primary" :disabled="!canRoll" @click="act('roll')">{{busy?'正在处理…':room.state.rolled?'请选择飞机':'掷骰子'}}</button><button v-if="room.status==='playing'||(room.status==='waiting'&&room.yourColor===room.state.players[0])" :disabled="busy||uncertain" @click="confirmEnd=true">{{room.status==='waiting'?'取消房间':'放弃本局'}}</button><button v-if="room.state.over" @click="back">选择玩法</button></div>
   <div v-if="confirmEnd" class="confirm" role="alert"><span>{{room.status==='waiting'?'确定取消这个房间？':'放弃会结束整局，所有玩家都将停止本局。确定继续？'}}</span><button :disabled="busy" @click="act(room.status==='waiting'?'cancel':'resign')">确定</button><button @click="confirmEnd=false">返回对局</button></div>
  </div>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <iframe v-if="mode==='local'||(mode==='friends'&&room)" :key="mode==='friends'?room?.code:mode" ref="frame" :src="frameSrc" title="飞行棋棋盘" @load="publish" />
  <p v-if="mode==='friends'" class="footnote">离开页面会保留座位，回来后可继续。6 点起飞，6 点再掷；终点需恰好到达。</p>
 </main>
</template>
<style scoped>
.ludo-page{min-height:100dvh;background:#f8f7f2;color:#223b34;font-size:14px}
nav{display:flex;align-items:center;gap:20px;min-height:84px;padding:16px max(24px,calc((100vw - 1144px)/2));border-bottom:1px solid #dedfd5;position:relative;background:#f8f7f2}
nav>a{color:#677970;font-size:13px;white-space:nowrap}.nav-title{flex:1;font-size:19px;font-weight:750;letter-spacing:2px;white-space:nowrap}nav>div{min-width:0}nav :deep(.account-panel){color:#223b34;top:78px}nav :deep(span){overflow-wrap:anywhere}
button,input{font:inherit}button{cursor:pointer;color:#264f40;background:#fffefa;border:1px solid #d3d8cc;border-radius:6px;padding:10px 15px;transition:border-color .15s,background .15s}button:hover{background:#edf0e6;border-color:#a4b39f}button:disabled{opacity:.5;cursor:wait}
.choice,.friend-panel{max-width:1200px;margin:0 auto;padding:62px 28px 70px}.kicker{color:#7a8167;letter-spacing:3px;font-size:12px}h1{font-size:40px;letter-spacing:-1px;line-height:1.35;margin:18px 0}h2{font-size:21px;letter-spacing:0;margin:22px 0 10px}.intro,.friend-panel>p{color:#69786d;line-height:1.9}
.choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:40px}.choices>button{position:relative;text-align:left;padding:30px;background:#fffefa;border:1px solid #e0e3d9;border-radius:10px;overflow:hidden;transition:transform .15s,border-color .15s,box-shadow .15s}.choices>button:hover{transform:translateY(-3px);border-color:#9caf96;box-shadow:0 8px 24px #264f400d}.choices>button:before{content:'';position:absolute;inset:0 0 auto;height:112px;background:#e4e9d9;z-index:0}.choices>button:nth-child(2):before{background:#efe3d0}.choices>button:nth-child(3):before{background:#dce5e4}.choices h2,.choices p,.choices button>span{position:relative}.choices h2{margin-top:42px}.choices p{color:#69786d;line-height:1.9;font-size:13px;margin-bottom:28px}.choices button>span:last-child{color:#264f40;font-size:13px;font-weight:650}
.piece{display:grid;place-items:center;width:62px;height:62px;background:#fffdf4;border:1px solid #d7ceba;border-radius:50%;color:#232b27;font-family:serif;font-size:36px;box-shadow:0 3px 0 #d0d3bd}.piece.black{color:#476048}
.friend-actions{display:flex;align-items:center;gap:28px;margin:36px 0;padding:28px;background:#fffefa;border:1px solid #e0e3d9;border-radius:10px}.friend-actions>span{color:#818777}.primary{display:inline-block;background:#264f40;color:#fff;border-color:#264f40;padding:15px 22px}.primary:hover{background:#345e4d;color:#fff}label{display:block;margin-bottom:8px;font-size:12px;color:#69786d}form>div{display:flex;gap:8px}input{min-width:0;width:190px;background:#f8faf5;border:1px solid #bcc9bd;color:#223b34;padding:10px;border-radius:5px;text-transform:uppercase}input:focus{outline:2px solid #9caf96;outline-offset:2px}.resume{padding:10px 0}.resume h2{font-size:18px}.resume button{display:block;margin:10px 0}
.room-bar{max-width:1144px;margin:24px auto 0;padding:18px 22px;display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap;background:#fffefa;border:1px solid #e0e3d9;border-radius:10px}.room-bar p{font-size:12px;color:#69786d;margin:10px 0 0;line-height:1.8;overflow-wrap:anywhere}.room-bar button{margin-left:10px;font-size:12px}.room-bar strong[role=status]{color:#476a50;font-size:13px}code{letter-spacing:2px;color:#926741;font-size:14px}.confirm{width:100%;padding:14px;background:#f7eee2;border:1px solid #e9d8bc;border-radius:6px;color:#805134}.error{padding:14px 24px;color:#994a38;background:#f9ebe5;margin:16px auto;max-width:1144px;border-radius:6px}.mode-note,.footnote{padding:14px 24px;margin:0;color:#808570;font-size:12px;line-height:1.8;text-align:center}iframe{display:block;width:100%;height:calc(100dvh - 150px);min-height:820px;border:0;background:#f8f7f2}.footnote{max-width:1144px;margin:auto}
@media(prefers-reduced-motion:reduce){button,.choices>button{transition:none}.choices>button:hover{transform:none}}
@media(max-width:780px){nav{padding:12px 16px;gap:10px;min-height:70px;font-size:12px}.nav-title{font-size:15px;letter-spacing:1px}nav>button{padding:8px 10px;font-size:12px}nav>div{max-width:43%}nav :deep(.account-panel){top:66px}.choice,.friend-panel{padding:32px 18px}h1{font-size:29px}.choices{grid-template-columns:1fr;gap:14px;margin-top:28px}.choices>button{padding:24px 20px;display:grid;grid-template-columns:66px minmax(0,1fr);column-gap:18px}.choices>button:before{width:106px;height:100%;border-radius:0 50% 50% 0;opacity:.5}.piece{grid-row:1/4}.choices h2{margin:0 0 6px;font-size:19px}.choices p{margin:0 0 12px;font-size:12px}.friend-actions{align-items:stretch;flex-direction:column;gap:20px;padding:22px;margin:26px 0}input{flex:1;width:100%}.room-bar{margin:16px 12px 0;padding:16px 12px}.room-bar>div{max-width:100%}.room-bar button{margin-left:5px}iframe{min-height:1100px}.confirm button{margin-top:8px}.error{margin:12px}.mode-note{padding-bottom:0}}
select{font:inherit;color:#223b34;background:#f8faf5;border:1px solid #bcc9bd;padding:10px;border-radius:5px;margin-right:10px}.seats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.seats span{padding:5px 9px;border-radius:5px;background:#f3f3ec;border-left:3px solid}.seats .red{border-color:#c74d43}.seats .yellow{border-color:#d7a131}.seats .blue{border-color:#5089b1}.seats .green{border-color:#518768}.room-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.friend-actions>div{min-width:0}select{max-width:100%}
</style>
