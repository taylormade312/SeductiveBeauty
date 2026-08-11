(function(){
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const mediaHTML = p => {
    if(!Array.isArray(p.media) || !p.media.length) return '';
    return `<div class="real-media-grid">${p.media.map(m=>{
      const url=esc(m.url);
      if(m.type==='video') return `<video controls playsinline preload="metadata" src="${url}"></video>`;
      if(m.type==='audio') return `<audio controls preload="metadata" src="${url}"></audio>`;
      return `<img loading="lazy" src="${url}" alt="Creator post media">`;
    }).join('')}</div>`;
  };

  transact = async function(type,creatorId,amount){
    if(!await requireAuth()) return null;
    try{
      const d=await api('/api/transactions',{method:'POST',body:JSON.stringify({type,creatorId,amount:Number(amount||0)})});
      if(d.pendingProvider){
        toast('Checkout request saved. Secure payments activate after the approved processor is connected.');
        return null;
      }
      return d.transaction||null;
    }catch(e){ toast(e.message); return null; }
  };

  updateAuthUI = function(){
    const b=$('#authBtn'); if(!b)return;
    b.textContent=currentUser?`${currentUser.name} · Sign out`:'Sign in';
    document.body.classList.toggle('signed-in',!!currentUser);
    if(currentUser){
      const profile=$('#view-profile .profile-header-card');
      if(profile){
        const h=profile.querySelector('h1'), p=profile.querySelector('p');
        if(h) h.textContent=currentUser.name;
        if(p) p.textContent=currentUser.handle||currentUser.email;
      }
      if($('#studioGreeting')) $('#studioGreeting').textContent=`Creator Studio · ${currentUser.name}`;
      if($('#verificationStatus')) $('#verificationStatus').textContent=
        currentUser.creatorStatus==='verified'?'Verified ✓':
        currentUser.role==='creator'?'Pending / not verified':'Become a creator';
      $$('.creator-only').forEach(x=>x.style.display=currentUser.role==='creator'||currentUser.role==='admin'?'':'none');
    }else{
      $$('.creator-only').forEach(x=>x.style.display='none');
    }
  };

  loadSession = async function(){
    try{
      const d=await api('/api/session');
      currentUser=d.user||null;
      updateAuthUI();
      await loadBookmarks();
      await refreshStudio();
    }catch(e){}
  };

  renderStories = function(){
    $('#stories').innerHTML=creators.slice(0,7).map(c=>`<div class="story" data-creator="${esc(c.id)}"><div class="story-ring"><div class="story-avatar" style="--a:${c.a};--b:${c.b}">${esc(c.initials)}</div></div><b>${esc(c.name.split(' ')[0])}</b><small>${c.price?`$${Number(c.price).toFixed(2)}`:'Free'}</small></div>`).join('');
  };

  renderTrending = function(){
    $('#trendingList').innerHTML=creators.slice(2,6).map(c=>`<div class="trend-item">${avatarHTML(c,'small')}<div class="meta"><b data-creator="${esc(c.id)}" class="creator-link">${esc(c.name)}</b><small>${esc(c.handle)}</small></div><button data-creator="${esc(c.id)}" class="view-creator">View</button></div>`).join('');
  };

  renderCreatorGrid = function(list=creators){
    $('#creatorGrid').innerHTML=list.map(c=>`<article class="creator-card" data-creator="${esc(c.id)}"><div class="creator-cover" style="--a:${c.a};--b:${c.b}"></div><div class="creator-card-body">${avatarHTML(c)}<h3>${esc(c.name)} <span class="verified">◆</span></h3><div class="handle">${esc(c.handle)}</div><p>${esc(c.bio)}</p><div class="creator-card-foot"><b>${c.price?`$${Number(c.price).toFixed(2)}/mo`:'Free'}</b><span>${esc(c.subs)} fans</span></div></div></article>`).join('') || '<p class="muted">No creators match your filters.</p>';
  };

  renderFeed = function(){
    $('#feed').innerHTML=posts.map((p,i)=>{
      const c=getCreator(p.creator); if(!c)return '';
      const saved=bookmarkedPostIds.has(p.id);
      const lockLabel=p.visibility==='subscribers'?'Subscriber-only content':'Private PPV Drop';
      const lockButton=p.visibility==='ppv'?`<button class="btn primary unlock-btn" data-price="${Number(p.price||0)}">Unlock for $${Number(p.price||0).toFixed(2)}</button>`:'<button class="btn outline subscribe-from-post">View creator plans</button>';
      return `<article class="post-card" data-post-id="${esc(p.id||`p${i+1}`)}" data-creator-id="${esc(c.id)}"><div class="post-head">${avatarHTML(c)}<div class="meta"><b class="creator-link" data-creator="${esc(c.id)}">${esc(c.name)} <span class="verified">◆</span></b><small>${esc(c.handle)} · ${i+1}h</small></div><button class="menu-dot post-menu" aria-label="Post options">•••</button></div><div class="post-copy">${esc(p.text)}</div>${p.locked?`<div class="post-media locked" style="--a:${p.a};--b:${p.b}"><div class="lock-card"><div class="lock-icon">⌾</div><b>${lockLabel}</b><p>${p.visibility==='subscribers'?'Subscribe to view this media.':'Unlock this post after secure checkout is enabled.'}</p>${lockButton}</div></div>`:`<div class="post-media" style="--a:${p.a};--b:${p.b}">${mediaHTML(p)}</div>`}<div class="post-actions"><button class="like-btn">♡ ${Number(p.likes||0).toLocaleString()}</button><button class="comment-btn">◌ ${Number(p.comments||0)}</button><button class="bookmark-btn" aria-label="Bookmark">${saved?'▰':'▱'}</button><button class="tip">Tip</button></div></article>`;
    }).join('');
  };

  renderBookmarks = function(){
    const saved=posts.filter(p=>bookmarkedPostIds.has(p.id));
    $('#bookmarkGrid').innerHTML=saved.length?saved.map(p=>`<div class="bookmark" data-post-id="${esc(p.id)}" style="--a:${p.a};--b:${p.b}" title="${esc(p.text||'Saved post')}"></div>`).join(''):'<p class="muted">Save posts with the bookmark button and they will appear here.</p>';
  };

  renderChart = function(){
    const vals=new Array(30).fill(0);
    $('#earningsChart').innerHTML=vals.map(()=>`<div class="bar" style="height:2%" data-value="$0"></div>`).join('');
  };

  renderCreatorProfile = function(id){
    const c=getCreator(id)||creators[0];
    $('#creatorProfileMount').innerHTML=`<div data-creator-id="${esc(c.id)}"><div class="creator-profile-cover" style="--a:${c.a};--b:${c.b}"></div><div class="creator-profile-head">${avatarHTML(c)}<div class="creator-meta"><h1>${esc(c.name)} <span class="verified">◆</span></h1><p>${esc(c.handle)}</p><div class="creator-stats"><span><b>${esc(c.subs)}</b> subscribers</span><span><b>${esc(c.likes)}</b> likes</span></div></div><div class="profile-actions"><button class="btn ghost creator-tip">Tip</button><button class="btn ghost creator-message">✉ Message</button><button class="btn ghost creator-report">Report</button></div></div><div class="creator-profile-body"><div><div class="creator-about glass-soft"><div class="profile-tabs"><button class="active">Posts</button><button>Media</button><button>About</button></div><p>${esc(c.bio)}</p></div><div class="feed" style="margin-top:16px">${posts.filter(p=>p.creator===c.id).map(p=>`<article class="post-card" data-post-id="${esc(p.id)}" data-creator-id="${esc(c.id)}"><div class="post-copy" style="padding-top:16px">${esc(p.text)}</div>${p.locked?`<div class="post-media locked" style="--a:${p.a};--b:${p.b}"><div class="lock-card"><div class="lock-icon">⌾</div><b>${p.visibility==='subscribers'?'Subscriber-only content':'Private PPV Drop'}</b><p>Secure access is required to view this media.</p></div></div>`:`<div class="post-media" style="--a:${p.a};--b:${p.b}">${mediaHTML(p)}</div>`}</article>`).join('')||`<div class="post-card"><div class="post-copy">No public posts from ${esc(c.name)} yet.</div></div>`}</div></div><aside class="subscription-card"><span class="eyebrow">SUBSCRIBE</span><h3>Join ${esc(c.name.split(' ')[0])}’s private feed</h3><div class="price">${c.price?`$${Number(c.price).toFixed(2)}`:'FREE'} <small>${c.price?'/ month':''}</small></div><p class="muted">Full feed access, private updates and subscriber-only drops.</p><button class="btn primary wide subscribe-btn">${c.price?'Subscribe now':'Follow free'}</button><small class="muted">${c.price?'Secure checkout activates after the approved payment processor is connected.':'Free follows are available.'}</small></aside></div></div>`;
  };

  setView = function(name){
    $$('.view').forEach(v=>v.classList.remove('active-view'));
    const v=$(`#view-${name}`);
    if(v){v.classList.add('active-view');window.scrollTo({top:0,behavior:'smooth'})}
    $$('.nav-item,.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    if(name==='studio'){renderChart();refreshStudio();}
  };

  document.addEventListener('click',async e=>{
    const tip=e.target.closest('.tip,.creator-tip');
    if(tip){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      const card=tip.closest('[data-creator-id],.post-card')||$('#creatorProfileMount [data-creator-id]');
      const cid=card?.dataset.creatorId||'creator';
      const amount=Number(prompt('Tip amount in USD','10'));
      if(Number.isFinite(amount)&&amount>0) await transact('tip',cid,amount);
      return;
    }
    const bm=e.target.closest('.bookmark-btn');
    if(bm){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      const post=bm.closest('[data-post-id]'); if(!post)return;
      const id=post.dataset.postId; let saved;
      if(isUuid(id)){
        try{ const d=await api(`/api/posts/${id}/bookmark`,{method:'POST',body:'{}'}); saved=d.bookmarked; }
        catch(err){toast(err.message);return}
      }else saved=!bookmarkedPostIds.has(id);
      saved?bookmarkedPostIds.add(id):bookmarkedPostIds.delete(id);
      localStorage.setItem('sb_local_bookmarks',JSON.stringify([...bookmarkedPostIds]));
      renderFeed(); renderBookmarks(); toast(saved?'Saved to bookmarks':'Removed from bookmarks');
      return;
    }
    const report=e.target.closest('.creator-report,.post-menu');
    if(report){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      const wrap=report.closest('[data-creator-id],.post-card');
      const reason=prompt('Report reason (for example: impersonation, harassment, non-consensual content)');
      if(!reason)return;
      try{
        await api('/api/reports',{method:'POST',body:JSON.stringify({reason,reportedUserId:wrap?.dataset.creatorId,postId:wrap?.dataset.postId,details:`Reported from ${location.hostname}`})});
        toast('Report submitted for moderation');
      }catch(err){toast(err.message)}
      return;
    }
    const plan=e.target.closest('.subscribe-from-post');
    if(plan){
      e.stopImmediatePropagation();
      const cid=plan.closest('[data-creator-id]')?.dataset.creatorId;
      if(cid) openCreator(cid);
      return;
    }
    const edit=e.target.closest('#editProfileBtn');
    if(edit){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      const name=prompt('Display name',currentUser.name)||currentUser.name;
      const username=prompt('Username',String(currentUser.handle||'').replace(/^@/,''))||String(currentUser.handle||'').replace(/^@/,'');
      const bio=prompt('Short bio','')??'';
      try{
        const d=await api('/api/profile',{method:'PATCH',body:JSON.stringify({name,username,bio})});
        currentUser=d.user; updateAuthUI(); toast('Profile updated');
      }catch(err){toast(err.message)}
      return;
    }
    const ver=e.target.closest('#verificationBtn');
    if(ver){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      if(currentUser.role!=='creator'){toast('Create a creator account to request verification');return}
      try{
        const d=await api('/api/verification',{method:'POST',body:'{}'});
        toast(d.alreadyPending?'Verification is already pending':'Verification request submitted. External identity review is still required.');
        currentUser=await getUserProfile((await sbClient.auth.getUser()).data.user); updateAuthUI();
      }catch(err){toast(err.message)}
      return;
    }
    if(e.target.closest('.payout-action,.payment-method-action,.feature-pending-action')){
      e.stopImmediatePropagation();
      toast('This feature activates after the approved payment processor and creator KYC are connected.');
      return;
    }
    if(e.target.closest('#chooseMediaBtn')){
      e.stopImmediatePropagation();
      if(!await requireAuth())return;
      $('#mediaInput').click();
      return;
    }
    if(e.target.closest('.creator-message')){
      e.stopImmediatePropagation();
      setView('messages');
      toast('Choose a creator conversation to send a message.');
      return;
    }
  },true);

  document.addEventListener('click',async e=>{
    if(!e.target.closest('#publishBtn'))return;
    e.preventDefault();e.stopImmediatePropagation();
    const text=$('#postText').value.trim();
    if(!text&&!pendingMedia.length){toast('Add a caption or media before publishing');return}
    if(!await requireAuth())return;
    if(currentUser.role!=='creator'){toast('Create a creator account before publishing');return}
    const vis=$('#visibilitySelect').value==='Everyone'?'everyone':$('#visibilitySelect').value==='Pay-per-view'?'ppv':'subscribers';
    try{
      const d=await api('/api/posts',{method:'POST',body:JSON.stringify({text,visibility:vis,price:$('#ppvPrice').value})});
      let uploaded=0;
      for(const file of pendingMedia){
        try{await uploadMediaForPost(file,d.post);uploaded++}
        catch(err){console.warn(err.message);toast(`Post saved, but one upload failed: ${err.message}`)}
      }
      $('#postText').value=''; pendingMedia=[]; $('#mediaInput').value='';
      if($('#mediaSelection')) $('#mediaSelection').textContent='No media selected';
      toast(uploaded?`Post published with ${uploaded} media file${uploaded===1?'':'s'}`:'Post published');
      const p=await api('/api/posts').catch(()=>null);
      if(p?.posts){posts.splice(0,posts.length,...p.posts.filter(x=>getCreator(x.creator)));renderFeed()}
      refreshStudio();
    }catch(err){toast(err.message)}
  },true);

  document.addEventListener('submit',async e=>{
    if(e.target.id!=='signupForm')return;
    e.preventDefault();e.stopImmediatePropagation();
    $('#authError').textContent='';
    try{
      const d=await api('/api/signup',{method:'POST',body:JSON.stringify({
        name:$('#signupName').value,email:$('#signupEmail').value,password:$('#signupPassword').value,
        role:$('#signupRole').value,adultAttested:$('#signup18').checked
      })});
      currentUser=d.user;updateAuthUI();
      if(d.confirmationRequired){
        $('#authError').textContent='Account created. Check your email to confirm, then sign in.';
        toast('Confirmation email sent');
      }else{closeAuth();toast('Account created successfully')}
    }catch(err){$('#authError').textContent=err.message}
  },true);

  $('#forgotPassword')?.addEventListener('click',async()=>{
    const email=$('#loginEmail').value.trim();
    try{await api('/api/reset-password',{method:'POST',body:JSON.stringify({email})});$('#authError').textContent='Password reset email sent.'}
    catch(err){$('#authError').textContent=err.message}
  });

  $('#mediaInput')?.addEventListener('change',e=>{
    pendingMedia=[...e.target.files].slice(0,10);
    if($('#mediaSelection')) $('#mediaSelection').textContent=pendingMedia.length?`${pendingMedia.length} file${pendingMedia.length===1?'':'s'} selected`:'No media selected';
  });

  renderStories();renderTrending();renderCreatorGrid();renderFeed();renderBookmarks();renderChart();
  loadSession();
})();
