; Unsigned installer for the BoomBigNose window.
; The landing page explains SmartScreen (More info, then Run anyway)
; and Smart App Control. This script does not claim those prompts are absent.
; The installer copies the Wails window and, beside it, bundle\ (Node, server.js, Postgres).

Unicode true
; Brandmark from boombignose.org, rendered by packaging/brand/render.py.
Icon "icon.ico"
UninstallIcon "icon.ico"
; The portable tree is large. Leave it uncompressed so the CI pack step
; does not spend the job on LZMA. The installer is therefore large.
SetCompress off
Name "BoomBigNose"
VIProductVersion "1.4.3.0"
VIFileVersion "1.4.3.0"
VIAddVersionKey /LANG=1033 "ProductName" "BoomBigNose"
VIAddVersionKey /LANG=1033 "FileDescription" "BoomBigNose ERP Harness AI"
VIAddVersionKey /LANG=1033 "ProductVersion" "1.4.3"
VIAddVersionKey /LANG=1033 "FileVersion" "1.4.3"
OutFile "BoomBigNose-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\BoomBigNose"
RequestExecutionLevel user
Page directory
Page instfiles

Section "BoomBigNose"
  SetShellVarContext current
  SetOutPath $INSTDIR
  File /oname=BoomBigNose.exe "boombignose-desktop.exe"
  File /oname=icon.ico "icon.ico"
  SetOutPath "$INSTDIR\bundle"
  File /r "bundle\*.*"
  CreateShortcut "$SMPROGRAMS\BoomBigNose.lnk" "$INSTDIR\BoomBigNose.exe" "" "$INSTDIR\icon.ico"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$INSTDIR\BoomBigNose.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\BoomBigNose.lnk"
  RMDir /r "$INSTDIR\bundle"
  RMDir "$INSTDIR"
SectionEnd
