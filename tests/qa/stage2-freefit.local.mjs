import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';

const workdir=process.env.BELLZA_STAGE2_QA_WORKDIR ?? 'tmp/agenda-stage2-rls-qa';
const raw=execFileSync('supabase',['status','--workdir',workdir,'-o','json'],{encoding:'utf8'});
const qa=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(qa.API_URL,'http://127.0.0.1:57931','disposable QA target required');
const admin=createClient(qa.API_URL,qa.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const id=()=>crypto.randomUUID();
const quote=(value)=>`'${value}'::uuid`;
const runSql=(sql)=>{
  const run=spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa','psql',
    '-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],
    {input:`BEGIN; SET LOCAL session_replication_role=replica; ${sql} COMMIT;`,
      encoding:'utf8',timeout:30000});
  if(run.status!==0)throw new Error(`QA_SEED_FAILED: ${run.stderr.slice(0,220)}`);
};
async function identity(name){
  const email=`freefit-${name}-${id()}@synthetic.invalid`,password=`QA-${id()}!`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error)throw created.error;
  const client=createClient(qa.API_URL,qa.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});
  assert.equal(login.data.user?.id,created.data.user.id);
  return {id:created.data.user.id,client};
}
const owner=await identity('owner'),manager=await identity('manager');
const foreign=await identity('foreign'),professional=await identity('professional');
const customer=await identity('customer');
const studio=id(),otherStudio=id(),staff=id(),otherStaff=id(),service=id(),
  booking=id(),line=id(),occupied=id(),block=id(),secondService=id(),multi=id(),
  multiLineA=id(),multiLineB=id();
runSql(`
INSERT INTO public.studios(id,slug,name,plan,plan_tier) VALUES
 (${quote(studio)},'freefit-${studio.slice(0,8)}','QA Free Fit','pro','pro'),
 (${quote(otherStudio)},'freefit-${otherStudio.slice(0,8)}','QA Other','pro','pro');
INSERT INTO public.staff(id,studio_id,name,user_id) VALUES
 (${quote(staff)},${quote(studio)},'QA Professional',${quote(professional.id)}),
 (${quote(otherStaff)},${quote(studio)},'QA Second',NULL);
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
 (${quote(owner.id)},${quote(studio)},'studio_owner'),
 (${quote(manager.id)},${quote(studio)},'manager'),
 (${quote(professional.id)},${quote(studio)},'staff'),
 (${quote(foreign.id)},${quote(otherStudio)},'studio_owner');
INSERT INTO public.services(id,studio_id,name,duration_min,price) VALUES
 (${quote(service)},${quote(studio)},'QA Service',30,28),
 (${quote(secondService)},${quote(studio)},'QA Service 2',30,40);
INSERT INTO public.staff_services(staff_id,service_id) VALUES
 (${quote(staff)},${quote(service)}),(${quote(otherStaff)},${quote(secondService)});
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time) VALUES
 (${quote(staff)},${quote(studio)},3,'09:00','17:00'),
 (${quote(otherStaff)},${quote(studio)},3,'09:00','17:00');
INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,status,
 studio_commission_percent_snapshot,total_price,total_duration_min) VALUES
 (${quote(booking)},${quote(studio)},${quote(staff)},'2030-10-30T10:00:00Z',
  '2030-10-30T10:30:00Z','confirmed',23,28,30),
 (${quote(occupied)},${quote(studio)},${quote(staff)},'2030-10-30T12:00:00Z',
  '2030-10-30T13:00:00Z','confirmed',23,28,60),
 (${quote(multi)},${quote(studio)},${quote(staff)},'2030-10-30T15:00:00Z',
  '2030-10-30T16:00:00Z','confirmed',23,68,60);
INSERT INTO public.appointment_services(id,appointment_id,service_id,price,duration_min,
 studio_commission_percent_snapshot,professional_commission_percent_snapshot) VALUES
 (${quote(line)},${quote(booking)},${quote(service)},28,30,23,37);
INSERT INTO public.appointment_services(id,appointment_id,service_id,staff_id,starts_at,ends_at,
 position,price,duration_min,studio_commission_percent_snapshot,
 professional_commission_percent_snapshot) VALUES
 (${quote(multiLineA)},${quote(multi)},${quote(service)},${quote(staff)},
  '2030-10-30T15:00:00Z','2030-10-30T15:30:00Z',0,28,30,23,37),
 (${quote(multiLineB)},${quote(multi)},${quote(secondService)},${quote(otherStaff)},
  '2030-10-30T15:30:00Z','2030-10-30T16:00:00Z',1,40,30,23,37);
INSERT INTO public.staff_time_off(id,studio_id,staff_id,starts_at,ends_at) VALUES
 (${quote(block)},${quote(studio)},${quote(staff)},'2030-10-30T14:00:00Z','2030-10-30T15:00:00Z');`);
const assignment=(lineId,staffId,durationMin)=>({lineId,staffId,durationMin});
const move=(actorId,appointmentId,startsAt,assignments,manualFit=null)=>admin.rpc(
  'move_studio_appointment_stage2',{p_studio_id:studio,p_appointment_id:appointmentId,
    p_starts_at:startsAt,p_assignments:assignments,p_actor_id:actorId,p_manual_fit:manualFit});
const a=(minutes=30)=>[assignment(line,staff,minutes)];
const read=async()=>{const result=await admin.from('appointments').select('*').eq('id',booking).single();
  if(result.error)throw result.error;return result.data;};
const passed=[];
async function check(name,fn){await fn();passed.push(name);}
await check('authenticated_sessions_and_cross_studio_rls',async()=>{
  const own=await owner.client.from('appointments').select('id').eq('id',booking);
  const alien=await foreign.client.from('appointments').select('id').eq('id',booking);
  const other=await customer.client.from('appointments').select('id').eq('id',booking);
  assert.equal(own.data?.length,1);assert.equal(alien.data?.length,0);
  assert.equal(other.data?.length,0);
  const denied=await foreign.client.from('appointments').update({notes:'forbidden'})
    .eq('id',booking).select('id');
  assert.equal(denied.data?.length??0,0);
});
await check('owner_grows_duration_preserving_finance',async()=>{
  const result=await move(owner.id,booking,'2030-10-30T10:00:00Z',a(60));
  assert.ifError(result.error);assert.equal(result.data.durationMin,60);
  const row=await read();assert.equal(row.total_price,28);
  assert.equal(row.studio_commission_percent_snapshot,23);
});
await check('manager_shrinks_duration_preserving_service',async()=>{
  const result=await move(manager.id,booking,'2030-10-30T10:00:00Z',a(30));
  assert.ifError(result.error);assert.equal(result.data.durationMin,30);
  const saved=await admin.from('appointment_services').select('service_id,price,studio_commission_percent_snapshot,professional_commission_percent_snapshot').eq('id',line).single();
  assert.equal(saved.data.service_id,service);assert.equal(saved.data.price,28);
  assert.equal(saved.data.studio_commission_percent_snapshot,23);
  assert.equal(saved.data.professional_commission_percent_snapshot,37);
});
await check('owner_explicit_fit_on_free_slot',async()=>{
  const result=await move(owner.id,booking,'2030-10-30T11:00:00Z',a(),true);
  assert.ifError(result.error);assert.equal(result.data.isManualFit,true);
});
await check('manager_clears_explicit_fit_on_free_slot',async()=>{
  const result=await move(manager.id,booking,'2030-10-30T11:00:00Z',a(),false);
  assert.ifError(result.error);assert.equal(result.data.isManualFit,false);
});
await check('owner_occupied_slot_auto_fit',async()=>{
  const result=await move(owner.id,booking,'2030-10-30T12:00:00Z',a());
  assert.ifError(result.error);assert.equal(result.data.isManualFit,true);
});
await check('manager_blocked_slot_fit',async()=>{
  const result=await move(manager.id,booking,'2030-10-30T14:00:00Z',a());
  assert.ifError(result.error);assert.equal(result.data.isManualFit,true);
});
await check('fit_cannot_be_cleared_while_blocked',async()=>{
  const result=await move(manager.id,booking,'2030-10-30T14:00:00Z',a(),false);
  assert.ifError(result.error);assert.equal(result.data.isManualFit,true);
});
await check('manager_outside_hours_fit',async()=>{
  const result=await move(manager.id,booking,'2030-10-30T18:00:00Z',a());
  assert.ifError(result.error);assert.equal(result.data.isManualFit,true);
});
await check('professional_and_foreign_owner_cannot_fit',async()=>{
  assert.ok((await move(professional.id,booking,'2030-10-30T11:00:00Z',a(),true)).error);
  assert.ok((await move(professional.id,booking,'2030-10-30T14:00:00Z',a())).error);
  assert.ok((await move(foreign.id,booking,'2030-10-30T11:00:00Z',a(),true)).error);
  assert.ok((await move(customer.id,booking,'2030-10-30T11:00:00Z',a(),true)).error);
});
await check('failed_move_rolls_back',async()=>{
  const before=await read();
  const denied=await move(owner.id,booking,'2030-10-30T11:00:00Z',
    [assignment(line,otherStaff,30)]);
  assert.ok(denied.error);assert.equal((await read()).starts_at,before.starts_at);
});
await check('absent_professional_remains_protected',async()=>{
  const before=await read();
  const absent=await admin.from('staff').update({current_status:'absent'}).eq('id',staff);
  assert.ifError(absent.error);
  try{
    const denied=await move(owner.id,booking,'2030-10-30T11:00:00Z',a());
    assert.ok(denied.error);
    assert.equal((await read()).starts_at,before.starts_at);
  }finally{
    const restored=await admin.from('staff').update({current_status:'online'}).eq('id',staff);
    assert.ifError(restored.error);
  }
});
await check('multi_professional_segments_and_finance',async()=>{
  const result=await move(manager.id,multi,'2030-10-30T13:00:00Z',[
    assignment(multiLineA,staff,45),assignment(multiLineB,otherStaff,30)]);
  assert.ifError(result.error);assert.equal(result.data.durationMin,75);
  const lines=await admin.from('appointment_services').select('id,service_id,price,starts_at,ends_at,studio_commission_percent_snapshot').eq('appointment_id',multi).order('position');
  assert.equal(lines.data[0].ends_at,lines.data[1].starts_at);
  assert.deepEqual(lines.data.map(x=>x.service_id),[service,secondService]);
  assert.deepEqual(lines.data.map(x=>x.price),[28,40]);
  assert.deepEqual(lines.data.map(x=>x.studio_commission_percent_snapshot),[23,23]);
});
await check('published_five_argument_rpc_still_available',async()=>{
  const legacy=await admin.rpc('move_studio_appointment_stage2',{
    p_studio_id:studio,p_appointment_id:booking,p_starts_at:'2030-10-30T11:00:00Z',
    p_assignments:a(),p_actor_id:owner.id});
  assert.ifError(legacy.error);
  assert.equal(legacy.data.isManualFit,false);
});
console.log(JSON.stringify({environment:'supabase-local-disposable',passed}));
