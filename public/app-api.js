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
    if(!payload.adultAttested) throw new Error('You must confirm that you are 18 or older.');
    const requested_role=payload.role==='creator'?'creator':'member';
    const {data,error}=await sbClient.auth.signUp({
      email,password,
      options:{emailRedirectTo:`${location.origin}/`,data:{display_name:name,requested_role,adult_attested:true}}
    });
    if(error) throw new Error(error.message);
    if(data.session && data.user){
      const username=toHandle(name)+'_'+String(data.user.id).slice(0,4);
      await sbClient.from('profiles').update({display_name:name,username}).eq('id',data.user.id);
      if(requested_role==='creator') await sbClient.from('creator_profiles').insert({user_id:data.user.id});
    }
    return {user:data.session?await getUserProfile(data.user):null,confirmationRequired:!data.session};
  }
  if(path==='/api/logout' && method==='POST'){
    const {error}=await sbClient.auth.signOut(); if(error) throw new Error(error.message); return {ok:true};
  }
  if(path==='/api/reset-password' && method==='POST'){
    const email=String(payload.email||'').trim();
    if(!email) throw new Error('Enter your email address first.');
    const {error}=await sbClient.auth.resetPasswordForEmail(email,{redirectTo:`${location.origin}/`});
    if(error) throw new Error(error.message);
    return {ok:true};
  }
  if(path==='/api/profile' && method==='PATCH'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const updates={};
    if(payload.name!==undefined) updates.display_name=String(payload.name||'').trim().slice(0,80);
    if(payload.username!==undefined) updates.username=toHandle(payload.username);
    if(payload.bio!==undefined) updates.bio=String(payload.bio||'').trim().slice(0,500);
    if(payload.dateOfBirth) updates.date_of_birth=String(payload.dateOfBirth);
    const {error}=await sbClient.from('profiles').update(updates).eq('id',user.id); if(error) throw new Error(error.message);
    return {user:await getUserProfile(user)};
  }
  if(path==='/api/verification' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const {data:cp}=await sbClient.from('creator_profiles').select('user_id,status').eq('user_id',user.id).maybeSingle();
    if(!cp) throw new Error('Create a creator account first.');
    const {data:existing}=await sbClient.from('creator_verifications').select('id,status').eq('creator_id',user.id).eq('status','pending').maybeSingle();
    if(existing) return {verification:existing,alreadyPending:true};
    const {data,error}=await sbClient.from('creator_verifications').insert({creator_id:user.id}).select('id,status,submitted_at').single();
    if(error) throw new Error(error.message);
    return {verification:data};
  }
  if(path==='/api/bookmarks' && method==='GET'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) return {postIds:[]};
    const {data,error}=await sbClient.from('post_bookmarks').select('post_id').eq('user_id',user.id);
    if(error) throw new Error(error.message);
    return {postIds:(data||[]).map(x=>x.post_id)};
  }
  if(path==='/api/studio' && method==='GET'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const [{count:postCount},{count:subscriberCount},{data:txs}] = await Promise.all([
      sbClient.from('posts').select('*',{count:'exact',head:true}).eq('creator_id',user.id),
      sbClient.from('subscriptions').select('*',{count:'exact',head:true}).eq('creator_id',user.id).eq('status','active'),
      sbClient.from('transactions').select('type,status,creator_net,gross_amount,created_at').eq('creator_id',user.id).order('created_at',{ascending:false}).limit(20)
    ]);
    const completed=(txs||[]).filter(x=>x.status==='completed');
    const balance=completed.reduce((s,x)=>s+Number(x.creator_net||0),0);
    const ppv=completed.filter(x=>x.type==='ppv').reduce((s,x)=>s+Number(x.creator_net||0),0);
    return {postCount:postCount||0,subscriberCount:subscriberCount||0,balance,ppv,transactions:txs||[]};
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
  const bookmarkMatch=path.match(/^\/api\/posts\/([^/]+)\/bookmark$/);
  if(bookmarkMatch && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const postId=bookmarkMatch[1]; if(!isUuid(postId)) return {bookmarked:true,preview:true};
    const {data:existing}=await sbClient.from('post_bookmarks').select('post_id').eq('post_id',postId).eq('user_id',user.id).maybeSingle();
    if(existing){
      const {error}=await sbClient.from('post_bookmarks').delete().eq('post_id',postId).eq('user_id',user.id); if(error) throw new Error(error.message);
      return {bookmarked:false};
    }
    const {error}=await sbClient.from('post_bookmarks').insert({post_id:postId,user_id:user.id}); if(error) throw new Error(error.message);
    return {bookmarked:true};
  }
  if(path==='/api/messages' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    if(!isUuid(payload.creatorId)) return {message:{preview:true}};
    const text=String(payload.text||'').trim(); if(!text) throw new Error('Enter a message.');
    const {data:conv,error:convErr}=await sbClient.from('conversations').insert({created_by:user.id}).select().single(); if(convErr) throw new Error(convErr.message);
    const {error:membersErr}=await sbClient.from('conversation_members').insert([{conversation_id:conv.id,user_id:user.id},{conversation_id:conv.id,user_id:payload.creatorId}]); if(membersErr) throw new Error(membersErr.message);
    const {data,error}=await sbClient.from('messages').insert({conversation_id:conv.id,sender_id:user.id,body:text}).select().single(); if(error) throw new Error(error.message); return {message:data};
  }
  if(path==='/api/transactions' && method==='POST'){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
    const type=['subscription','ppv','tip','message_unlock'].includes(payload.type)?payload.type:'tip';
    const amount=Math.max(0,Number(payload.amount||0));
    if(!isUuid(payload.creatorId)) return {pendingProvider:true,intent:{preview:true,type,amount}};
    const {data:intent,error}=await sbClient.from('checkout_intents').insert({
      user_id:user.id,creator_id:payload.creatorId,intent_type:type,amount,status:'awaiting_provider',
      metadata:{source:'web',domain:location.hostname}
    }).select().single();
    if(error) throw new Error(error.message);
    return {pendingProvider:true,intent};
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
async function uploadMediaForPost(file,post){
  const {data:{user}}=await sbClient.auth.getUser(); if(!user) throw new Error('Sign in required.');
  const access=post.access||'subscribers';
  const bucket=access==='free'?'creator-public':'creator-private';
  const safeName=String(file.name||'media').replace(/[^A-Za-z0-9._-]+/g,'-').slice(-120);
  const path=`${user.id}/${post.id}/${crypto.randomUUID()}-${safeName}`;
  const {error:uploadError}=await sbClient.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type||undefined});
  if(uploadError) throw new Error(uploadError.message);
  const mediaType=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':'image';
  const {error:rowError}=await sbClient.from('post_media').insert({post_id:post.id,creator_id:user.id,storage_path:path,media_type:mediaType});
  if(rowError){ await sbClient.storage.from(bucket).remove([path]); throw new Error(rowError.message); }
  return {path,bucket,mediaType};
}
async function loadBookmarks(){
  try{
    if(currentUser){
      const d=await api('/api/bookmarks');
      (d.postIds||[]).forEach(id=>bookmarkedPostIds.add(id));
    }
  }catch(e){}
  renderFeed(); renderBookmarks();
}
async function refreshStudio(){
  if(!currentUser || currentUser.role!=='creator') return;
  try{
    const d=await api('/api/studio');
    if($('#metricBalance')) $('#metricBalance').textContent=`$${Number(d.balance||0).toFixed(2)}`;
    if($('#metricSubscribers')) $('#metricSubscribers').textContent=Number(d.subscriberCount||0).toLocaleString();
    if($('#metricPPV')) $('#metricPPV').textContent=`$${Number(d.ppv||0).toFixed(2)}`;
    if($('#metricPosts')) $('#metricPosts').textContent=Number(d.postCount||0).toLocaleString();
    const tbody=$('#studioTransactions');
    if(tbody){
      tbody.innerHTML=(d.transactions||[]).map(tx=>`<tr><td>Member</td><td>${tx.type}</td><td>$${Number(tx.gross_amount||0).toFixed(2)}</td><td><span class="status ${tx.status==='completed'?'success':'pending'}">${tx.status}</span></td></tr>`).join('')||'<tr><td colspan="4" class="muted">No completed transactions yet. Payment processing is not connected.</td></tr>';
    }
  }catch(e){ console.warn(e.message); }
}

