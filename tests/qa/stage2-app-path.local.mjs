import {execFileSync,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';

const raw = execFileSync('supabase',['status','--workdir',
  process.env.BELLZA_STAGE2_QA_WORKDIR ?? 'tmp/agenda-stage2-rls-qa','-o','json'],
  {encoding:'utf8'});
const local=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
if(local.API_URL!=='http://127.0.0.1:57931')throw new Error('WRONG_QA_TARGET');
const admin=createClient(local.API_URL,local.SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}});
const id=()=>crypto.randomUUID();
const email=`stage2-ui-${id()}@synthetic.invalid`;
const password=`QA-${id()}!`;
const account=await admin.auth.admin.createUser({email,password,email_confirm:true});
if(account.error)throw new Error(`SYNTHETIC_IDENTITY: ${account.error.message}`);
const uid=account.data.user.id,studio=id(),staff=id(),service=id(),booking=id(),line=id();
const uuid=(value)=>`'${value}'::uuid`;
const sql=`BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public.studios(id,slug,name,plan,plan_tier)
VALUES (${uuid(studio)},'stage2-ui-${studio.slice(0,8)}','Estúdio QA local','pro','pro');
INSERT INTO public.staff(id,studio_id,name,user_id)
VALUES (${uuid(staff)},${uuid(studio)},'Profissional QA local',${uuid(uid)});
INSERT INTO public.user_roles(user_id,studio_id,role)
VALUES (${uuid(uid)},${uuid(studio)},'studio_owner');
INSERT INTO public.services(id,studio_id,name,duration_min,price)
VALUES (${uuid(service)},${uuid(studio)},'Serviço QA local',30,28);
INSERT INTO public.staff_services(staff_id,service_id) VALUES (${uuid(staff)},${uuid(service)});
INSERT INTO public.staff_availability(staff_id,studio_id,weekday,start_time,end_time)
VALUES (${uuid(staff)},${uuid(studio)},3,'09:00','17:00');
INSERT INTO public.appointments(id,studio_id,staff_id,starts_at,ends_at,status,
 studio_commission_percent_snapshot,total_price,total_duration_min)
VALUES (${uuid(booking)},${uuid(studio)},${uuid(staff)},
 '2030-10-30T10:00:00Z','2030-10-30T10:30:00Z','confirmed',23,28,30);
INSERT INTO public.appointment_services(id,appointment_id,service_id,price,duration_min,
 studio_commission_percent_snapshot)
VALUES (${uuid(line)},${uuid(booking)},${uuid(service)},28,30,23);
COMMIT;`;
const seed=spawnSync('docker',['exec','-i','supabase_db_agenda-stage2-rls-qa',
  'psql','-U','postgres','-d','postgres','-q','-v','ON_ERROR_STOP=1'],
  {input:sql,encoding:'utf8',timeout:30000});
if(seed.status!==0)throw new Error(`SYNTHETIC_SEED_FAILED: ${seed.stderr.slice(0,250)}`);
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const http=[];
  const authCalls=[];
  const agendaErrors=[];
  page.on('console',(message)=>{
    if(message.type()==='error'&&message.text().includes('[agenda]'))
      agendaErrors.push(message.text().slice(0,350));
  });
  page.on('response',(response)=>{
    const path=new URL(response.url()).pathname;
    if(response.status()>=400)http.push({status:response.status(),path});
    if(path.startsWith('/auth/v1/')||path==='/api/auth/session'||path.includes('server'))
      authCalls.push({status:response.status(),path});
  });
  await page.goto('http://127.0.0.1:4178/login',{waitUntil:'domcontentloaded',timeout:30000});
  const rejectCookies=page.getByRole('button',{name:/^rejeitar$/i});
  await rejectCookies.waitFor({state:'visible',timeout:5000}).catch(()=>{});
  if(await rejectCookies.isVisible())await rejectCookies.click();
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL((url)=>url.pathname!=='/login',{timeout:15000}).catch(async()=>{
    const body=await page.locator('body').innerText();
    throw new Error(`LOGIN_ROUTE_STUCK: ${JSON.stringify({
      path:new URL(page.url()).pathname,begin:body.slice(0,450),end:body.slice(-450),
      httpErrors:http.slice(0,8),authCalls:authCalls.slice(-12)})}`);
  });
  const session=await page.request.get('http://127.0.0.1:4178/api/auth/session');
  assert.equal(session.status(),200);
  assert.equal((await session.json()).userId,uid);
  await rejectCookies.waitFor({state:'visible',timeout:10000}).catch(()=>{});
  if(await rejectCookies.isVisible().catch(()=>false))await rejectCookies.click();
  const skipGuide=page.getByRole('button',{name:'Pular',exact:true});
  await skipGuide.waitFor({state:'visible',timeout:8000}).catch(()=>{});
  for(let attempt=0;attempt<6&&await skipGuide.isVisible().catch(()=>false);attempt++){
    if(await rejectCookies.isVisible().catch(()=>false))await rejectCookies.click();
    await skipGuide.click();
  }
  const later=page.getByRole('button',{name:'Lembrar depois',exact:true});
  if(await later.isVisible().catch(()=>false))await later.click();
  await page.goto(`http://127.0.0.1:4178/admin/agenda?appointment=${booking}&studio=${studio}`,
    {waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('heading',{name:'Agenda',exact:true}).waitFor({timeout:15000})
    .catch(async()=>{
      throw new Error(`AGENDA_ROUTE_STUCK: ${JSON.stringify({
        path:new URL(page.url()).pathname,
        body:(await page.locator('body').innerText()).slice(-700),
        httpErrors:http.slice(-12),
      })}`);
    });
  const details=page.getByText('Detalhes da marcação',{exact:true});
  await details.waitFor({timeout:10000}).catch(async()=>{
    throw new Error(`DETAILS_NOT_OPEN: ${JSON.stringify({
      path:new URL(page.url()).pathname,
      body:(await page.locator('body').innerText()).slice(-850),
      httpErrors:http.slice(-12),
      authCalls:authCalls.slice(-12),agendaErrors:agendaErrors.slice(-5),
    })}`);
  });
  const edit=page.getByRole('button',{name:'Editar reserva',exact:true});
  await edit.click();
  const dialog=page.getByRole('dialog',{name:'Editar marcação'});
  await dialog.waitFor({timeout:15000});
  await dialog.getByLabel('Duração individual em minutos').fill('60');
  await dialog.getByRole('button',{name:'Guardar alterações',exact:true}).click();
  await dialog.waitFor({state:'hidden',timeout:20000}).catch(async()=>{
    throw new Error(`DURATION_UI_SAVE_FAILED: ${JSON.stringify({
      dialog:(await dialog.innerText()).slice(-600),
      body:(await page.locator('body').innerText()).slice(-450),
      httpErrors:http.slice(-8),agendaErrors:agendaErrors.slice(-3),
    })}`);
  });
  const saved=await admin.from('appointments')
    .select('starts_at,ends_at,total_duration_min,total_price,studio_commission_percent_snapshot')
    .eq('id',booking).single();
  const savedLine=await admin.from('appointment_services')
    .select('service_id,price,duration_min,studio_commission_percent_snapshot')
    .eq('id',line).single();
  if(saved.error||savedLine.error)throw new Error('QA_BOOKING_READ_FAILED');
  assert.equal(saved.data.total_duration_min,60);
  assert.equal(Date.parse(saved.data.ends_at)-Date.parse(saved.data.starts_at),60*60_000);
  assert.equal(saved.data.total_price,28);
  assert.equal(saved.data.studio_commission_percent_snapshot,23);
  assert.equal(savedLine.data.service_id,service);
  assert.equal(savedLine.data.price,28);
  assert.equal(savedLine.data.duration_min,60);
  assert.equal(savedLine.data.studio_commission_percent_snapshot,23);
  await page.getByText('10:00 – 11:00',{exact:true}).waitFor({timeout:5000});
  const bodyAfter=await page.locator('body').innerText();
  assert.ok(bodyAfter.includes('Profissional QA local · 1h'));
  assert.equal(http.some((entry)=>entry.status===404),false);
  await page.goto(`http://127.0.0.1:4178/admin/agenda?appointment=${booking}&studio=${studio}`,
    {waitUntil:'domcontentloaded',timeout:30000});
  await page.getByText('Detalhes da marcação',{exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'Editar reserva',exact:true}).click();
  const editAgain=page.getByRole('dialog',{name:'Editar marcação'});
  await editAgain.getByRole('button',{name:'Encaixar',exact:true}).click();
  const fitDialog=page.getByRole('dialog',{name:'Ajustar horário e duração'});
  await fitDialog.getByRole('button',{name:'Marcar esta reserva existente como encaixe'}).click();
  await fitDialog.getByRole('button',{name:'Guardar horário e duração'}).click();
  await fitDialog.waitFor({state:'hidden',timeout:20000});
  const fitted=await admin.from('appointments').select('is_manual_fit,total_price,studio_commission_percent_snapshot')
    .eq('id',booking).single();
  assert.ifError(fitted.error);
  assert.equal(fitted.data.is_manual_fit,true);
  assert.equal(fitted.data.total_price,28);
  assert.equal(fitted.data.studio_commission_percent_snapshot,23);
  await page.goto(`http://127.0.0.1:4178/admin/agenda?appointment=${booking}&studio=${studio}`,
    {waitUntil:'domcontentloaded',timeout:30000});
  await page.getByText('Detalhes da marcação',{exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'Editar reserva',exact:true}).click();
  await page.getByRole('dialog',{name:'Editar marcação'})
    .getByRole('button',{name:'Gerir encaixe',exact:true}).click();
  const clearDialog=page.getByRole('dialog',{name:'Ajustar horário e duração'});
  await clearDialog.getByRole('button',{name:/Encaixe marcado/}).click();
  await clearDialog.getByRole('button',{name:'Guardar horário e duração'}).click();
  await clearDialog.waitFor({state:'hidden',timeout:20000});
  const cleared=await admin.from('appointments').select('is_manual_fit').eq('id',booking).single();
  assert.ifError(cleared.error);
  assert.equal(cleared.data.is_manual_fit,false);
  console.log(JSON.stringify({environment:'disposable-local-app',sessionVerified:true,
    appointmentOpened:true,dialogClosed:true,durationMin:60,pricePreserved:true,
    commissionPreserved:true,servicePreserved:true,
    cardUpdatedWithoutReload:true,existingBookingFitMarked:true,existingBookingFitCleared:true,
    noMissingModule:true}));
}finally{await browser.close();}
