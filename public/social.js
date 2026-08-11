(function(){
  const baseApi=api;
  let liveConversations=[];

  const fmtAgo=value=>{
    const ms=Date.now()-new Date(value).getTime();
    if(!Number.isFinite(ms))return '';
    const m=Math.max(0,Math.floor(ms/60000));
    if(m<1)return 'now'; if(m<60)return `${m}m`; const h=Math.floor(m/60); if(h<24)return `${h}h`; const d=Math.floor(h/24); return `${d}d`;
  };
  const safe=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fallbackCreator=(id,profile={})=>({
    id,name:profile.display_name||'Creator',handle:profile.username?`@${profile.username}`:'@creator',
    price:0,cat:'Creator',initials:(profile.display_name||'SB').split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase(),
    a:'#7b2f92',b:'#17101f',bio:profile.bio||'Seductive Beauty creator',subs:'0',likes:'0',verified:true
  });

  api=async function(path,options={}){
    const method=(options.method||'GET').toUpperCase();
    let payload={}; try{payload=options.body?JSON.parse(options.body):{}}catch(e){}

    if(path==='/api/posts'&&method==='GET'){
      const d=await baseApi(path,options);
      if(Array.isArray(d.posts)){
        await Promise.all(d.posts.filter(p=>isUuid(p.id)).map(async p=>{
          const [{count:likes},{count:comments}]=await Promise.all([
            sbClient.from('post_likes').select('*',{count:'exact',head:true}).eq('post_id',p.id),
            sbClient.from('comments').select('*',{count:'exact',head:true}).eq('post_id',p.id)
          ]);
          p.likes=likes||0;p.comments=comments||0;
        }));
      }
      return d;
    }

    const commentMatch=path.match(/^\/api\/posts\/([^/]+)\/comments$/);
    if(commentMatch&&method==='GET'){
      const postId=commentMatch[1]; if(!isUuid(postId))return {comments:[],preview:true};
      const {data,error}=await sbClient.from('comments').select('id,user_id,body,created_at,profiles(display_name,username)').eq('post_id',postId).order('created_at',{ascending:true}).limit(100);
      if(error)throw new Error(error.message);return {comments:data||[]};
    }
    if(commentMatch&&method==='POST'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)throw new Error('Sign in required.');
      const postId=commentMatch[1];if(!isUuid(postId))return {comment:null,preview:true};
      const body=String(payload.body||'').trim();if(!body)throw new Error('Enter a comment.');
      const {data,error}=await sbClient.from('comments').insert({post_id:postId,user_id:user.id,body:body.slice(0,2000)}).select('id,user_id,body,created_at').single();
      if(error)throw new Error(error.message);return {comment:data};
    }

    if(path==='/api/notifications'&&method==='GET'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)return {notifications:[]};
      const {data,error}=await sbClient.from('notifications').select('id,actor_id,type,title,body,data,read_at,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);
      if(error)throw new Error(error.message);return {notifications:data||[]};
    }
    if(path==='/api/notifications/read'&&method==='POST'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)throw new Error('Sign in required.');
      const {error}=await sbClient.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',user.id).is('read_at',null);
      if(error)throw new Error(error.message);return {ok:true};
    }

    if(path==='/api/blocks'&&method==='GET'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)return {blockedIds:[]};
      const {data,error}=await sbClient.from('blocks').select('blocked_id').eq('blocker_id',user.id);
      if(error)throw new Error(error.message);return {blockedIds:(data||[]).map(x=>x.blocked_id)};
    }
    if(path==='/api/blocks'&&method==='POST'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)throw new Error('Sign in required.');
      const blockedId=String(payload.blockedId||'');if(!isUuid(blockedId))throw new Error('Blocking is available on live creator accounts.');
      if(blockedId===user.id)throw new Error('You cannot block your own account.');
      const {data:existing}=await sbClient.from('blocks').select('blocked_id').eq('blocker_id',user.id).eq('blocked_id',blockedId).maybeSingle();
      if(existing){const {error}=await sbClient.from('blocks').delete().eq('blocker_id',user.id).eq('blocked_id',blockedId);if(error)throw new Error(error.message);return {blocked:false};}
      const {error}=await sbClient.from('blocks').insert({blocker_id:user.id,blocked_id:blockedId});if(error)throw new Error(error.message);return {blocked:true};
    }

    if(path==='/api/conversations'&&method==='GET'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)return {conversations:[]};
      const {data:mine,error:mineErr}=await sbClient.from('conversation_members').select('conversation_id').eq('user_id',user.id).limit(100);
      if(mineErr)throw new Error(mineErr.message);
      const conversations=[];
      for(const row of (mine||[])){
        const convId=row.conversation_id;
        const [{data:members,error:memErr},{data:msgs,error:msgErr}]=await Promise.all([
          sbClient.from('conversation_members').select('user_id').eq('conversation_id',convId),
          sbClient.from('messages').select('id,sender_id,body,media_path,created_at,read_at').eq('conversation_id',convId).order('created_at',{ascending:false}).limit(50)
        ]);
        if(memErr||msgErr)continue;
        const otherId=(members||[]).map(x=>x.user_id).find(id=>id!==user.id);if(!otherId)continue;
        const {data:profile}=await sbClient.from('profiles').select('id,display_name,username,bio').eq('id',otherId).maybeSingle();
        conversations.push({id:convId,other:fallbackCreator(otherId,profile||{}),messages:(msgs||[]).reverse(),latest:(msgs||[])[0]?.created_at||null});
      }
      conversations.sort((a,b)=>new Date(b.latest||0)-new Date(a.latest||0));
      return {conversations};
    }

    if(path==='/api/messages'&&method==='POST'){
      const {data:{user}}=await sbClient.auth.getUser();if(!user)throw new Error('Sign in required.');
      const creatorId=String(payload.creatorId||'');
      if(!isUuid(creatorId))return {message:{preview:true}};
      const text=String(payload.text||'').trim();if(!text)throw new Error('Enter a message.');
      const {data:mine,error:mineErr}=await sbClient.from('conversation_members').select('conversation_id').eq('user_id',user.id).limit(100);
      if(mineErr)throw new Error(mineErr.message);
      let convId=null;
      for(const row of (mine||[])){
        const {data:members}=await sbClient.from('conversation_members').select('user_id').eq('conversation_id',row.conversation_id);
        const ids=(members||[]).map(x=>x.user_id);
        if(ids.length===2&&ids.includes(user.id)&&ids.includes(creatorId)){convId=row.conversation_id;break;}
      }
      if(!convId){
        const {data:conv,error:convErr}=await sbClient.from('conversations').insert({created_by:user.id}).select().single();if(convErr)throw new Error(convErr.message);convId=conv.id;
        const {error:membersErr}=await sbClient.from('conversation_members').insert([{conversation_id:convId,user_id:user.id},{conversation_id:convId,user_id:creatorId}]);if(membersErr)throw new Error(membersErr.message);
      }
      const {data,error}=await sbClient.from('messages').insert({conversation_id:convId,sender_id:user.id,body:text}).select().single();
      if(error){if(/policy|row-level|permission/i.test(error.message))throw new Error('Message blocked by privacy settings.');throw new Error(error.message)}
      return {message:data,conversationId:convId};
    }

    return baseApi(path,options);
  };

  async function showComments(postId){
    if(!isUuid(postId)){toast('Comments are available on live creator posts.');return;}
    const d=await api(`/api/posts/${postId}/comments`);
    let modal=$('#commentModal');
    if(!modal){
      modal=document.createElement('div');modal.id='commentModal';modal.className='auth-modal';document.body.appendChild(modal);
    }
    modal.innerHTML=`<div class="auth-dialog glass"><button class="auth-close close-comments">×</button><h2>Comments</h2><div class="comment-list" style="max-height:45vh;overflow:auto;display:grid;gap:10px;margin:16px 0">${(d.comments||[]).map(c=>`<div class="glass-soft" style="padding:12px;border-radius:12px"><b>${safe(c.profiles?.display_name||c.profiles?.username||'Member')}</b><p style="margin:6px 0">${safe(c.body)}</p><small class="muted">${fmtAgo(c.created_at)}</small></div>`).join('')||'<p class="muted">No comments yet.</p>'}</div><form id="commentForm" class="auth-form"><label>Add a comment<textarea id="commentBody" maxlength="2000" placeholder="Write a respectful comment"></textarea></label><button class="btn primary wide">Post comment</button></form></div>`;
    modal.classList.remove('hidden');modal.querySelector('.close-comments').onclick=()=>modal.classList.add('hidden');
    modal.onclick=e=>{if(e.target===modal)modal.classList.add('hidden')};
    modal.querySelector('#commentForm').onsubmit=async e=>{
      e.preventDefault();if(!await requireAuth())return;
      const body=modal.querySelector('#commentBody').value.trim();if(!body)return;
      try{await api(`/api/posts/${postId}/comments`,{method:'POST',body:JSON.stringify({body})});toast('Comment posted');showComments(postId);refreshLivePosts();}catch(err){toast(err.message)}
    };
  }

  async function loadLiveNotifications(){
    if(!currentUser){renderNotifications();return;}
    try{
      const d=await api('/api/notifications');
      const list=d.notifications||[];
      $('#notificationList').innerHTML=list.length?list.map(n=>`<div class="notification ${n.read_at?'':'unread'}"><div class="avatar">${safe((n.title||'N').slice(0,1))}</div><div class="meta"><p><b>${safe(n.title)}</b>${n.body?` — ${safe(n.body)}`:''}</p><small>${fmtAgo(n.created_at)}</small></div></div>`).join(''):'<p class="muted">No notifications yet.</p>';
      const badge=$('.top-actions .badge');if(badge)badge.textContent=String(list.filter(x=>!x.read_at).length);
    }catch(err){toast(err.message)}
  }

  function liveChatHTML(conv){
    const c=conv.other;
    return `<div class="conversation-header">${avatarHTML(c)}<div class="meta"><b>${safe(c.name)}</b><small class="muted">Private conversation</small></div><button class="menu-dot chat-block" data-block-id="${safe(c.id)}">•••</button></div><div class="conversation-body">${(conv.messages||[]).map(m=>`<div class="bubble ${m.sender_id===currentUser?.id?'me':'them'}">${safe(m.body||'Media message')}</div>`).join('')||'<p class="muted">Start the conversation.</p>'}</div><div class="conversation-compose"><button>＋</button><input placeholder="Message ${safe(c.name.split(' ')[0])}..."/><button class="send-message">Send</button></div>`;
  }

  async function loadLiveInbox(){
    if(!currentUser){renderInbox();return;}
    try{
      const d=await api('/api/conversations');liveConversations=d.conversations||[];
      if(!liveConversations.length){$('#inboxList').innerHTML='<p class="muted" style="padding:18px">No conversations yet. Open a live creator profile to start one.</p>';$('#conversationPane').innerHTML='<div class="conversation-empty"><h3>Your messages will appear here</h3><p class="muted">Private messaging is ready for live creator accounts.</p></div>';return;}
      $('#inboxList').innerHTML=liveConversations.map((conv,i)=>`<div class="inbox-item ${i===0?'active':''}" data-chat="${safe(conv.other.id)}" data-conversation="${safe(conv.id)}">${avatarHTML(conv.other,'small')}<div class="meta"><b>${safe(conv.other.name)}</b><p>${safe(conv.messages.at(-1)?.body||'No messages yet')}</p><time>${fmtAgo(conv.latest)}</time></div></div>`).join('');
      $('#conversationPane').innerHTML=liveChatHTML(liveConversations[0]);
    }catch(err){toast(err.message)}
  }

  const baseOpenChat=openChat;
  openChat=function(id){
    const conv=liveConversations.find(x=>x.other.id===id||x.id===id);
    if(!conv)return baseOpenChat(id);
    $$('.inbox-item').forEach(x=>x.classList.toggle('active',x.dataset.chat===conv.other.id));
    $('#conversationPane').innerHTML=liveChatHTML(conv);
  };

  const baseSetView=setView;
  setView=function(name){
    baseSetView(name);
    if(name==='messages')loadLiveInbox();
    if(name==='notifications')loadLiveNotifications();
  };

  async function refreshLivePosts(){
    try{
      const [c,p]=await Promise.all([api('/api/creators'),api('/api/posts')]);
      if(c.creators){
        for(const creator of c.creators){
          creator.verified=true;
          const idx=creators.findIndex(x=>x.id===creator.id);if(idx>=0)creators[idx]=creator;else creators.unshift(creator);
        }
      }
      if(p.posts){
        const live=p.posts.filter(x=>getCreator(x.creator));
        const demos=posts.filter(x=>!isUuid(x.id));
        posts.splice(0,posts.length,...live,...demos);
      }
      renderStories();renderTrending();renderCreatorGrid();renderFeed();renderBookmarks();
    }catch(e){console.warn(e.message)}
  }

  const previousCreatorProfile=renderCreatorProfile;
  renderCreatorProfile=function(id){
    previousCreatorProfile(id);
    if(isUuid(id)){
      const actions=$('#creatorProfileMount .profile-actions');
      if(actions&&!actions.querySelector('.creator-block'))actions.insertAdjacentHTML('beforeend',`<button class="btn ghost creator-block" data-block-id="${safe(id)}">Block</button>`);
    }
  };

  document.addEventListener('click',async e=>{
    const comment=e.target.closest('.comment-btn');
    if(comment){e.stopImmediatePropagation();const postId=comment.closest('[data-post-id]')?.dataset.postId;if(postId)showComments(postId);return;}
    const block=e.target.closest('.creator-block,.chat-block');
    if(block){e.stopImmediatePropagation();if(!await requireAuth())return;const id=block.dataset.blockId;if(!id)return;try{const d=await api('/api/blocks',{method:'POST',body:JSON.stringify({blockedId:id})});toast(d.blocked?'Account blocked':'Account unblocked');if(d.blocked&&$('#view-messages').classList.contains('active-view'))loadLiveInbox();}catch(err){toast(err.message)}return;}
    const mark=e.target.closest('#view-notifications .page-heading .btn');
    if(mark){e.stopImmediatePropagation();if(!currentUser)return;try{await api('/api/notifications/read',{method:'POST',body:'{}'});loadLiveNotifications();toast('Notifications marked read')}catch(err){toast(err.message)}return;}
  },true);

  const oldCreatorClickHandler=document.querySelector('#creatorProfileMount');
  document.addEventListener('click',e=>{
    const msg=e.target.closest('.creator-message');
    if(msg){
      const id=$('#creatorProfileMount [data-creator-id]')?.dataset.creatorId;
      if(isUuid(id)){
        const c=getCreator(id);if(c&&!liveConversations.some(x=>x.other.id===id))liveConversations.unshift({id:'new-'+id,other:c,messages:[],latest:null});
        setView('messages');setTimeout(()=>openChat(id),50);
      }
    }
  },true);

  sbClient.auth.onAuthStateChange(()=>setTimeout(()=>{loadLiveNotifications();loadLiveInbox();refreshLivePosts()},0));
  refreshLivePosts();
})();
