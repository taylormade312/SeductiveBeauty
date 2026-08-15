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

(function(){
  const originalApi=api;
  const LEGAL_CACHE={docs:null};
  const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function activeLegalDocs(){
    if(LEGAL_CACHE.docs)return LEGAL_CACHE.docs;
    const {data,error}=await sbClient.from('legal_document_versions')
      .select('id,slug,version,title,body_markdown,effective_at,requires_creator_signature')
      .eq('is_active',true).order('slug');
    if(error)throw new Error(error.message);
    LEGAL_CACHE.docs=data||[];
    return LEGAL_CACHE.docs;
  }
  async function activeDoc(slug){return (await activeLegalDocs()).find(d=>d.slug===slug)||null;}

  async function ensureDocumentAcceptance(userId,doc){
    if(!userId||!doc)return;
    const {data:existing}=await sbClient.from('document_acceptances').select('id').eq('user_id',userId).eq('document_id',doc.id).maybeSingle();
    if(!existing){
      const {error}=await sbClient.from('document_acceptances').insert({user_id:userId,document_id:doc.id,acceptance_context:'web_signup',metadata:{domain:location.hostname}});
      if(error)throw new Error(error.message);
    }
  }

  async function hasCreatorSignature(userId){
    const doc=await activeDoc('creator-platform-agreement');
    if(!doc)return false;
    const {data,error}=await sbClient.from('creator_contract_signatures').select('id').eq('creator_id',userId).eq('document_id',doc.id).is('voided_at',null).maybeSingle();
    if(error)throw new Error(error.message);
    return !!data;
  }

  async function signCreatorAgreement(legalName,typedSignature,context='signup'){
    const {data:{user}}=await sbClient.auth.getUser();
    if(!user)throw new Error('Confirm your email and sign in before the creator agreement can be finalized.');
    legalName=String(legalName||'').trim();typedSignature=String(typedSignature||'').trim();
    if(legalName.length<2||typedSignature.length<2)throw new Error('Enter your legal name and typed signature.');
    const creatorDoc=await activeDoc('creator-platform-agreement');
    const policyDoc=await activeDoc('platform-policies');
    if(!creatorDoc)throw new Error('Creator agreement is temporarily unavailable.');
    const {data:cp}=await sbClient.from('creator_profiles').select('user_id').eq('user_id',user.id).maybeSingle();
    if(!cp){const {error}=await sbClient.from('creator_profiles').insert({user_id:user.id});if(error)throw new Error(error.message);}
    const already=await hasCreatorSignature(user.id);
    if(!already){
      const {error}=await sbClient.from('creator_contract_signatures').insert({creator_id:user.id,document_id:creatorDoc.id,legal_name:legalName,typed_signature:typedSignature,agreed_to_electronic_signature:true,metadata:{context,domain:location.hostname}});
      if(error)throw new Error(error.message);
    }
    await ensureDocumentAcceptance(user.id,creatorDoc);
    if(policyDoc)await ensureDocumentAcceptance(user.id,policyDoc);
    localStorage.removeItem('sb_pending_creator_signature');
    return {ok:true,version:creatorDoc.version};
  }

  async function ensurePolicyAcceptance(){
    const {data:{user}}=await sbClient.auth.getUser(); if(!user)return;
    const doc=await activeDoc('platform-policies');
    if(doc&&user.user_metadata?.adult_attested)await ensureDocumentAcceptance(user.id,doc).catch(()=>{});
  }

  function pendingCreatorSignature(){
    try{return JSON.parse(localStorage.getItem('sb_pending_creator_signature')||'null')}catch{return null}
  }

  async function syncCreatorAgreement(userView){
    if(!userView||userView.role!=='creator')return;
    const {data:{user}}=await sbClient.auth.getUser(); if(!user)return;
    if(await hasCreatorSignature(user.id))return;
    const pending=pendingCreatorSignature();
    if(pending&&String(pending.email||'').toLowerCase()===String(user.email||'').toLowerCase()){
      try{await signCreatorAgreement(pending.legalName,pending.typedSignature,'email_confirmed_signup');toast('Creator Agreement signed and saved');return;}catch(e){console.warn(e.message)}
    }
    setTimeout(()=>openCreatorAgreementModal(true),250);
  }

  api=async function(path,options={}){
    const method=(options.method||'GET').toUpperCase();
    if(path==='/api/legal-documents'&&method==='GET')return {documents:await activeLegalDocs()};
    if(path==='/api/creator-agreement-status'&&method==='GET'){
      const {data:{user}}=await sbClient.auth.getUser();return {signed:user?await hasCreatorSignature(user.id):false};
    }
    if(path==='/api/creator-signature'&&method==='POST'){
      const payload=options.body?JSON.parse(options.body):{};return signCreatorAgreement(payload.legalName,payload.typedSignature,'account');
    }
    if(path==='/api/signup'&&method==='POST'){
      const payload=options.body?JSON.parse(options.body):{};
      let creatorLegal=null;
      if(payload.role==='creator'){
        creatorLegal={
          legalName:document.querySelector('#creatorLegalName')?.value?.trim()||'',
          typedSignature:document.querySelector('#creatorTypedSignature')?.value?.trim()||'',
          accepted:!!document.querySelector('#creatorAgreementAccept')?.checked,
          email:String(payload.email||'').trim()
        };
        if(!creatorLegal.accepted||creatorLegal.legalName.length<2||creatorLegal.typedSignature.length<2)throw new Error('Creators must read and electronically sign the Creator Platform Agreement.');
      }
      const result=await originalApi(path,options);
      if(result.user){
        await ensurePolicyAcceptance().catch(()=>{});
        if(creatorLegal)await signCreatorAgreement(creatorLegal.legalName,creatorLegal.typedSignature,'signup');
      }else if(creatorLegal){
        localStorage.setItem('sb_pending_creator_signature',JSON.stringify({...creatorLegal,savedAt:new Date().toISOString()}));
      }
      return result;
    }
    if((path==='/api/login'&&method==='POST')||(path==='/api/session'&&method==='GET')){
      const result=await originalApi(path,options);
      if(result?.user){await ensurePolicyAcceptance().catch(()=>{});await syncCreatorAgreement(result.user).catch(e=>console.warn(e.message));}
      return result;
    }
    return originalApi(path,options);
  };

  function ensureModal(){
    if(document.querySelector('#legalDocModal'))return document.querySelector('#legalDocModal');
    const modal=document.createElement('div');
    modal.id='legalDocModal';modal.className='auth-modal hidden';modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`<div class="auth-dialog glass" style="width:min(900px,94vw);max-height:90vh;overflow:auto"><button class="auth-close" id="legalDocClose" aria-label="Close">×</button><h2 id="legalDocTitle">Legal document</h2><div id="legalDocText" style="white-space:pre-wrap;line-height:1.55;font-size:.92rem;color:#ddd"></div><div id="legalSignatureBox" class="hidden" style="margin-top:20px"><label>Legal name<input id="modalCreatorLegalName" autocomplete="name"></label><label>Typed electronic signature<input id="modalCreatorTypedSignature" autocomplete="name"></label><label class="checkbox-label"><input id="modalCreatorAgreementAccept" type="checkbox"> I have read this Agreement and intend my typed signature to be my electronic signature.</label><button id="modalSignCreatorAgreement" class="btn primary wide" type="button">Sign Creator Agreement</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#legalDocClose').addEventListener('click',()=>{modal.classList.add('hidden');modal.setAttribute('aria-hidden','true')});
    modal.addEventListener('click',e=>{if(e.target===modal){modal.classList.add('hidden');modal.setAttribute('aria-hidden','true')}});
    modal.querySelector('#modalSignCreatorAgreement').addEventListener('click',async()=>{
      if(!modal.querySelector('#modalCreatorAgreementAccept').checked){toast('Confirm your electronic signature consent');return;}
      try{
        await signCreatorAgreement(modal.querySelector('#modalCreatorLegalName').value,modal.querySelector('#modalCreatorTypedSignature').value,'agreement_modal');
        modal.classList.add('hidden');toast('Creator Agreement signed');
        const {data:{user}}=await sbClient.auth.getUser();if(user){currentUser=await getUserProfile(user);updateAuthUI();}
      }catch(e){toast(e.message)}
    });
    return modal;
  }

  async function openDoc(slug,withSignature=false){
    try{
      const doc=await activeDoc(slug);if(!doc){toast('Document unavailable');return;}
      const modal=ensureModal();modal.querySelector('#legalDocTitle').textContent=`${doc.title} · v${doc.version}`;modal.querySelector('#legalDocText').textContent=doc.body_markdown;
      modal.querySelector('#legalSignatureBox').classList.toggle('hidden',!withSignature);
      modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
    }catch(e){toast(e.message)}
  }
  window.openCreatorAgreementModal=(required=false)=>openDoc('creator-platform-agreement',required);

  function injectSignupFields(){
    const role=document.querySelector('#signupRole');if(!role||document.querySelector('#creatorAgreementFields'))return;
    const box=document.createElement('div');box.id='creatorAgreementFields';box.className='hidden';
    box.innerHTML=`<label>Legal name<input id="creatorLegalName" autocomplete="name" placeholder="Your full legal name"></label><label>Typed electronic signature<input id="creatorTypedSignature" autocomplete="name" placeholder="Type your legal name"></label><button id="readCreatorAgreement" class="btn ghost wide" type="button">Read Creator Platform Agreement</button><label class="checkbox-label"><input id="creatorAgreementAccept" type="checkbox"> I agree to the Creator Platform Agreement and Platform Policies and consent to electronic records/signatures.</label>`;
    role.closest('label')?.insertAdjacentElement('afterend',box);
    const toggle=()=>{const on=role.value==='creator';box.classList.toggle('hidden',!on);['#creatorLegalName','#creatorTypedSignature','#creatorAgreementAccept'].forEach(s=>{const el=document.querySelector(s);if(el)el.required=on;});};
    role.addEventListener('change',toggle);toggle();
    box.querySelector('#readCreatorAgreement').addEventListener('click',()=>openDoc('creator-platform-agreement',false));
  }

  async function renderLegalCenter(){
    const grid=document.querySelector('#view-legal .legal-grid');if(!grid)return;
    try{
      const docs=await activeLegalDocs();
      grid.innerHTML=docs.map(d=>`<article class="legal-card glass-soft"><h2>${htmlEscape(d.title)}</h2><p>Version ${htmlEscape(d.version)} · Effective ${new Date(d.effective_at).toLocaleDateString()}</p><button class="btn outline legal-doc-open" data-legal-slug="${htmlEscape(d.slug)}">Read full document</button></article>`).join('')+`<article class="legal-card glass-soft"><h2>Requests & support</h2><p>Privacy, support, copyright, and appeal requests are tracked in the platform backend.</p><button class="btn outline" id="privacyRequestBtn">Privacy request</button> <button class="btn outline" id="supportRequestBtn">Support</button> <button class="btn outline" id="dmcaRequestBtn">Copyright notice</button></article>`;
    }catch(e){console.warn(e.message)}
  }

  async function invokePublicIntake(body){
    const {data,error}=await sbClient.functions.invoke('public-intake',{body});if(error)throw new Error(error.message);return data;
  }

  async function downloadMyData(){
    const {data:{session}}=await sbClient.auth.getSession();if(!session){openAuth('login');return;}
    const res=await fetch(`${SUPABASE_URL}/functions/v1/export-my-data`,{headers:{Authorization:`Bearer ${session.access_token}`}});
    if(!res.ok)throw new Error('Unable to export account data.');
    const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='seductive-beauty-data-export.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }

  function injectDataExportButton(){
    const account=document.querySelector('#view-profile .settings-card');if(!account||document.querySelector('#dataExportBtn'))return;
    const b=document.createElement('button');b.id='dataExportBtn';b.innerHTML='Download my data <span>JSON export ›</span>';account.appendChild(b);
  }

  document.addEventListener('click',async e=>{
    const legal=e.target.closest('.legal-doc-open');if(legal){openDoc(legal.dataset.legalSlug,false);return;}
    if(e.target.closest('#dataExportBtn')){try{await downloadMyData();toast('Data export downloaded')}catch(err){toast(err.message)}return;}
    if(e.target.closest('#privacyRequestBtn')){
      const email=prompt('Email for this privacy request',currentUser?.email||'');if(!email)return;
      const type=prompt('Request type: access, delete, correct, portability, opt_out, or appeal','access');if(!type)return;
      const details=prompt('Details (optional)','')||'';
      try{await invokePublicIntake({type:'privacy',email,request_type:type,details});toast('Privacy request received')}catch(err){toast(err.message)}return;
    }
    if(e.target.closest('#supportRequestBtn')){
      const email=prompt('Your email',currentUser?.email||'');const subject=prompt('Support subject');const message=prompt('How can we help?');if(!email||!subject||!message)return;
      try{await invokePublicIntake({type:'support',email,subject,message,category:'general'});toast('Support ticket created')}catch(err){toast(err.message)}return;
    }
    if(e.target.closest('#dmcaRequestBtn')){
      const claimant_name=prompt('Copyright owner/authorized claimant name');const claimant_email=prompt('Claimant email');const copyrighted_work_description=prompt('Describe the copyrighted work');const infringing_location=prompt('URL or location of the material');const signature=prompt('Type your name as your electronic signature');if(!claimant_name||!claimant_email||!copyrighted_work_description||!infringing_location||!signature)return;
      try{await invokePublicIntake({type:'dmca',claimant_name,claimant_email,copyrighted_work_description,infringing_location,good_faith_statement:true,accuracy_authority_statement:true,signature});toast('Copyright notice received')}catch(err){toast(err.message)}return;
    }
  });

  injectSignupFields();injectDataExportButton();renderLegalCenter();
  sbClient.auth.onAuthStateChange((_event,session)=>{if(session?.user)setTimeout(async()=>{await ensurePolicyAcceptance().catch(()=>{});const view=await getUserProfile(session.user);await syncCreatorAgreement(view).catch(()=>{});},100)});
})();
