const main=document.querySelector('#main');
const status=document.querySelector('#status');
const call=(action,input)=>window.admin.call(action,input);
const text=(tag,value,parent=main)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
function button(parent,label,run){
  const el=text('button',label,parent);
  el.onclick=async()=>{el.disabled=true;status.textContent='';try{await run();}catch(e){status.textContent=e.message;}finally{el.disabled=false;}};
}
function form(title,fields,action,submit,parent=main){
  const box=document.createElement('section');parent.append(box);text('h2',title,box);
  const inputs={};
  for(const [name,label,type,value] of fields){
    const row=text('label',label,box);const input=document.createElement('input');
    input.type=type||'text';input.value=value||'';row.append(input);inputs[name]=input;
  }
  button(box,submit,async()=>{
    const values=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]));
    try{await action(values);}finally{for(const input of Object.values(inputs))if(input.type==='password')input.value='';}
  });
}
async function render(){
  main.replaceChildren();
  const state=await call('status');
  text('h1',state.exists?'Azwah License Admin':'Welcome to Azwah License Admin');
  if(!state.exists){
    form('Create organization',[['organization','Organization'],['password','Master password (14 characters minimum)','password'],['confirm','Confirm password','password']],async v=>{await call('setup',v);await render();},'Create identity and choose backup');
    form('Restore organization',[['password','Backup password','password']],async v=>{await call('restore',v);await render();},'Choose encrypted backup');
    return;
  }
  if(!state.unlocked){form('Unlock vault',[['password','Master password','password']],async v=>{await call('unlock',v);await render();},'Unlock');return;}
  const data=await call('list'),now=Date.now();
  const nav=document.createElement('nav');main.append(nav);
  const area=document.createElement('div');main.append(area);
  const show=(name,build)=>button(nav,name,()=>{area.replaceChildren();build();});
  const dashboard=()=>{
    text('h2',data.organization,area);
    text('p',`Issued: ${data.records.length} · Valid: ${data.records.filter(r=>r.expiresAt>now).length} · Expired: ${data.records.filter(r=>r.expiresAt<=now).length} · Expiring in 7 days: ${data.records.filter(r=>r.expiresAt>now&&r.expiresAt-now<604800000).length} · Devices: ${new Set(data.employees.map(e=>e.device)).size}`,area);
    for(const item of data.audit.slice(-8).reverse())text('p',new Date(item.at).toLocaleString()+' '+item.action,area);
  };
  const issue=(licenseId='')=>form(licenseId?'Reissue License':'Generate Activation Key',[['reference','Employee reference'],['days','Validity in days (7, 30, 90, 180, 365 or custom)','number','30'],...(licenseId?[]:[['licenseId','Previous license ID for reissue (optional)']])],async v=>{const result=await call('issue',{...v,licenseId:licenseId||v.licenseId});await render();status.textContent='Issued '+result.license.id+' · Expires '+new Date(result.license.expiresAt).toLocaleString();},'Generate License',area);
  const list=(filter=()=>true)=>{for(const r of data.records.filter(filter).reverse()){
    const row=document.createElement('article');area.append(row);
    text('p',`${r.label} · ${r.id} · Issued ${new Date(r.issuedAt).toLocaleString()} · Expires ${new Date(r.expiresAt).toLocaleString()} · ${r.device}${r.replacedBy?' · Replaced by '+r.replacedBy:''}`,row);
    button(row,'Copy Activation Key',()=>call('copy',{id:r.id}));
    button(row,'Save License File',()=>call('export',{id:r.id}));
    button(row,'Reissue',()=>{area.replaceChildren();issue(r.id);});
  }};
  show('Dashboard',dashboard);
  show('Employees',()=>{
    const search=document.createElement('input');search.placeholder='Search employees';area.append(search);
    const results=document.createElement('div');area.append(results);
    const update=()=>{results.replaceChildren();for(const e of data.employees.filter(e=>(e.name+' '+e.reference+' '+e.device).toLowerCase().includes(search.value.toLowerCase())))text('p',e.reference+' · '+e.name+' · '+e.device,results);};search.oninput=update;update();
    form('Add or edit employee',[['reference','Employee reference'],['name','Name'],['device','Device code'],['notes','Internal notes']],async v=>{await call('employee',v);await render();},'Save employee',area);
  });
  show('Generate License',()=>issue());
  show('Active Licenses',()=>list(r=>r.expiresAt>now));
  show('Expired Licenses',()=>list(r=>r.expiresAt<=now));
  show('Reissue License',()=>issue());
  show('License History',()=>list());
  show('Office Installer',()=>form('Prepare Office Installer for '+data.organization,[['version','Installer version','text','1.0.0']],async v=>{const file=await call('installer',v);if(file)status.textContent='Created '+file;},'Generate Office Installer',area));
  show('Backup & Restore',()=>button(area,'Save encrypted backup',()=>call('backup')));
  show('Settings',()=>text('p','Offline licenses remain usable until expiry. Reissue does not remotely revoke a license.',area));
  button(nav,'Lock Admin Session',async()=>{await call('lock');await render();});
  dashboard();
}
render().catch(e=>{status.textContent=e.message;});
