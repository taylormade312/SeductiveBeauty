(function(){
  const safe=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  window.addEventListener('click',async e=>{
    const button=e.target.closest('.creator-message');
    if(!button)return;
    e.preventDefault();e.stopPropagation();
    if(!await requireAuth())return;
    const id=$('#creatorProfileMount [data-creator-id]')?.dataset.creatorId;
    if(!isUuid(id)){toast('Messaging is available on live creator accounts.');return;}
    const c=getCreator(id);if(!c)return;
    setView('messages');
    setTimeout(()=>{
      const list=$('#inboxList');
      if(list&&!list.querySelector(`[data-chat="${CSS.escape(id)}"]`)){
        list.insertAdjacentHTML('afterbegin',`<div class="inbox-item active" data-chat="${safe(id)}"><div class="avatar small" style="background:linear-gradient(135deg,${c.a},${c.b})">${safe(c.initials)}</div><div class="meta"><b>${safe(c.name)}</b><p>Start a new conversation</p><time>now</time></div></div>`);
      }
      $$('.inbox-item').forEach(x=>x.classList.toggle('active',x.dataset.chat===id));
      $('#conversationPane').innerHTML=`<div class="conversation-header"><div class="avatar" style="background:linear-gradient(135deg,${c.a},${c.b})">${safe(c.initials)}</div><div class="meta"><b>${safe(c.name)}</b><small class="muted">New private conversation</small></div></div><div class="conversation-body"><p class="muted">Send the first message to begin this conversation.</p></div><div class="conversation-compose"><button>＋</button><input placeholder="Message ${safe(c.name.split(' ')[0])}..."/><button class="send-message">Send</button></div>`;
    },120);
  },true);
})();
