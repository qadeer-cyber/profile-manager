import {execFileSync,spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';

export function windowsEmployeeIdentity(installation,executable) {
  if(process.platform!=='win32'||process.env.CI!=='true')throw Error('Disposable Windows CI required');
  const username='AzwahQA'+crypto.randomBytes(5).toString('hex');
  const password=crypto.randomBytes(24).toString('base64url')+'Az9!';
  const port=49321;
  const data=fs.mkdtempSync(path.join(process.env.PUBLIC,'azwah-employee-'));
  const stderr=path.join(data,'startup-stderr.log');
  const stdout=path.join(data,'startup-stdout.log');
  const env={...process.env,AZWAH_QA_USER:username,AZWAH_QA_PASSWORD:password,AZWAH_QA_INSTALL:installation,AZWAH_QA_EXE:executable,AZWAH_QA_DATA:data,AZWAH_QA_STDERR:stderr,AZWAH_QA_STDOUT:stdout};
  delete env.PM_USER_DATA;
  const ps=script=>execFileSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{env,encoding:'utf8',timeout:60000}).trim();
  ps(`
    $secure=ConvertTo-SecureString $env:AZWAH_QA_PASSWORD -AsPlainText -Force
    New-LocalUser -Name $env:AZWAH_QA_USER -Password $secure | Out-Null
    $sid=(Get-LocalUser -Name $env:AZWAH_QA_USER).SID
    if(-not (Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object SID -eq $sid)){
      Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $env:AZWAH_QA_USER
    }
    icacls.exe $env:AZWAH_QA_DATA /inheritance:r /grant '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' ($env:AZWAH_QA_USER + ':(OI)(CI)M') /Q | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not configure isolated employee data permissions'}
  `);
  const diagnostic=fs.mkdtempSync(path.join(os.tmpdir(),'azwah-launch-'));
  env.AZWAH_QA_REPORT=path.join(diagnostic,'process.json');
  let pid,browser,page,launcher;
  const report=()=>{
    try{return JSON.parse(fs.readFileSync(env.AZWAH_QA_REPORT,'utf8'));}
    catch{return null;}
  };
  const details=()=>{
    const evidence={process:report(),cdpReady:false,mainLogPresent:false,backendStarted:false};
    const log=path.join(data,'app','logs','main.log');
    if(fs.existsSync(log)){
      const content=fs.readFileSync(log,'utf8');
      evidence.mainLogPresent=true;
      evidence.backendStarted=content.includes('backend on http://127.0.0.1:');
      evidence.backendFailed=content.includes('backend start failed');
    }
    evidence.applicationEvents=ps(`
      Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1001; StartTime=(Get-Date).AddMinutes(-5)} -ErrorAction SilentlyContinue |
        Where-Object {$_.Message -match 'Azwah Multi Browser Office|notepad.exe'} |
        Select-Object -First 8 Id,ProviderName,TimeCreated |
        ConvertTo-Json -Compress
    `);
    console.log('WINDOWS_STARTUP_DIAGNOSTIC '+JSON.stringify(evidence));
  };
  return {
    async launch(){
      fs.rmSync(env.AZWAH_QA_REPORT,{force:true});
      launcher=spawn('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`
        $ErrorActionPreference='Stop'
        $secure=ConvertTo-SecureString $env:AZWAH_QA_PASSWORD -AsPlainText -Force
        Remove-Item Env:AZWAH_QA_PASSWORD
        $credential=[PSCredential]::new(".\\"+$env:AZWAH_QA_USER,$secure)
        $childEnv=@{PM_USER_DATA=(Join-Path $env:AZWAH_QA_DATA 'app'); TEMP=$env:AZWAH_QA_DATA; TMP=$env:AZWAH_QA_DATA; ELECTRON_ENABLE_LOGGING='1'}
        $result=[ordered]@{launcherPid=$PID; launcherSession=(Get-Process -Id $PID).SessionId; executable=$env:AZWAH_QA_EXE; workingDirectory=$env:AZWAH_QA_INSTALL; dataDirectory=$env:AZWAH_QA_DATA; dataAcl=(Get-Acl -LiteralPath $env:AZWAH_QA_DATA).Sddl}
        function Save-Report { $result | ConvertTo-Json -Compress | Set-Content -LiteralPath $env:AZWAH_QA_REPORT }
        Save-Report
        try {
          if($env:AZWAH_QA_STARTUP_ONLY -eq '1'){
            $control=Start-Process -FilePath "$env:SystemRoot\\System32\\notepad.exe" -Credential $credential -LoadUserProfile -WorkingDirectory $env:AZWAH_QA_INSTALL -PassThru
            $result.controlPid=$control.Id
            $result.controlSession=$control.SessionId
            $result.controlExited=$control.WaitForExit(3000)
            if($result.controlExited){$result.controlExit=('0x{0:X8}' -f $control.ExitCode)}
            else {
              $control.Refresh()
              $result.controlWindow=($control.MainWindowHandle -ne 0)
              $control.Kill()
            }
            Save-Report
          }
          $process=Start-Process -FilePath $env:AZWAH_QA_EXE -Environment $childEnv -ArgumentList '--remote-debugging-port=${port}','--remote-debugging-address=127.0.0.1' -Credential $credential -LoadUserProfile -WorkingDirectory $env:AZWAH_QA_INSTALL -PassThru
          $result.childPid=$process.Id
          $sid=(Get-LocalUser -Name $env:AZWAH_QA_USER).SID.Value
          $result.profileHiveLoaded=Test-Path "Registry::HKEY_USERS\\$sid"
          $result.profilePath=(Get-CimInstance Win32_UserProfile -Filter "SID='$sid'").LocalPath
          if(-not $process.HasExited){
            $result.childSession=$process.SessionId
            $result.owner=(Get-Process -Id $process.Id -IncludeUserName -ErrorAction SilentlyContinue).UserName
          }
          Save-Report
          $process.WaitForExit()
          $result.exitCode=('0x{0:X8}' -f $process.ExitCode)
        } catch {
          $result.launchErrorType=$_.Exception.GetType().FullName
          $result.nativeError=$_.Exception.NativeErrorCode
        } finally { Save-Report }
      `],{env,stdio:'ignore',windowsHide:true});
      const deadline=Date.now()+90000;
      for(;;){
        const snapshot=report();
        if(snapshot?.childPid)pid=snapshot.childPid;
        const ready=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)}).then(r=>r.ok,()=>false);
        if(ready&&pid)break;
        if(Date.now()>=deadline||launcher.exitCode!==null){
          details();
          throw Error('Separate employee Electron did not become ready; see WINDOWS_STARTUP_DIAGNOSTIC');
        }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      const owner=ps(`(Get-Process -Id ${pid} -IncludeUserName).UserName`);
      if(owner.split('\\').at(-1)?.toLowerCase()!==username.toLowerCase())throw Error('Office did not launch as the separate employee account');
      browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:60000});
      const context=browser.contexts()[0];
      page=context.pages()[0]||await context.waitForEvent('page',{timeout:60000});
      await page.waitForFunction(()=>!!window.pm?.uiToken,undefined,{timeout:60000});
      console.log('WINDOWS_STARTUP_DIAGNOSTIC '+JSON.stringify({process:report(),cdpReady:true,rendererReady:true}));
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
      fs.rmSync(diagnostic,{recursive:true,force:true});
      fs.rmSync(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    }
  };
}
