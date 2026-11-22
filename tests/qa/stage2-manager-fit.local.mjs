import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';

const workdir=process.env.BELLZA_STAGE2_QA_WORKDIR ?? 'tmp/agenda-stage2-rls-qa';
const raw=execFileSync('supabase',['status','--workdir',workdir,'-o','json'],{encoding:'utf8'});
const qa=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(qa.API_URL,'http://127.0.0.1:57931','disposable QA required');
const admin=createClient(qa.API_URL,qa.SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const id=()=>crypto.randomUUID(),uuid=(value)=>`'${value}'::uuid`;
async function identity(name){
  const email=`manager-fit-${name}-${id()}@synthetic.invalid`,password=`QA-${id()}!`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
  if(created.error)throw created.error;
  const client=createClient(qa.API_URL,qa.ANON_KEY,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email,password});
  assert.equal(login.data.user?.id,created.data.user.id);
  return {id:created.data.user.id,client,email,password};
}
const owner=await identity('owner'),manager=await identity('manager'),
  foreignManager=await identity('foreign-manager'),professional=await identity('professional'),
  customer=await identity('customer');
const studio=id(),foreignStudio=id(),staff=id(),service=id(),
  occupiedA=id(),occupiedB=id(),editable=id(),block=id(),
  payment=id(),deposit=id(),cashSession=id(),lineA=id(),lineB=id(),lineEditable=id();
const sql=`BEGIN; SET LOCAL session_replication_role=replica;
INSERT INTO public.studios(id,slug,name,plan,plan_tier) VALUES
 (${uuid(studio)},'manager-fit-${studio.slice(0,8)}','QA Manager Fit','pro','pro'),
 (${uuid(foreignStudio)},'manager-fit-${foreignStudio.slice(0,8)}','QA Other','pro','pro');
INSERT INTO public.staff(id,studio_id,name,user_id) VALUES
 (${uuid(staff)},${uuid(studio)},'Profissional QA',${uuid(professional.id)});
INSERT INTO public.user_roles(user_id,studio_id,role) VALUES
 (${uuid(owner.id)},${uuid(studio)},'studio_owner'),
 (${uuid(manager.id)},${uuid(studio)},'manager'),
 (${uuid(foreignManager.id)},${uuid(foreignStudio)},'manager'),
 (${uuid(professional.id)},${uuid(studio)},'staff');
INSERT INTO public.services(id,studio_id,name,duration_min,price) VALUES
 (${uuid(service)},${uuid(studio)},'Serviço sintético',30,28);
INSERT INTO public.staff_services(staff_id,service_id) VALUES (${uuid(staff)},${uuid(service)});
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time)
 VALUES (${uuid(staff)},${uuid(studio)},3,'09:00','17:00');
INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,status,
 total_price,total_duration_min,studio_commission_percent_snapshot) VALUES
 (${uuid(occupiedA)},${uuid(studio)},${uuid(staff)},'2030-10-30T12:00:00Z',
 '2030-10-30T12:30:00Z','confirmed',28,30,23),
 (${uuid(occupiedB)},${uuid(studio)},${uuid(staff)},'2030-10-30T13:00:00Z',
 '2030-10-30T13:30:00Z','confirmed',28,30,23),
 (${uuid(editable)},${uuid(studio)},${uuid(staff)},'2030-10-30T10:00:00Z',
 '2030-10-30T10:30:00Z','confirmed',28,30,23);
INSERT INTO public.appointment_services(id,appointment_id,service_id,price,duration_min,
 studio_commission_percent_snapshot,professional_commission_percent_snapshot) VALUES
 (${uuid(lineA)},${uuid(occupiedA)},${uuid(service)},28,30,23,37),
 (${uuid(lineB)},${uuid(occupiedB)},${uuid(service)},28,30,23,37),
 (${uuid(lineEditable)},${uuid(editable)},${uuid(service)},28,30,23,37);
INSERT INTO public.staff_time_off(id,studio_id,staff_id,starts_at,ends_at) VALUES
 (${uuid(block)},${uuid(studio)},${uuid(staff)},'2030-10-30T14:00:00Z','2030-10-30T16:00:00Z');
INSERT INTO public.payment_intents(id,studio_id,appointment_id,amount_cents,method,status) VALUES
 (${uuid(payment)},${uuid(studio)},${uuid(occupiedA)},2800,'card','succeeded');
INSERT INTO public.cash_register_sessions(id,studio_id,opened_by) VALUES
 (${uuid(cashSession)},${uuid(studio)},${uuid(owner.id)});
INSERT INTO public.cash_register_movements(id,session_id,studio_id,appointment_id,
 movement_type,amount,description) VALUES
 (${uuid(deposit)},${uuid(cashSession)},${uuid(studio)},${uuid(occupiedA)},
 'service_payment',15,'QA synthetic payment');
COMMIT;`;
const seed=spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:30000});
if(seed.status!==0)throw new Error(`SYNTHETIC_SEED_FAILED: ${seed.stderr.slice(0,220)}`);

const financialBefore=await admin.from('appointments')
  .select('total_price,studio_commission_percent_snapshot,starts_at,ends_at')
  .eq('id',occupiedA).single();
assert.ifError(financialBefore.error);
async function preview(startsAt){
  const result=await admin.rpc('preview_studio_schedule_change',{
    p_studio_id:studio,p_staff_id:staff,p_starts_at:startsAt,
    p_duration_min:30,p_ignore_appointment_ids:[],
  });
  assert.ifError(result.error);return result.data;
}
assert.equal((await preview('2030-10-30T14:00:00Z')).hardBlocked,true);
assert.equal((await preview('2030-10-30T18:00:00Z')).withinAvailability,false);
assert.ok((await preview('2030-10-30T12:00:00Z')).conflicts
  .some((conflict)=>conflict.appointmentId===occupiedA));
const ownerView=await owner.client.from('appointments').select('id').eq('id',occupiedA);
const foreignView=await foreignManager.client.from('appointments').select('id').eq('id',occupiedA);
assert.ifError(ownerView.error);assert.ifError(foreignView.error);
assert.equal(ownerView.data?.length,1);assert.equal(foreignView.data?.length,0);
const cases=[
  ['manager_blocked',manager.id,'2030-10-30T14:00:00Z',[]],
  ['owner_blocked',owner.id,'2030-10-30T14:30:00Z',[]],
  ['manager_occupied',manager.id,'2030-10-30T12:00:00Z',[occupiedA]],
  ['owner_occupied',owner.id,'2030-10-30T13:00:00Z',[occupiedB]],
  ['manager_outside',manager.id,'2030-10-30T18:00:00Z',[]],
  ['owner_outside',owner.id,'2030-10-30T19:00:00Z',[]],
];
const passed=[];
async function createFit(actorId,startsAt,conflicts){
  return admin.rpc('create_studio_manual_multi_professional_fit',{
    p_studio_id:studio,p_assignments:[{serviceId:service,staffId:staff}],
    p_starts_at:startsAt,p_client_id:null,p_client_name:null,p_client_phone:null,
    p_notes:null,p_confirm_overlap:conflicts.length>0,p_actor_id:actorId,
    p_expected_conflict_ids:conflicts,
  });
}
for(const [label,actorId,startsAt,conflicts] of cases){
  const {data,error}=await createFit(actorId,startsAt,conflicts);
  assert.ifError(error);assert.ok(data?.appointmentId,label);
  const booking=await admin.from('appointments')
    .select('studio_id,is_manual_fit,total_price').eq('id',data.appointmentId).single();
  const lines=await admin.from('appointment_services')
    .select('service_id,price,duration_min').eq('appointment_id',data.appointmentId);
  const history=await admin.from('appointment_schedule_events')
    .select('operation').eq('appointment_id',data.appointmentId);
  assert.ifError(booking.error);assert.ifError(lines.error);assert.ifError(history.error);
  assert.equal(booking.data.studio_id,studio);assert.equal(booking.data.is_manual_fit,true);
  assert.equal(booking.data.total_price,28);assert.equal(lines.data?.[0]?.service_id,service);
  assert.equal(lines.data?.[0]?.price,28);assert.equal(history.data?.[0]?.operation,'manual_fit');
  passed.push(label);
}
const countBefore=await admin.from('appointments').select('id').eq('studio_id',studio);
assert.ifError(countBefore.error);
for(const [label,actorId,startsAt,reason] of [
  ['professional_denied',professional.id,'2030-10-30T15:00:00Z','schedule_hard_blocked'],
  ['customer_denied',customer.id,'2030-10-30T15:30:00Z','not_authorized'],
  ['foreign_manager_denied',foreignManager.id,'2030-10-30T15:00:00Z','not_authorized'],
]){
  const {error}=await createFit(actorId,startsAt,[]);
  assert.ok(error?.message?.includes(reason),label);passed.push(label);
}
const countAfter=await admin.from('appointments').select('id').eq('studio_id',studio);
assert.ifError(countAfter.error);assert.equal(countAfter.data?.length,countBefore.data?.length);
const direct=await manager.client.rpc('create_studio_manual_multi_professional_fit',{
  p_studio_id:studio,p_assignments:[{serviceId:service,staffId:staff}],
  p_starts_at:'2030-10-30T11:00:00Z',p_client_id:null,p_client_name:null,p_client_phone:null,
  p_notes:null,p_confirm_overlap:false,p_actor_id:manager.id,p_expected_conflict_ids:[],
});
assert.ok(direct.error,'authenticated session cannot execute service-role RPC');
passed.push('authenticated_direct_rpc_denied');
const financialAfter=await admin.from('appointments')
  .select('total_price,studio_commission_percent_snapshot,starts_at,ends_at')
  .eq('id',occupiedA).single();
assert.deepEqual(financialAfter.data,financialBefore.data);
const lineAfter=await admin.from('appointment_services')
  .select('service_id,price,studio_commission_percent_snapshot,professional_commission_percent_snapshot')
  .eq('id',lineA).single();
assert.deepEqual(lineAfter.data,{service_id:service,price:28,
  studio_commission_percent_snapshot:23,professional_commission_percent_snapshot:37});
assert.equal((await admin.from('payment_intents').select('id').eq('id',payment)).data?.length,1);
assert.equal((await admin.from('cash_register_movements').select('id').eq('id',deposit)).data?.length,1);
passed.push('existing_finance_and_services_unchanged');
const moved=await admin.rpc('move_studio_appointment_stage2',{
  p_studio_id:studio,p_appointment_id:editable,p_starts_at:'2030-10-30T11:00:00Z',
  p_assignments:[{lineId:lineEditable,staffId:staff,durationMin:60}],
  p_actor_id:manager.id,p_manual_fit:null,
});
assert.ifError(moved.error);assert.equal(moved.data.durationMin,60);
const edited=await admin.from('appointments')
  .select('total_price,studio_commission_percent_snapshot').eq('id',editable).single();
assert.equal(edited.data.total_price,28);assert.equal(edited.data.studio_commission_percent_snapshot,23);
passed.push('existing_edit_rpc_smoke');
if(process.env.BELLZA_STAGE2_QA_APP_URL){
  const appUrl=process.env.BELLZA_STAGE2_QA_APP_URL;
  assert.equal(new URL(appUrl).hostname,'127.0.0.1');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const httpErrors=[],authCalls=[];
    page.on('response',(response)=>{
      const path=new URL(response.url()).pathname;
      if(path.startsWith('/auth/v1/')||path.includes('server'))
        authCalls.push({status:response.status(),path});
      if(response.status()>=400)httpErrors.push({status:response.status(),
        path});
    });
    await page.route('**/@id/virtual:tanstack-start-client-entry*',async(route)=>{
      const moduleUrl=new URL(route.request().url());
      moduleUrl.pathname='/@id/__x00__virtual:tanstack-start-client-entry';
      const response=await page.request.get(moduleUrl.toString());
      await route.fulfill({response});
    });
    await page.goto(`${appUrl}/login`,{waitUntil:'domcontentloaded',timeout:30000});
    const reject=page.getByRole('button',{name:/^rejeitar$/i});
    await reject.waitFor({state:'visible',timeout:4000}).catch(()=>{});
    if(await reject.isVisible().catch(()=>false))await reject.click();
    await page.locator('input[name="identifier"]').fill(manager.email);
    await page.locator('input[name="password"]').fill(manager.password);
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await page.waitForURL((url)=>url.pathname!=='/login',{timeout:15000}).catch(async()=>{
      const body=await page.locator('body').innerText();
      throw new Error(`QA_LOGIN_FAILED: ${JSON.stringify({path:new URL(page.url()).pathname,
        httpErrors:httpErrors.slice(-8),authCalls:authCalls.slice(-8),
        begin:body.slice(0,350),end:body.slice(-300)})}`);
    });
    const session=await page.request.get(`${appUrl}/api/auth/session`);
    assert.equal(session.status(),200);
    assert.equal((await session.json()).userId,manager.id);
    const result=await page.evaluate(async ({studio,staff,service})=>{
      const functions=await import('/src/lib/studio-appointment.functions.ts');
      return functions.createStudioManualFit({data:{
        studioId:studio,assignments:[{staffId:staff,serviceId:service}],
        startsAt:'2030-10-30T15:30:00Z',clientId:null,clientName:null,
        clientPhone:null,notes:null,confirmOverlap:false,
        expectedConflictIds:[],expectedPaymentHoldIds:[],
      }});
    },{studio,staff,service});
    assert.ok(result?.appointmentId);
    const appBooking=await admin.from('appointments')
      .select('studio_id,is_manual_fit,total_price').eq('id',result.appointmentId).single();
    assert.ifError(appBooking.error);
    assert.equal(appBooking.data.studio_id,studio);
    assert.equal(appBooking.data.is_manual_fit,true);
    assert.equal(appBooking.data.total_price,28);
    passed.push('authenticated_app_manager_blocked');
  }finally{await browser.close();}
}
console.log(JSON.stringify({environment:'disposable-local-supabase',passed}));
