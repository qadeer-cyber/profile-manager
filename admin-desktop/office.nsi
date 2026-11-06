Unicode true
Name "Azwah Multi Browser Office"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Azwah Multi Browser Office"
RequestExecutionLevel user
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Azwah Multi Browser Office"
VIAddVersionKey "FileDescription" "Azwah Multi Browser Office Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  StrCpy $0 "$PLUGINSDIR\office-trust.json"
  File /oname=office-trust.json "${TRUST}"
  IfFileExists "$INSTDIR\resources\office-trust.json" compare
  IfFileExists "$INSTDIR\*.*" conflict install
compare:
  FileOpen $1 "$INSTDIR\resources\office-trust.json" r
  FileOpen $2 "$0" r
  FileRead $1 $3
  FileRead $2 $4
  FileClose $1
  FileClose $2
  StrCmpS $3 $4 install
conflict:
  Delete "$0"
  SetErrorLevel 2
  Abort "An Office installation for a different organization already exists."
install:
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  SetOutPath "$INSTDIR\resources"
  ClearErrors
  CopyFiles /SILENT "$0" "$INSTDIR\resources\office-trust.json"
  IfErrors 0 copied
  SetErrorLevel 3
  Abort "Could not install organization trust."
copied:
  Delete "$0"
  WriteUninstaller "$INSTDIR\Uninstall Azwah Multi Browser Office.exe"
  CreateShortcut "$DESKTOP\Azwah Multi Browser Office.lnk" "$INSTDIR\Azwah Multi Browser Office.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AzwahOffice" "DisplayName" "Azwah Multi Browser Office"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AzwahOffice" "UninstallString" '"$INSTDIR\Uninstall Azwah Multi Browser Office.exe"'
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\Azwah Multi Browser Office.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AzwahOffice"
  RMDir /r "$INSTDIR"
SectionEnd
