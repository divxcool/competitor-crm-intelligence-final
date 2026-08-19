const express=require("express");
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");
const app=express();
app.use(express.json({limit:"20mb"}));
app.use(express.urlencoded({extended:true,limit:"20mb"}));
app.use(express.static(path.join(__dirname,"public")));

const PORT=process.env.PORT||10000;
const DATA_FILE=path.join(__dirname,"data.json");
const competitors=[
{id:"wakefit",name:"Wakefit",type:"Direct",url:"https://www.wakefit.co"},
{id:"duroflex",name:"Duroflex",type:"Direct",url:"https://www.duroflexworld.com"},
{id:"sleepycat",name:"SleepyCat",type:"Direct",url:"https://sleepycat.in"},
{id:"pepperfry",name:"Pepperfry",type:"Furniture",url:"https://www.pepperfry.com"},
{id:"nilkamal",name:"Nilkamal",type:"Furniture",url:"https://www.nilkamalfurniture.com"},
{id:"ikea",name:"IKEA India",type:"Furniture",url:"https://www.ikea.com/in/en"},
{id:"urbanladder",name:"Urban Ladder",type:"Furniture",url:"https://www.urbanladder.com"},
{id:"durian",name:"Durian",type:"Furniture",url:"https://www.durian.in"}
];
const journeys=[
{id:"mattress-browse",name:"Mattress/Product Browse",description:"Understand nurture after product discovery/viewing before purchase."},
{id:"cart-abandonment",name:"Cart Abandonment",description:"Benchmark cart recovery cadence, channels, offers and urgency."},
{id:"checkout-abandonment",name:"Checkout Abandonment",description:"Benchmark final-stage conversion pressure and recovery."},
{id:"post-purchase",name:"Post Purchase",description:"Benchmark delivery, review, engagement and retention."},
{id:"cross-sell",name:"Cross-Sell",description:"Understand when and how complementary products are introduced."}
];
let pool=null;
let memory={competitors,journeys,communications:[],batches:[]};

function load(){try{if(fs.existsSync(DATA_FILE)){const x=JSON.parse(fs.readFileSync(DATA_FILE));memory={competitors:x.competitors?.length?x.competitors:competitors,journeys:x.journeys?.length?x.journeys:journeys,communications:x.communications||[],batches:x.batches||[]}}}catch(e){console.error("load fallback",e.message)}}
function save(){fs.writeFileSync(DATA_FILE,JSON.stringify(memory,null,2))}
function uid(p="id"){return p+"_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8)}
function cleanText(s){return String(s||"").replace(/\r/g,"").trim()}

function parseTimestamp(line){
 const m=line.match(/(?:^|\b)(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM)?)(?:\b|$)/i);
 return m?m[1]:"";
}
function extractProduct(body){
 const s=body.toLowerCase();
 const products=[
  ["Mattress",/\bmattress(?:es)?\b|sleep quality|restful nights/],
  ["Pillow",/\bpillows?\b/],
  ["Bed",/\bbeds?\b|bed frame/],
  ["Protector",/\bprotector(?:s)?\b/],
  ["Cushion",/\bcushions?\b/],
  ["Bedsheet",/\bbedsheets?|bed sheets?|sheet sets?/],
  ["Recliner",/\brecliners?\b/],
  ["Sofa",/\bsofas?\b|couch/],
  ["Chair",/\boffice chairs?|chairs?\b/],
  ["Desk",/\bdesks?\b|standing desk|work desk/],
  ["Accessory",/\baccessor(?:y|ies)\b/]
 ];
 const hits=products.filter(([,re])=>re.test(s)).map(([n])=>n);
 return hits.length?hits.join(", "):"Not explicit";
}
function inferStage(s){
 if(/payment|pay now|complete your payment|checkout|order|payment failed|didn't go through/.test(s))return "Checkout/Payment";
 if(/cart|added to cart|items? in your cart/.test(s))return "Cart Abandonment";
 if(/store|pin code|pincode|nearby|location|directions|visit us/.test(s))return "Store / Offline";
 if(/accessor|pillow|protector|bed|cushion|blanket|sheet/.test(s)&&/explore|recommend|add|also|complete|category/.test(s))return "Cross-sell";
 if(/welcome|how can we help|explore products|struggling to choose|choose the perfect/.test(s))return "Product Discovery";
 if(/thank you|thanks for choosing|review|feedback|delivered|delivery/.test(s))return "Post Purchase";
 return "Other";
}
function classify(body){
 const s=body.toLowerCase();
 let category=inferStage(s);
 if(category==="Other"&&/off|discount|₹|rs\.?|coupon|free|sale|offer/.test(s))category="Offer";
 let offer="";
 const m=body.match(/(?:up to\s*)?(\d+(?:\.\d+)?)\s*%?\s*(?:off|discount)/i);
 if(m)offer=m[1]+"%"; else if(/free/i.test(body))offer="Freebie"; else if(/coupon/i.test(body))offer="Coupon";
 let cta="";
 if(/shop now|buy now|complete your purchase|purchase/.test(s))cta="Purchase";
 else if(/explore products/.test(s))cta="Explore";
 else if(/share your pin|pin code|locate nearby/.test(s))cta="Store Locator";
 else if(/call or whatsapp|reach us back/.test(s))cta="Contact";
 else if(/click the link|click here|tap here|tap to/.test(s))cta="Click/Tap";
 const urgency=/today|tonight|limited|hurry|ends|last chance|now|only \d+/.test(s);
 const tone=/\bhey\b|\bhi\b|welcome|unwind|comfort|restful|excited|😊|👋|☁️|✨/.test(s)?"Warm/Conversational":"Direct/Functional";
 return {category,offer,cta,urgency,product:extractProduct(body),tone};
}
function split(raw){
 const text=cleanText(raw);
 // Prefer blank-line blocks; if the paste has chat timestamps, keep each timestamped line/message as an item.
 const blocks=text.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
 if(blocks.length>1)return blocks;
 return text.split(/(?=\n?\s*(?:\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*[-–—:]?\s))/i).map(x=>x.trim()).filter(Boolean);
}
function batchContentAnalysis(items){
 const analyses=items.map((body,i)=>({...classify(body),time:parseTimestamp(body.split("\n")[0]),sequence:i+1}));
 const counts=(key)=>Object.entries(analyses.reduce((a,x)=>{const v=x[key]||"Other";a[v]=(a[v]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
 return {
  message_count:items.length,
  sequence:analyses,
  categories:counts("category"),
  products:counts("product"),
  ctas:counts("cta"),
  tones:counts("tone"),
  offers_detected:analyses.filter(x=>x.offer).length,
  urgency_messages:analyses.filter(x=>x.urgency).length,
  time_stamps_detected:analyses.filter(x=>x.time).length,
  first_message:analyses[0]||null,
  last_message:analyses[analyses.length-1]||null
 };
}
function creativeFallback(){return {status:"Not AI analysed",headline:"Screenshot saved",visual_style:"Screenshot stored as evidence",offer_visibility:"Unknown",cta_visibility:"Unknown",layout:"Unknown",brand_elements:"Unknown",notes:"Add GEMINI_API_KEY in Render to enable automatic screenshot analysis."}}
async function analyseCreative(data,type){
 if(!data||!type||!type.startsWith("image/"))return null;
 if(!process.env.GEMINI_API_KEY)return creativeFallback();
 try{
  const base64=data.split(",")[1]||data;
  const mime=data.match(/^data:([^;]+);base64,/)?.[1]||type;
  const prompt=`You are a CRM competitive-intelligence analyst. Analyse this competitor CRM screenshot/creative. Return ONLY valid JSON with keys: visual_style,headline,offer_visibility,cta_visibility,layout,brand_elements,product_visual,copy_tone,creative_strengths,creative_weaknesses,notes. Be specific but concise. Do not invent text that is not visible.`;
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:mime,data:base64}}]}],generationConfig:{responseMimeType:"application/json",temperature:0.2}})});
  if(!response.ok)throw new Error(`Gemini ${response.status}`);
  const j=await response.json();
  const raw=j.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"{}";
  return JSON.parse(raw.replace(/^```json\s*/i,"").replace(/```$/,""));
 }catch(e){console.error("creative analysis",e.message);return {...creativeFallback(),notes:`AI analysis failed: ${e.message}`}}
}
async function init(){
 if(!process.env.DATABASE_URL){load();return}
 pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false},max:5});
 await pool.query(`CREATE TABLE IF NOT EXISTS crm_competitors(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT,url TEXT);
 CREATE TABLE IF NOT EXISTS crm_journeys(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT);
 CREATE TABLE IF NOT EXISTS crm_batches(id TEXT PRIMARY KEY,competitor_id TEXT,channel TEXT,journey_id TEXT,source TEXT,raw_text TEXT,evidence_name TEXT,evidence_type TEXT,evidence_data TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),item_count INT DEFAULT 0,content_analysis JSONB,creative_analysis JSONB);
 CREATE TABLE IF NOT EXISTS crm_communications(id TEXT PRIMARY KEY,batch_id TEXT,competitor_id TEXT,channel TEXT,journey_id TEXT,body TEXT NOT NULL,category TEXT,offer TEXT,cta TEXT,urgency BOOLEAN DEFAULT FALSE,created_at TIMESTAMPTZ DEFAULT NOW(),product TEXT,tone TEXT,message_time TEXT,sequence_no INT);
 ALTER TABLE crm_batches ADD COLUMN IF NOT EXISTS content_analysis JSONB;
 ALTER TABLE crm_batches ADD COLUMN IF NOT EXISTS creative_analysis JSONB;
 ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS product TEXT;
 ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS tone TEXT;
 ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS message_time TEXT;
 ALTER TABLE crm_communications ADD COLUMN IF NOT EXISTS sequence_no INT;`);
 for(const x of competitors) await pool.query("INSERT INTO crm_competitors VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",[x.id,x.name,x.type,x.url]);
 for(const x of journeys) await pool.query("INSERT INTO crm_journeys VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",[x.id,x.name,x.description]);
}
async function all(){
 if(pool){const r=await pool.query(`SELECT c.*,v.name competitor_name,j.name journey_name,b.evidence_name,b.evidence_type,b.evidence_data,b.content_analysis,b.creative_analysis,b.created_at batch_created_at FROM crm_communications c LEFT JOIN crm_competitors v ON v.id=c.competitor_id LEFT JOIN crm_journeys j ON j.id=c.journey_id LEFT JOIN crm_batches b ON b.id=c.batch_id ORDER BY c.created_at DESC`);return r.rows}
 return memory.communications.slice().reverse().map(c=>{const v=memory.competitors.find(x=>x.id===c.competitor_id)||{},j=memory.journeys.find(x=>x.id===c.journey_id)||{},b=memory.batches.find(x=>x.id===c.batch_id)||{};return {...c,competitor_name:v.name||"Unassigned",journey_name:j.name||"Unassigned",evidence_name:b.evidence_name||"",evidence_type:b.evidence_type||"",evidence_data:b.evidence_data||"",content_analysis:b.content_analysis||null,creative_analysis:b.creative_analysis||null}})
}
async function batches(){
 if(pool){const r=await pool.query(`SELECT b.*,v.name competitor_name,j.name journey_name FROM crm_batches b LEFT JOIN crm_competitors v ON v.id=b.competitor_id LEFT JOIN crm_journeys j ON j.id=b.journey_id ORDER BY b.created_at DESC`);return r.rows}
 return memory.batches.slice().reverse().map(b=>({...b,competitor_name:memory.competitors.find(x=>x.id===b.competitor_id)?.name||"Unassigned",journey_name:memory.journeys.find(x=>x.id===b.journey_id)?.name||"Unassigned"}));
}
app.get("/health",(q,r)=>r.json({ok:true,version:"1.3.0",database:!!pool,gemini:!!process.env.GEMINI_API_KEY}));
app.get("/api/meta",async(q,r)=>{if(pool){const[c,j]=await Promise.all([pool.query("SELECT * FROM crm_competitors ORDER BY name"),pool.query("SELECT * FROM crm_journeys ORDER BY name")]);return r.json({competitors:c.rows,journeys:j.rows})}r.json({competitors:memory.competitors,journeys:memory.journeys})});
app.get("/api/communications",async(q,r)=>r.json(await all()));
app.get("/api/batches",async(q,r)=>r.json(await batches()));
app.get("/api/insights",async(q,r)=>{
 const rows=await all();
 const by=(key)=>Object.entries(rows.reduce((a,x)=>{const v=x[key]||"Unassigned";a[v]=(a[v]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
 const products=by("product"),categories=by("category"),channels=by("channel"),journeysBy=by("journey_name");
 const offers=rows.filter(x=>x.offer).length, urgent=rows.filter(x=>x.urgency).length;
 const insight=[];
 if(rows.length)insight.push(`Captured ${rows.length} communication messages across ${new Set(rows.map(x=>x.competitor_id).filter(Boolean)).size} competitors.`);
 if(journeysBy[0])insight.push(`${journeysBy[0][0]} is the most observed journey with ${journeysBy[0][1]} messages.`);
 if(products[0]&&products[0][0]!=="Not explicit")insight.push(`${products[0][0]} is the most frequently pitched product/category.`);
 if(offers)insight.push(`${offers} messages contain an identifiable offer, discount, freebie or coupon.`);
 if(urgent)insight.push(`${urgent} messages use urgency language such as today, now, limited or last chance.`);
 return r.json({total:rows.length,brands:new Set(rows.map(x=>x.competitor_id).filter(Boolean)).size,journeys:new Set(rows.map(x=>x.journey_id).filter(Boolean)).size,offers,urgent,channels,journeys:journeysBy,products,categories,insight,rows});
});
app.post("/api/import",async(req,res)=>{
 try{
  const {competitor_id,channel,journey_id,raw_text,source="bulk-paste",evidence_name="",evidence_type="",evidence_data=""}=req.body;
  if(!competitor_id||!channel||!raw_text?.trim())return res.status(400).json({error:"Brand, channel and communication text are required."});
  const items=split(raw_text),batchId=uid("batch"),now=new Date().toISOString();
  const content= batchContentAnalysis(items);
  const creative=await analyseCreative(evidence_data,evidence_type);
  if(pool){
   await pool.query(`INSERT INTO crm_batches(id,competitor_id,channel,journey_id,source,raw_text,evidence_name,evidence_type,evidence_data,created_at,item_count,content_analysis,creative_analysis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[batchId,competitor_id,channel,journey_id||null,source,raw_text,evidence_name,evidence_type,evidence_data,now,items.length,JSON.stringify(content),creative?JSON.stringify(creative):null]);
   for(const [i,body] of items.entries()){const x=classify(body);const a=content.sequence[i]||{};await pool.query(`INSERT INTO crm_communications(id,batch_id,competitor_id,channel,journey_id,body,category,offer,cta,urgency,created_at,product,tone,message_time,sequence_no) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[uid("msg"),batchId,competitor_id,channel,journey_id||null,body,x.category,x.offer,x.cta,x.urgency,now,x.product,x.tone,a.time||"",i+1])}
  }else{
   memory.batches.push({id:batchId,competitor_id,channel,journey_id,source,raw_text,evidence_name,evidence_type,evidence_data,created_at:now,item_count:items.length,content_analysis:content,creative_analysis:creative});
   for(const [i,body] of items.entries())memory.communications.push({id:uid("msg"),batch_id:batchId,competitor_id,channel,journey_id,body,...classify(body),message_time:content.sequence[i]?.time||"",sequence_no:i+1,created_at:now});
   save();
  }
  res.json({ok:true,batch_id:batchId,imported:items.length,content_analysis:content,creative_analysis:creative});
 }catch(e){console.error("IMPORT ERROR",e);res.status(500).json({error:e.message||"Import failed"})}
});
app.post("/webhooks/twilio/whatsapp",async(req,res)=>{try{const body=req.body.Body||"";if(body){const bid=uid("twilio"),x=classify(body),now=new Date().toISOString();if(pool){await pool.query("INSERT INTO crm_batches(id,channel,source,raw_text,item_count,content_analysis) VALUES($1,$2,$3,$4,1,$5)",[bid,"WhatsApp","twilio",body,JSON.stringify(batchContentAnalysis([body]))]);await pool.query("INSERT INTO crm_communications(id,batch_id,channel,body,category,offer,cta,urgency,created_at,product,tone,sequence_no) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)",[uid("msg"),bid,"WhatsApp",body,x.category,x.offer,x.cta,x.urgency,now,x.product,x.tone])}else{memory.batches.push({id:bid,channel:"WhatsApp",source:"twilio",raw_text:body,item_count:1,created_at:now,content_analysis:batchContentAnalysis([body])});memory.communications.push({id:uid("msg"),batch_id:bid,channel:"WhatsApp",body,...x,created_at:now});save()}}res.type("text/xml").send("<Response></Response>")}catch(e){console.error("TWILIO ERROR",e);res.type("text/xml").send("<Response></Response>")}});
// Express 5 does not accept the old '*' path syntax. Regex safely catches all remaining browser routes.
app.get(/.*/,(q,r)=>r.sendFile(path.join(__dirname,"public/index.html")));
init().then(()=>app.listen(PORT,()=>console.log(`CRM Intel v1.3 running on port ${PORT} | DB: ${!!pool} | Gemini: ${!!process.env.GEMINI_API_KEY}`))).catch(e=>{console.error(e);process.exit(1)});
