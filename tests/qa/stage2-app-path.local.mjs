import {execFileSync,spawnSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';

const raw = execFileSync('supabase',['status','--workdir','tmp/agenda-stage2-rls-qa','-o','json'],
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
  page.on('response',(response)=>{if(response.status()>=400)
    http.push({status:response.status(),path:new URL(response.url()).pathname});});
  await page.goto('http://127.0.0.1:4178/login',{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.waitForURL((url)=>url.pathname!=='/login',{timeout:15000}).catch(async()=>{
    const body=(await page.locator('body').innerText()).slice(-650);
    throw new Error(`LOGIN_ROUTE_STUCK: ${JSON.stringify({body,httpErrors:http.slice(0,8)})}`);
  });
  await page.goto(`http://127.0.0.1:4178/admin/agenda?appointment=${booking}&studio=${studio}`,
    {waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('heading',{name:'Agenda',exact:true}).waitFor({timeout:30000});
  const details=page.getByText('Detalhes da marcação',{exact:true});
  await details.waitFor({timeout:10000});
  const edit=page.getByRole('button',{name:'Editar reserva',exact:true});
  console.log(JSON.stringify({environment:'disposable-local-app',authenticated:!page.url().includes('/login'),
    appointmentOpened:await details.isVisible(),editAvailable:await edit.isVisible(),
    httpErrors:http.slice(0,8)}));
}finally{await browser.close();}
