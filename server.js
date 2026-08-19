const express=require("express");
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");
const app=express();
app.use(express.json({limit:"12mb"}));
app.use(express.urlencoded({extended:true,limit:"12mb"}));
app.use(express.static(path.join(__dirname,"public")));
const PORT=process.env.PORT||10000, DATA_FILE=path.join(__dirname,"data.json");
const competitors=[
{id:"wakefit",name:"Wakefit",type:"Direct",url:"https://www.wakefit.co"},
{id:"duroflex",name:"Duroflex",type:"Direct",url:"https://www.duroflexworld.com"},
{id:"sleepycat",name:"SleepyCat",type:"Direct",url:"https://sleepycat.in"},
{id:"pepperfry",name:"Pepperfry",type:"Furniture",url:"https://www.pepperfry.com"},
{id:"nilkamal",name:"Nilkamal",type:"Furniture",url:"https://www.nilkamalfurniture.com"},
{id:"ikea",name:"IKEA India",type:"Furniture",url:"https://www.ikea.com/in/en"},
{id:"urbanladder",name:"Urban Ladder",type:"Furniture",url:"https://www.urbanladder.com"},
{id:"durian",name:"Durian",type:"Furniture",url:"https://www.durian.in"}];
const journeys=[
{id:"mattress-browse",name:"Mattress/Product Browse",description:"Understand nurture after product discovery/viewing before purchase."},
{id:"cart-abandonment",name:"Cart Abandonment",description:"Benchmark cart recovery cadence, channels, offers and urgency."},
{id:"checkout-abandonment",name:"Checkout Abandonment",description:"Benchmark final-stage conversion pressure and recovery."},
{id:"post-purchase",name:"Post Purchase",description:"Benchmark delivery, review, engagement and retention."},
{id:"cross-sell",name:"Cross-Sell",description:"Understand when and how complementary products are introduced."}];
let pool=null, memory={competitors,journeys,communications:[],batches:[]};
function load(){try{if(fs.existsSync(DATA_FILE)){const x=JSON.parse(fs.readFileSync(DATA_FILE));memory={competitors:x.competitors?.length?x.competitors:competitors,journeys:x.journeys?.length?x.journeys:journeys,communications:x.communications||[],batches:x.batches||[]}}}catch(e){}}
function save(){fs.writeFileSync(DATA_FILE,JSON.stringify(memory,null,2))}
function uid(p="id"){return p+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8)}
function classify(body){
 const s=body.toLowerCase(); let category="Other";
 if(/payment|pay now|complete your payment|checkout|order/.test(s))category="Checkout/Payment";
 else if(/store|pin code|pincode|nearby|location|directions|visit us/.test(s))category="Store";
 else if(/accessor|pillow|protector|bed|cushion|blanket|sheet/.test(s))category="Cross-sell";
 else if(/welcome|how can we help|explore products/.test(s))category="Welcome/Product Discovery";
 else if(/off|discount|₹|rs\.?|coupon|free|sale|offer/.test(s))category="Offer";
 else if(/thank you|thanks for choosing|review|feedback/.test(s))category="Post Purchase";
 let offer=""; const m=body.match(/(?:up to\s*)?(\d+(?:\.\d+)?)\s*%?\s*(?:off|discount)/i);
 if(m)offer=m[1]+"%"; else if(/free/i.test(body))offer="Freebie"; else if(/coupon/i.test(body))offer="Coupon";
 let cta=""; if(/shop now|buy now|complete your purchase|purchase/.test(s))cta="Purchase";
 else if(/explore products/.test(s))cta="Explore"; else if(/share your pin|pin code/.test(s))cta="Store Locator";
 else if(/call or whatsapp|reach us back/.test(s))cta="Contact";
 return {category,offer,cta,urgency:/today|tonight|limited|hurry|ends|last chance|now/.test(s)}
}
function split(raw){return raw.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean)}
async function init(){
 if(!process.env.DATABASE_URL){load();return}
 pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
 await pool.query(`CREATE TABLE IF NOT EXISTS crm_competitors(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT,url TEXT);
 CREATE TABLE IF NOT EXISTS crm_journeys(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT);
 CREATE TABLE IF NOT EXISTS crm_batches(id TEXT PRIMARY KEY,competitor_id TEXT,channel TEXT,journey_id TEXT,source TEXT,raw_text TEXT,evidence_name TEXT,evidence_type TEXT,evidence_data TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),item_count INT DEFAULT 0);
 CREATE TABLE IF NOT EXISTS crm_communications(id TEXT PRIMARY KEY,batch_id TEXT,competitor_id TEXT,channel TEXT,journey_id TEXT,body TEXT NOT NULL,category TEXT,offer TEXT,cta TEXT,urgency BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW());`);
 for(const x of competitors) await pool.query("INSERT INTO crm_competitors VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",[x.id,x.name,x.type,x.url]);
 for(const x of journeys) await pool.query("INSERT INTO crm_journeys VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",[x.id,x.name,x.description]);
}
async function all(){
 if(pool){const r=await pool.query(`SELECT c.*,v.name competitor_name,j.name journey_name,b.evidence_name,b.evidence_type,b.evidence_data FROM crm_communications c LEFT JOIN crm_competitors v ON v.id=c.competitor_id LEFT JOIN crm_journeys j ON j.id=c.journey_id LEFT JOIN crm_batches b ON b.id=c.batch_id ORDER BY c.created_at DESC`);return r.rows}
 return memory.communications.slice().reverse().map(c=>{const v=memory.competitors.find(x=>x.id===c.competitor_id)||{},j=memory.journeys.find(x=>x.id===c.journey_id)||{},b=memory.batches.find(x=>x.id===c.batch_id)||{};return {...c,competitor_name:v.name||"Unassigned",journey_name:j.name||"Unassigned",evidence_name:b.evidence_name||"",evidence_type:b.evidence_type||"",evidence_data:b.evidence_data||""}})
}
app.get("/health",(q,r)=>r.json({ok:true,version:"1.2.0",database:!!pool}));
app.get("/api/meta",async(q,r)=>{if(pool){const[c,j]=await Promise.all([pool.query("SELECT * FROM crm_competitors ORDER BY name"),pool.query("SELECT * FROM crm_journeys ORDER BY name")]);return r.json({competitors:c.rows,journeys:j.rows})}r.json({competitors:memory.competitors,journeys:memory.journeys})});
app.get("/api/communications",async(q,r)=>r.json(await all()));
app.post("/api/import",async(req,res)=>{
 const {competitor_id,channel,journey_id,raw_text,source="bulk-paste",evidence_name="",evidence_type="",evidence_data=""}=req.body;
 if(!competitor_id||!channel||!raw_text?.trim())return res.status(400).json({error:"Brand, channel and communication text are required."});
 const items=split(raw_text),batchId=uid("batch"),now=new Date().toISOString();
 if(pool){
  await pool.query(`INSERT INTO crm_batches VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[batchId,competitor_id,channel,journey_id||null,source,raw_text,evidence_name,evidence_type,evidence_data,now,items.length]);
  for(const body of items){const x=classify(body);await pool.query(`INSERT INTO crm_communications VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[uid("msg"),batchId,competitor_id,channel,journey_id||null,body,x.category,x.offer,x.cta,x.urgency,now])}
 }else{
  memory.batches.push({id:batchId,competitor_id,channel,journey_id,source,raw_text,evidence_name,evidence_type,evidence_data,created_at:now,item_count:items.length});
  for(const body of items)memory.communications.push({id:uid("msg"),batch_id:batchId,competitor_id,channel,journey_id,body,...classify(body),created_at:now});
  save();
 }
 res.json({ok:true,batch_id:batchId,imported:items.length});
});
app.post("/webhooks/twilio/whatsapp",async(req,res)=>{const body=req.body.Body||"";if(body){const bid=uid("twilio"),x=classify(body);if(pool){await pool.query("INSERT INTO crm_batches(id,channel,source,raw_text,item_count) VALUES($1,$2,$3,$4,1)",[bid,"WhatsApp","twilio",body]);await pool.query("INSERT INTO crm_communications(id,batch_id,channel,body,category,offer,cta,urgency) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[uid("msg"),bid,"WhatsApp",body,x.category,x.offer,x.cta,x.urgency])}else{memory.batches.push({id:bid,channel:"WhatsApp",source:"twilio",raw_text:body,item_count:1,created_at:new Date().toISOString()});memory.communications.push({id:uid("msg"),batch_id:bid,channel:"WhatsApp",body,...x,created_at:new Date().toISOString()});save()}}res.type("text/xml").send("<Response></Response>")});
app.get("*",(q,r)=>r.sendFile(path.join(__dirname,"public/index.html")));
init().then(()=>app.listen(PORT,()=>console.log(`CRM Intel v1.2 running on port ${PORT} | DB: ${!!pool}`))).catch(e=>{console.error(e);process.exit(1)});
