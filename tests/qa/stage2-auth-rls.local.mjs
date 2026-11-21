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
const studioA=id(),studioB=id(),staffA=id(),staffB=id(),bookingA=id(),serviceA=id(),lineA=id();
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
  (${uuid(staffB)},${uuid(studioB)},'Profissional QA B',NULL);
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
  (${uuid(ownerA.id)},${uuid(studioA)},'studio_owner'),
  (${uuid(ownerB.id)},${uuid(studioB)},'studio_owner'),
  (${uuid(professionalA.id)},${uuid(studioA)},'staff');
INSERT INTO public.services(id,studio_id,name,duration_min,price)
  VALUES (${uuid(serviceA)},${uuid(studioA)},'Serviço sintético',30,28);
INSERT INTO public.staff_services(staff_id,service_id)
  VALUES (${uuid(staffA)},${uuid(serviceA)});
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time)
  VALUES (${uuid(staffA)},${uuid(studioA)},3,'09:00','17:00');
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
  const {data,error}=await admin.rpc('move_studio_appointment_stage2',{
    p_studio_id:studioA,p_appointment_id:bookingA,
    p_starts_at:'2030-10-30T11:00:00Z',
    p_assignments:[{lineId:lineA,staffId:staffA,durationMin:60}],
    p_actor_id:ownerA.id,
  });
  return {passed:!error&&data?.durationMin===60,error:error?.message};
});
const report = checks.map(({label,passed,error}) => ({label,passed,error}));
console.log(JSON.stringify({environment:'disposable-local',identities:3,checks:report}));
if (checks.some((item)=>!item.passed)) process.exitCode=1;
