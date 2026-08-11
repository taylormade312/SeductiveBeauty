let currentUser = null;
const creators = [
  {id:'amaya',name:'Amaya Luxe',handle:'@amayaluxe',price:14.99,cat:'Glamour',initials:'AL',a:'#8d2d9b',b:'#23122f',bio:'Editorial glamour, private drops and behind-the-scenes sets.',subs:'24.8K',likes:'412K'},
  {id:'nia',name:'Nia Rose',handle:'@niarose',price:9.99,cat:'Lifestyle',initials:'NR',a:'#65227c',b:'#15112c',bio:'Luxury lifestyle, travel diaries and subscriber-only moments.',subs:'18.1K',likes:'326K'},
  {id:'skye',name:'Skye Monroe',handle:'@skyemonroe',price:19.99,cat:'Model',initials:'SM',a:'#46238e',b:'#181028',bio:'Premium modeling sets, weekly drops and personalized updates.',subs:'31.2K',likes:'691K'},
  {id:'lola',name:'Lola V',handle:'@lolav',price:0,cat:'Fashion',initials:'LV',a:'#9b4a8c',b:'#2e1536',bio:'High-fashion looks, styling and free previews.',subs:'42.7K',likes:'803K'},
  {id:'jade',name:'Jade Noir',handle:'@jadenoir',price:12.99,cat:'Glamour',initials:'JN',a:'#743166',b:'#160e1d',bio:'Dark editorial beauty and subscriber exclusives.',subs:'16.4K',likes:'285K'},
  {id:'aria',name:'Aria Moon',handle:'@ariamoon',price:7.99,cat:'Fitness',initials:'AM',a:'#3c4a99',b:'#161323',bio:'Fitness, confidence and members-only wellness content.',subs:'11.8K',likes:'194K'},
  {id:'maya',name:'Maya Saint',handle:'@mayasaint',price:24.99,cat:'VIP',initials:'MS',a:'#7a3c3c',b:'#261118',bio:'VIP private collection with frequent premium drops.',subs:'28.6K',likes:'557K'},
  {id:'elle',name:'Elle Divine',handle:'@elledivine',price:11.99,cat:'Lifestyle',initials:'ED',a:'#7b4c9a',b:'#1c1324',bio:'Beauty, lifestyle and exclusive subscriber chats.',subs:'21.5K',likes:'377K'}
];
const posts = [
 {id:'p1',creator:'amaya',text:'A little preview from tonight’s private set ✦ Full collection is live for subscribers.',locked:false,a:'#4e1d62',b:'#170f20',likes:1482,comments:92},
 {id:'p2',creator:'skye',text:'New private drop. This one stays in the vault.',locked:true,price:22,a:'#321557',b:'#130c1d',likes:803,comments:51},
 {id:'p3',creator:'nia',text:'Sunday reset, hotel views and a quiet morning. Members get the full diary.',locked:false,a:'#5d2c68',b:'#1a1022',likes:1264,comments:77},
 {id:'p4',creator:'maya',text:'VIP collection 08/10 — unlock the full 18-photo editorial.',locked:true,price:35,a:'#632738',b:'#170d13',likes:2219,comments:113}
];
const inbox = [
 {id:'amaya',preview:'I just dropped something new for you ✦',time:'5m',unread:true},
 {id:'skye',preview:'Thanks for subscribing 💜',time:'1h',unread:true},
 {id:'nia',preview:'Hope you liked today’s post!',time:'3h',unread:false},
 {id:'jade',preview:'New private message available',time:'Yesterday',unread:true}
];
const notifications = [
 ['amaya','Amaya Luxe posted a new subscriber-only photo.','2 min ago',true],['skye','Skye Monroe sent you a private message.','18 min ago',true],['maya','Maya Saint added a new PPV collection for $35.','1 hour ago',true],['nia','Nia Rose liked your comment.','4 hours ago',false],['elle','Elle Divine is running 25% off subscriptions.','Yesterday',false]
];

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const SUPABASE_URL = 'https://nkfflymfmmkfyzkzijni.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0Ox86UCUzUZ9HE3pyV1U9A_hjbZthLz';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
const toHandle = value => String(value||'creator').toLowerCase().replace(/[^a-z0-9_]+/g,'').slice(0,24) || 'creator';

async function getUserProfile(user){
  if(!user) return null;
  const {data:profile}=await sbClient.from('profiles').select('*').eq('id',user.id).maybeSingle();
  let role=profile?.role||'member';
  const requested=user.user_metadata?.requested_role;
  if(requested==='creator' && role!=='creator'){
    const {error}=await sbClient.from('creator_profiles').upsert({user_id:user.id,status:'pending'},{onConflict:'user_id'});
    if(!error) role='creator';
  }
  return {id:user.id,email:user.email,name:profile?.display_name||user.user_metadata?.display_name||user.email?.split('@')[0]||'Member',handle:profile?.username?`@${profile.username}`:`@${toHandle(profile?.display_name||user.email?.split('@')[0])}`,role,verified:!!profile?.is_18_verified};
}
