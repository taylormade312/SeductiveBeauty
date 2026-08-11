async function api(path, options={}){
  const method=(options.method||'GET').toUpperCase();
  let payload={};
  try{ payload=options.body?JSON.parse(options.body):{} }catch(e){}

  if(path==='/api/session' && method==='GET'){
    const {data:{session}}=await sbClient.auth.getSession();
    return {user:await getUserProfile(session?.user||null)};
  }
  if(path==='/api/login' && method==='POST'){
    const {data,error}=await sbClient.auth.signInWithPassword({email:String(payload.email||'').trim(),password:String(payload.password||'')});
    if(error) throw new Error(error.message);
    return {user:await getUserProfile(data.user)};
  }
  if(path==='/api/signup' && method==='POST'){
    const name=String(payload.name||'').trim(), email=String(payload.email||'').trim(), password=String(payload.password||'');
    const requested_role=payload.role==='creator'?'creator':'member';
    const {data,error}=await sbClient.auth.signUp({email,password,options:{data:{display_name:name,requested_role}}});
    if(error) throw new Error(error.message);
    if(data.session && data.user){
      const username=toHandle(name)+'_'+String(data.user.id).slice(0,4);
      await sbClient.from('profiles').update({display_name:name,username}).eq('id',data.user.id);
      if(requested_role==='creator') await sbClient.from('creator_profiles').upsert({user_id:data.user.id,status:'pending'},{onConflict:'user_id'});
    }
    return {user:data.session?await getUserProfile(data.user):null,confirmationRequired:!data.session};
  }
  if(path==='/api/logout' && method==='POST'){
    const {error}=await sbClient.auth.signOut(); if(error) throw new Error(error.message); return {ok:true};
  }
  if(path==='/api/creators' && method==='GET'){
    const {data,error}=await sbClient.from('creator_profiles').select('user_id,monthly_price,category,total_subscribers,total_likes,status,profiles(display_name,username,bio)').eq('status','verified').limit(50);
    if(error) throw new Error(error.message);
    const mapped=(data||[]).map((row,i)=>({id:row.user_id,name:row.profiles?.display_name||'Seductive Beauty Creator',handle:'@'+(row.profiles?.username||`creator${i+1}`),price:Number(row.monthly_price||0),cat:row.category||'Creator',initials:(row.profiles?.display_name||'SB').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),a:['#8d2d9b','#65227c','#46238e','#9b4a8c'][i%4],b:'#151020',bio:row.profiles?.bio||'Exclusive creator content.',subs:Number(row.total_subscribers||0).toLocaleString(),likes:Number(row.total_likes||0).toLocaleString()}));
    return {creators:mapped.length?mapped:null};
  }
  if(path==='/api/posts' && method==='GET'){
    const {data,error}=await sbClient.from('posts').select('id,creator_id,caption,access,ppv_price,published_at').eq('is_published',true).order('published_at',{ascending:false}).limit(50);
    if(error) throw new Error(error.message);
    const mapped=(data||[]).map((row,i)=>({id:row.id,creator:row.creator_id,text:row.caption||'',visibility:row.access,locked:row.access==='ppv',price:Number(row.ppv_price||0),a:['#4e1d62','#321557','#5d2c68','#632738'][i%4],b:'#130c1d',likes:0,comments:0}));
    return {posts:mapped.length?mapped:null};
  }
  if(path==='/api/posts' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const access=payload.visibility==='everyone'?'free':payload.visibility==='ppv'?'ppv':'subscribers';
    const record={creator_id:user.id,caption:String(payload.text||'').trim(),access,ppv_price:access==='ppv'?Math.max(1,Number(payload.price||15)):null,is_published:true};
    const {data,error}=await sbClient.from('posts').insert(record).select().single(); if(error) throw new Error(error.message); return {post:data};
  }
  const likeMatch=path.match(/^\/api\/posts\/([^/]+)\/like$/);
  if(likeMatch && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const postId=likeMatch[1]; if(!isUuid(postId)) return {likes:null};
    const {data:existing}=await sbClient.from('post_likes').select('post_id').eq('post_id',postId).eq('user_id',user.id).maybeSingle();
    if(existing) await sbClient.from('post_likes').delete().eq('post_id',postId).eq('user_id',user.id); else await sbClient.from('post_likes').insert({post_id:postId,user_id:user.id});
    const {count}=await sbClient.from('post_likes').select('*',{count:'exact',head:true}).eq('post_id',postId); return {likes:count||0};
  }
  if(path==='/api/messages' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    if(!isUuid(payload.creatorId)) return {message:{preview:true}};
    const {data:conv,error:convErr}=await sbClient.from('conversations').insert({}).select().single(); if(convErr) throw new Error(convErr.message);
    await sbClient.from('conversation_members').insert([{conversation_id:conv.id,user_id:user.id},{conversation_id:conv.id,user_id:payload.creatorId}]);
    const {data,error}=await sbClient.from('messages').insert({conversation_id:conv.id,sender_id:user.id,body:String(payload.text||'').trim()}).select().single(); if(error) throw new Error(error.message); return {message:data};
  }
  if(path==='/api/transactions' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    if(!isUuid(payload.creatorId)) return {transaction:{preview:true,type:payload.type,amount:Number(payload.amount||0)}};
    const amount=Number(payload.amount||0);
    const {data:tx,error}=await sbClient.from('transactions').insert({user_id:user.id,creator_id:payload.creatorId,type:payload.type,status:'completed',gross_amount:amount,creator_net:amount,provider:'demo'}).select().single();
    if(error) throw new Error(error.message);
    if(payload.type==='subscription') await sbClient.from('subscriptions').upsert({subscriber_id:user.id,creator_id:payload.creatorId,status:'active',amount,provider:'demo',current_period_end:new Date(Date.now()+30*86400000).toISOString()},{onConflict:'subscriber_id,creator_id'});
    return {transaction:tx};
  }
  if(path==='/api/reports' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const rec={reporter_id:user.id,reason:String(payload.reason||'unspecified'),details:String(payload.details||'')};
    if(isUuid(payload.reportedUserId)) rec.reported_user_id=payload.reportedUserId;
    if(isUuid(payload.postId)) rec.post_id=payload.postId;
    const {data,error}=await sbClient.from('reports').insert(rec).select().single(); if(error) throw new Error(error.message); return {report:data};
  }
  throw new Error('API route not available.');
}
