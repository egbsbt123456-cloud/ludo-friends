import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class El{
 style:Record<string,string>={};dataset:Record<string,string>={};attrs:Record<string,string>={};events:Record<string,Function>={};children:El[]=[];id='';hidden=false;disabled=false;textContent='';className='';onclick?:Function;
 classes=new Set<string>();classList={add:(c:string)=>this.classes.add(c),remove:(c:string)=>this.classes.delete(c),toggle:(c:string,v:boolean)=>v?this.classes.add(c):this.classes.delete(c),contains:(c:string)=>this.classes.has(c)};
 set innerHTML(_v:string){this.children=[];}get innerHTML(){return '';}
 setAttribute(k:string,v:any){this.attrs[k]=String(v);}addEventListener(k:string,fn:Function){this.events[k]=fn;}
 appendChild(el:El){this.children.push(el);return el;}
}
function setup(mode:string){
 const els:Record<string,El>={},colors=['red','yellow','blue','green'];
 for(const id of ['board','gameMessage','playerSelectOverlay','startGameBtn','localControls','rollButton','newGameBtn','moveChoices',...colors.flatMap(c=>['panel-'+c,'dice-'+c,c+'Pieces'])])els[id]=new El();
 const options=['red,yellow','blue,green','red,yellow,blue','red,green,yellow,blue'].map(colors=>{const e=new El();e.dataset.colors=colors;return e;});
 const math=Object.create(Math);math.random=()=>.999;
 const handlers:Record<string,Function>={},packets:any[]=[];
 const ctx:any={console,URLSearchParams,Math:math,setTimeout:()=>0,clearTimeout:()=>{},location:{search:'?mode='+mode,origin:'https://board.test'}};
 ctx.window=ctx;ctx.parent={postMessage:(data:any)=>packets.push(data)};ctx.addEventListener=(name:string,fn:Function)=>handlers[name]=fn;
 ctx.document={querySelector:()=>els.board,querySelectorAll:()=>options,getElementById:(id:string)=>els[id],createElement:()=>new El()};vm.createContext(ctx);
 for(const name of ['engine','app'])vm.runInContext(readFileSync(new URL(`../public/ludo/js/${name}.js`,import.meta.url),'utf8'),ctx);
 const piece=(color:string,index:number)=>els.board.children.find(el=>el.id===`piece-${color}-${index}`)!;
 const send=(room:any,origin=ctx.location.origin,source=ctx.parent)=>handlers.message({origin,source,data:{channel:'boardgame:ludo:control',room}});
 return {game:ctx.__LUDO_TEST__,engine:ctx.LU,ctx,els,options,packets,piece,send,math};
}
it('wires the local player selector, allows takeoff after six and keeps coordinates responsive',()=>{
 const {game,ctx,els,options,piece}=setup('local');options[0].events.click!();ctx.startGame();
 expect(game.getState().players).toEqual(['red','yellow']);expect(els.playerSelectOverlay.style.display).toBe('none');game.rollLocal();expect(piece('red',0).disabled).toBe(false);expect(piece('red',0).classList.contains('selectable')).toBe(true);
 piece('red',0).onclick!();expect(game.getState().pieces.red[0].position).toBe(0);
 const s=game.getState();s.pieces.red[0].position=1;game.setState(s);
 expect(parseFloat(piece('red',0).style.left)).toBeCloseTo(542/600*100);expect(piece('red',0).style.left.endsWith('%')).toBe(true);
 s.pieces.red[1].position=1;game.setState(s);expect(piece('red',0).style.left).not.toBe(piece('red',1).style.left);
 game.startWith(['blue','green']);expect(piece('red',0).hidden).toBe(true);expect(piece('blue',0).hidden).toBe(false);
});
it('passes an unmovable roll once and reports the die instead of silently losing it',()=>{
 const {game,math,els}=setup('local');game.startWith(['red','yellow']);math.random=()=>0;game.rollLocal();
 expect(game.getState().turnIndex).toBe(1);expect(game.getState().rolled).toBe(false);expect(els.gameMessage.textContent).toContain('1 点');expect(els.gameMessage.textContent).toContain('无子可动');
});
it('online mode isolates messages, blocks waiting seats and only applies server-confirmed moves',()=>{
 const {game,engine,send,packets,els}=setup('online');let s=engine.createInitialState(['red','yellow']);s=engine.safeRoll(s,6).state;
 const room={code:'0123456789',yourColor:'red',state:s,status:'waiting'};
 send(room,'https://evil.test');expect(game.getState()).toBe(null);send(room);game.handlePieceClick('red',0);expect(packets).toHaveLength(1);expect(els.localControls.hidden).toBe(true);
 s={...s,version:s.version+1};send({...room,state:s,status:'playing'});game.handlePieceClick('yellow',0);expect(packets).toHaveLength(1);game.handlePieceClick('red',0);expect(packets).toHaveLength(2);expect(game.getState().pieces.red[0].position).toBe(-1);
 game.handlePieceClick('red',1);expect(packets).toHaveLength(2);send({...room,state:s,status:'playing'});game.handlePieceClick('red',0);expect(packets).toHaveLength(3);
 const moved=engine.safeMove(s,0).state;send({...room,state:moved,status:'playing'});expect(game.getState().pieces.red[0].position).toBe(0);send({...room,state:s,status:'playing'});expect(game.getState().version).toBe(moved.version);
});
