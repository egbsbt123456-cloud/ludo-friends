export type LudoColor='red'|'yellow'|'blue'|'green';
export interface LudoPiece {position:number;finished:boolean}
export interface LudoState {players:LudoColor[];turnIndex:number;dice:number|null;rolled:boolean;pieces:Record<LudoColor,LudoPiece[]>;over:boolean;winner:LudoColor|null;version:number;lastEvents:LudoEvent[];reason?:'finished'|'resign'|'cancelled'|null}
export interface LudoEvent {kind:'roll'|'skip'|'takeoff'|'move'|'shortcut'|'colorjump'|'capture'|'finish'|'bounce';color:LudoColor;from:number;to:number;captured?:{color:LudoColor;piece:number}[]}
export interface LudoRoomView {code:string;status:'waiting'|'playing'|'finished'|'cancelled';seats:{color:LudoColor;name:string|null}[];yourColor:LudoColor|null;state:LudoState;updatedAt:number}
