import { execFileSync, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const output = execFileSync('supabase', ['status','--workdir','tmp/agenda-stage2-rls-qa','-o','json'],
  {encoding:'utf8'});
const local = JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));
if (local.API_URL !== 'http://127.0.0.1:57931') throw new Error('WRONG_QA_TARGET');
const admin = createClient(local.API_URL,local.SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const id = () => crypto.randomUUID();
async function createIdentity(role) {
  const email = `stage2-${role}-${id()}@synthetic.invalid`;
  const password = `QA-${id()}!`;
  const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (created.error) throw new Error(`CREATE_${role}: ${created.error.message}`);
  const client = createClient(local.API_URL,local.ANON_KEY,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const login = await client.auth.signInWithPassword({email,password});
  if (login.error || login.data.user?.id !== created.data.user.id) {
    throw new Error(`LOGIN_${role}_FAILED`);
  }
  return {id:created.data.user.id,client};
}
const ownerA = await createIdentity('owner-a');
const ownerB = await createIdentity('owner-b');
const professionalA = await createIdentity('professional-a');
const studioA=id(),studioB=id(),staffA=id(),staffA2=id(),staffB=id(),
  bookingA=id(),serviceA=id(),serviceA2=id(),lineA=id(),bookingM=id(),
  multiLineA=id(),multiLineB=id(),overlap=id();
const uuid = (value) => {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('INVALID_SYNTHETIC_UUID');
  return `'${value}'::uuid`;
};
const sql = `BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.studios(id,slug,name,plan,plan_tier)
  VALUES (${uuid(studioA)},'stage2-qa-a-${studioA.slice(0,8)}','QA A','pro','pro'),
    (${uuid(studioB)},'stage2-qa-b-${studioB.slice(0,8)}','QA B','pro','pro');
INSERT INTO public.staff(id,studio_id,name,user_id) VALUES
  (${uuid(staffA)},${uuid(studioA)},'Profissional QA A',${uuid(professionalA.id)}),
  (${uuid(staffA2)},${uuid(studioA)},'Profissional QA A2',NULL),
  (${uuid(staffB)},${uuid(studioB)},'Profissional QA B',NULL);
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
  (${uuid(ownerA.id)},${uuid(studioA)},'studio_owner'),
  (${uuid(ownerB.id)},${uuid(studioB)},'studio_owner'),
  (${uuid(professionalA.id)},${uuid(studioA)},'staff');
INSERT INTO public.services(id,studio_id,name,duration_min,price)
  VALUES (${uuid(serviceA)},${uuid(studioA)},'Serviço sintético',30,28),
    (${uuid(serviceA2)},${uuid(studioA)},'Segundo serviço QA',60,40);
INSERT INTO public.staff_services(staff_id,service_id)
  VALUES (${uuid(staffA)},${uuid(serviceA)}),
    (${uuid(staffA2)},${uuid(serviceA)}),(${uuid(staffA2)},${uuid(serviceA2)});
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time)
  VALUES (${uuid(staffA)},${uuid(studioA)},3,'09:00','17:00'),
    (${uuid(staffA2)},${uuid(studioA)},3,'09:00','17:00');
INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,status,
  studio_commission_percent_snapshot,total_price,total_duration_min)
  VALUES (${uuid(bookingA)},${uuid(studioA)},${uuid(staffA)},
    '2030-10-30T10:00:00Z','2030-10-30T10:30:00Z','confirmed',23,28,30);
INSERT INTO public.appointment_services(id,appointment_id,service_id,price,duration_min,
  studio_commission_percent_snapshot)
  VALUES (${uuid(lineA)},${uuid(bookingA)},${uuid(serviceA)},28,30,23);
COMMIT;`;
const seeded = spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
if (seeded.status !== 0) throw new Error(`SYNTHETIC_SEED_FAILED: ${seeded.stderr.trim()}`);
const checks=[];
async function check(label, fn) {
  try {checks.push({label,...await fn()});}
  catch (error) {checks.push({label,passed:false,error:String(error.message).slice(0,180)});}
}
await check('owner_a_reads_own',async()=>{
  const {data,error}=await ownerA.client.from('appointments').select('id').eq('id',bookingA);
  return {passed:!error&&data?.length===1,error:error?.message};
});
await check('owner_b_cannot_read_a',async()=>{
  const {data,error}=await ownerB.client.from('appointments').select('id').eq('id',bookingA);
  return {passed:!error&&data?.length===0,error:error?.message};
});
await check('owner_b_cannot_update_a',async()=>{
  const {data,error}=await ownerB.client.from('appointments')
    .update({notes:'QA forbidden'}).eq('id',bookingA).select('id');
  const after=await admin.from('appointments').select('notes').eq('id',bookingA).single();
  return {passed:(!!error||data?.length===0)&&!after.error&&after.data?.notes==null,
    error:error?.message};
});
await check('professional_a_reads_own',async()=>{
  const {data,error}=await professionalA.client.from('appointments').select('id').eq('id',bookingA);
  return {passed:!error&&data?.length===1,error:error?.message};
});
await check('backend_rpc_duration_probe',async()=>{
  const before=await admin.from('appointments')
    .select('studio_commission_percent_snapshot,total_price')
    .eq('id',bookingA).single();
  const {data,error}=await admin.rpc('move_studio_appointment_stage2',{
    p_studio_id:studioA,p_appointment_id:bookingA,
    p_starts_at:'2030-10-30T11:00:00Z',
    p_assignments:[{lineId:lineA,staffId:staffA,durationMin:60}],
    p_actor_id:ownerA.id,
  });
  const after=await admin.from('appointments')
    .select('studio_commission_percent_snapshot,total_price')
    .eq('id',bookingA).single();
  return {passed:!error&&data?.durationMin===60&&!before.error&&!after.error&&
    after.data.total_price===before.data.total_price&&
    after.data.studio_commission_percent_snapshot===
      before.data.studio_commission_percent_snapshot,
    error:error?.message || (before.data?.studio_commission_percent_snapshot !==
      after.data?.studio_commission_percent_snapshot
      ? `COMMISSION_CHANGED_${before.data?.studio_commission_percent_snapshot}_TO_${after.data?.studio_commission_percent_snapshot}`
      : undefined)};
});
const assignment=(lineId,staffId,durationMin)=>({lineId,staffId,durationMin});
const move=(actorId,appointmentId,startsAt,assignments)=>admin.rpc(
  'move_studio_appointment_stage2',{
    p_studio_id:studioA,p_appointment_id:appointmentId,p_starts_at:startsAt,
    p_assignments:assignments,p_actor_id:actorId,
  });
const readBooking=async(appointmentId)=>admin.from('appointments').select('*')
  .eq('id',appointmentId).single();
const readLines=async(appointmentId)=>admin.from('appointment_services').select('*')
  .eq('appointment_id',appointmentId).order('position');
function seedSynthetic(statement){
  const run=spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
    'psql','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],
    {input:`BEGIN; SET LOCAL session_replication_role=replica; ${statement} COMMIT;`,
      encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(run.status!==0)throw new Error(`SYNTHETIC_SEED_FAILED: ${run.stderr.slice(0,220)}`);
}
await check('authenticated_cannot_call_service_rpc',async()=>{
  const {error}=await ownerA.client.rpc('move_studio_appointment_stage2',{
    p_studio_id:studioA,p_appointment_id:bookingA,p_starts_at:'2030-10-30T10:00:00Z',
    p_assignments:[assignment(lineA,staffA,60)],p_actor_id:ownerA.id});
  return {passed:!!error};
});
await check('owner_b_rpc_actor_denied',async()=>{
  const {error}=await move(ownerB.id,bookingA,'2030-10-30T11:00:00Z',
    [assignment(lineA,staffA,60)]);
  return {passed:!!error};
});
await check('duration_60_to_30_finance_intact',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T10:00:00Z',
    [assignment(lineA,staffA,30)]);
  const after=await readBooking(bookingA),lines=await readLines(bookingA);
  return {passed:!error&&data?.durationMin===30&&!after.error&&!lines.error&&
    after.data.total_price===28&&after.data.studio_commission_percent_snapshot===23&&
    lines.data.length===1&&lines.data[0].service_id===serviceA&&lines.data[0].price===28,
    error:error?.message || JSON.stringify({duration:data?.durationMin,
      price:after.data?.total_price,commission:after.data?.studio_commission_percent_snapshot,
      service:lines.data?.[0]?.service_id===serviceA,linePrice:lines.data?.[0]?.price})};
});
await check('owner_a_free_move',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T11:00:00Z',
    [assignment(lineA,staffA,30)]);
  return {passed:!error&&data?.isManualFit===false,error:error?.message};
});
seedSynthetic(`INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,status,
  studio_commission_percent_snapshot,total_price,total_duration_min)
  VALUES (${uuid(overlap)},${uuid(studioA)},${uuid(staffA)},
    '2030-10-30T12:00:00Z','2030-10-30T13:00:00Z','confirmed',23,28,60);`);
await check('owner_a_overlap_auto_fit',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T12:00:00Z',
    [assignment(lineA,staffA,30)]);
  return {passed:!error&&data?.isManualFit===true&&data?.autoFitCreated===true,
    error:error?.message};
});
await check('auto_fit_removed_when_free',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T13:00:00Z',
    [assignment(lineA,staffA,30)]);
  return {passed:!error&&data?.isManualFit===false,error:error?.message};
});
await check('owner_a_outside_hours_fit',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T18:00:00Z',
    [assignment(lineA,staffA,30)]);
  return {passed:!error&&data?.isManualFit===true,error:error?.message};
});
seedSynthetic(`INSERT INTO public.staff_time_off(id,studio_id,staff_id,starts_at,ends_at)
  VALUES (${uuid(id())},${uuid(studioA)},${uuid(staffA)},
    '2030-10-30T14:00:00Z','2030-10-30T15:00:00Z');`);
await check('hard_block_rolls_back',async()=>{
  const before=await readBooking(bookingA);
  const {error}=await move(ownerA.id,bookingA,'2030-10-30T14:00:00Z',
    [assignment(lineA,staffA,30)]);
  const after=await readBooking(bookingA);
  return {passed:!!error&&!before.error&&!after.error&&
    after.data.starts_at===before.data.starts_at&&
    after.data.ends_at===before.data.ends_at};
});
await check('professional_cannot_auto_fit_or_transfer',async()=>{
  const overlapMove=await move(professionalA.id,bookingA,'2030-10-30T12:00:00Z',
    [assignment(lineA,staffA,30)]);
  const transfer=await move(professionalA.id,bookingA,'2030-10-30T13:30:00Z',
    [assignment(lineA,staffA2,30)]);
  return {passed:!!overlapMove.error&&!!transfer.error};
});
await check('professional_own_free_move',async()=>{
  const {data,error}=await move(professionalA.id,bookingA,'2030-10-30T13:30:00Z',
    [assignment(lineA,staffA,30)]);
  return {passed:!error&&data?.isManualFit===false,error:error?.message};
});
await check('owner_a_transfer_professional',async()=>{
  const {data,error}=await move(ownerA.id,bookingA,'2030-10-30T15:00:00Z',
    [assignment(lineA,staffA2,30)]);
  const after=await readBooking(bookingA);
  return {passed:!error&&data?.changed&&!after.error&&after.data.staff_id===staffA2,
    error:error?.message};
});
seedSynthetic(`INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,
  status,total_price,total_duration_min,studio_commission_percent_snapshot)
  VALUES (${uuid(bookingM)},${uuid(studioA)},${uuid(staffA)},
  '2030-10-30T09:00:00Z','2030-10-30T10:45:00Z','confirmed',68,105,23);
  INSERT INTO public.appointment_services(id,appointment_id,service_id,staff_id,
  starts_at,ends_at,position,price,duration_min,studio_commission_percent_snapshot,
  professional_commission_percent_snapshot)
  VALUES (${uuid(multiLineA)},${uuid(bookingM)},${uuid(serviceA)},${uuid(staffA)},
  '2030-10-30T09:00:00Z','2030-10-30T09:45:00Z',0,28,45,23,37),
  (${uuid(multiLineB)},${uuid(bookingM)},${uuid(serviceA2)},${uuid(staffA2)},
  '2030-10-30T09:45:00Z','2030-10-30T10:45:00Z',1,40,60,23,37);
  INSERT INTO public.payment_intents(id,studio_id,appointment_id,amount_cents,method,status)
  VALUES (${uuid(id())},${uuid(studioA)},${uuid(bookingM)},1500,'card','succeeded');`);
await check('multi_professional_finance_and_segments',async()=>{
  const before=await readBooking(bookingM),oldLines=await readLines(bookingM);
  const {data,error}=await move(ownerA.id,bookingM,'2030-10-30T15:00:00Z',
    [assignment(multiLineA,staffA,45),assignment(multiLineB,staffA2,75)]);
  const after=await readBooking(bookingM),lines=await readLines(bookingM);
  const payments=await admin.from('payment_intents').select('id').eq('appointment_id',bookingM);
  return {passed:!error&&data?.durationMin===120&&!before.error&&!oldLines.error&&
    !after.error&&!lines.error&&!payments.error&&payments.data.length===1&&
    before.data.total_price===after.data.total_price&&
    lines.data[0].ends_at===lines.data[1].starts_at&&
    lines.data.every((line,index)=>line.id===oldLines.data[index].id&&
      line.service_id===oldLines.data[index].service_id&&
      line.price===oldLines.data[index].price&&
      line.professional_commission_percent_snapshot===
        oldLines.data[index].professional_commission_percent_snapshot),
    error:error?.message};
});
await check('paid_staff_transfer_rejected_atomically',async()=>{
  const before=await readBooking(bookingM),oldLines=await readLines(bookingM);
  const {error}=await move(ownerA.id,bookingM,'2030-10-30T16:00:00Z',
    [assignment(multiLineA,staffA2,45),assignment(multiLineB,staffA2,75)]);
  const after=await readBooking(bookingM),lines=await readLines(bookingM);
  return {passed:!!error&&!before.error&&!oldLines.error&&!after.error&&!lines.error&&
    before.data.starts_at===after.data.starts_at&&
    lines.data.every((line,index)=>line.staff_id===oldLines.data[index].staff_id&&
      line.starts_at===oldLines.data[index].starts_at)};
});
const report = checks.map(({label,passed,error}) => ({label,passed,error}));
console.log(JSON.stringify({environment:'disposable-local',identities:3,checks:report}));
if (checks.some((item)=>!item.passed)) process.exitCode=1;
