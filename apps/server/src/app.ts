import Fastify from 'fastify';
import {openDatabase} from './database/index.js';
import {registerAuth} from './auth/index.js';
import {registerLudo} from './games/ludo.js';
export function createApp(options:{databasePath:string;origin:string;logger?:boolean;production?:boolean;rollDice?:()=>number}){
 const app=Fastify({logger:options.logger??true,bodyLimit:16384,trustProxy:'127.0.0.1'});
 const {sqlite}=openDatabase(options.databasePath);
 app.addHook('onRequest',async(_req,reply)=>{reply.header('Cache-Control','no-store');});
 registerAuth(app,sqlite,options.origin,options.production??false);
 registerLudo(app,sqlite,options.origin,options.production??false,options.rollDice);
 app.get('/api/health',(_req,reply)=>{try{
  if(!sqlite.prepare('SELECT version FROM schema_migrations WHERE version=1').get())throw new Error('Migration required');
  return {status:'ok',database:'ready'};
 }catch{return reply.code(503).send({status:'unavailable',database:'migration_required'});}});
 app.addHook('onClose',async()=>{sqlite.close();});return {app};
}
