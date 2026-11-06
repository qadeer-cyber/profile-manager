import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {chromium} from 'playwright';

export function windowsEmployeeIdentity(installation,executable) {
  if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Disposable Windows CI required');
  const username='AzwahQA'+crypto.randomBytes(5).toString('hex');
  const password=crypto.randomBytes(24).toString('base64url')+'Az9!';
  const port=49321;
  const env={...process.env,AZWAH_QA_USER:username,AZWAH_QA_PASSWORD:password,AZWAH_QA_INSTALL:installation,AZWAH_QA_EXE:executable};
  delete env.PM_USER_DATA;
  const ps=script=>execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{env,encoding:'utf8',timeout:60000}).trim();
  ps(`
    $secure=ConvertTo-SecureString $env:AZWAH_QA_PASSWORD -AsPlainText -Force
    New-LocalUser -Name $env:AZWAH_QA_USER -Password $secure | Out-Null
    $sid=(Get-LocalUser -Name $env:AZWAH_QA_USER).SID
    if(-not (Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object SID -eq $sid)){
      Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $env:AZWAH_QA_USER
    }
    icacls.exe $env:AZWAH_QA_INSTALL /grant ($env:AZWAH_QA_USER + ':(OI)(CI)RX') /T /Q | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not grant read and execute access to employee app'}
  `);
  let pid,browser,page;
  return {
    async launch(){
      pid=Number(ps(`
        $secure=ConvertTo-SecureString $env:AZWAH_QA_PASSWORD -AsPlainText -Force
        $credential=[PSCredential]::new(".\\"+$env:AZWAH_QA_USER,$secure)
        $process=Start-Process -FilePath $env:AZWAH_QA_EXE -ArgumentList '--remote-debugging-port=${port}','--remote-debugging-address=127.0.0.1' -Credential $credential -LoadUserProfile -WorkingDirectory $env:AZWAH_QA_INSTALL -PassThru
        $owner=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" | Invoke-CimMethod -MethodName GetOwner
        if($owner.User -ne $env:AZWAH_QA_USER){throw 'Office did not launch as separate employee identity'}
        $process.Id
      `));
      if(!Number.isInteger(pid)||pid<=0)throw Error('Employee process did not start');
      const deadline=Date.now()+60000;
      for(;;){
        const ready=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)}).then(r=>r.ok,()=>false);
        if(ready)break;
        if(Date.now()>=deadline)throw Error('Separate employee Electron renderer did not become ready');
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:60000});
      const context=browser.contexts()[0];
      page=context.pages()[0]||await context.waitForEvent('page',{timeout:60000});
      await page.waitForFunction(()=>!!window.pm?.uiToken,undefined,{timeout:60000});
      return page;
    },
    async close(){
      if(!pid)return;
      await page?.close().catch(()=>{});
      await browser?.close().catch(()=>{});
      ps(`if(Get-Process -Id ${pid} -ErrorAction SilentlyContinue){Wait-Process -Id ${pid} -Timeout 30}`);
      pid=undefined;
    },
    async dispose(){
      await this.close().catch(()=>{
        if(pid)ps(`Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`);
      });
      ps('Remove-LocalUser -Name $env:AZWAH_QA_USER');
    }
  };
}
