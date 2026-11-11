Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${UnStrStr}
Var UpdateMode
Var AppStopped
Name "DynamicDesktop"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\DynamicDesktop"
InstallDirRegKey HKCU "Software\DynamicDesktop\Installer" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "DynamicDesktop"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "DynamicDesktop"
VIAddVersionKey /LANG=1033 "FileDescription" "DynamicDesktop Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 DynamicDesktop authors"
!define MUI_ABORTWARNING
!define MUI_ICON "${PAYLOAD}\host\bin\DynamicDesktop.ico"
!define MUI_UNICON "${PAYLOAD}\host\bin\DynamicDesktop.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\host\bin\DynamicDesktop.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(LaunchDynamicDesktop)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Dutch"
LangString LaunchDynamicDesktop ${LANG_ENGLISH} "Launch DynamicDesktop"
LangString LaunchDynamicDesktop ${LANG_DUTCH} "DynamicDesktop starten"
LangString AppFiles ${LANG_ENGLISH} "DynamicDesktop themes and application"
LangString AppFiles ${LANG_DUTCH} "DynamicDesktop-thema's en toepassing"
LangString DesktopShortcut ${LANG_ENGLISH} "Desktop shortcut"
LangString DesktopShortcut ${LANG_DUTCH} "Snelkoppeling op het bureaublad"
LangString NeedX64 ${LANG_ENGLISH} "64-bit Windows 10 or later is required."
LangString NeedX64 ${LANG_DUTCH} "64-bits Windows 10 of hoger is vereist."
LangString CloseFailed ${LANG_ENGLISH} "Please exit DynamicDesktop and retry."
LangString CloseFailed ${LANG_DUTCH} "Sluit DynamicDesktop af en probeer het opnieuw."
LangString RuntimeFailed ${LANG_ENGLISH} "Microsoft Edge WebView2 Runtime is required. Install the runtime separately and retry."
LangString RuntimeFailed ${LANG_DUTCH} "Microsoft Edge WebView2 Runtime is vereist. Installeer de runtime apart en probeer het opnieuw."

Function .onInit
  StrCpy $UpdateMode 0
  StrCpy $AppStopped 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(NeedX64)" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "$(NeedX64)" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetShellVarContext current
  SetRegView 64
  IfSilent languageDone
  !insertmacro MUI_LANGDLL_DISPLAY
  languageDone:
FunctionEnd

Function .onInstSuccess
  IfSilent 0 done
  ${If} $UpdateMode == 1
    Exec '"$INSTDIR\host\bin\DynamicDesktop.exe" --updated'
  ${EndIf}
  done:
FunctionEnd

Function .onInstFailed
  IfSilent 0 done
  ${If} $UpdateMode == 1
  ${AndIf} $AppStopped == 1
    IfFileExists "$INSTDIR\host\bin\DynamicDesktop.exe" 0 done
    Exec '"$INSTDIR\host\bin\DynamicDesktop.exe" --update-failed'
  ${EndIf}
  done:
FunctionEnd

Function CheckRuntime
  StrCpy $0 ""
  SetRegView 32
  ReadRegStr $0 HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView 64
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
FunctionEnd

Section "$(AppFiles)" SecApp
  SectionIn RO
  Call CheckRuntime
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    MessageBox MB_ICONSTOP "$(RuntimeFailed)" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\host\bin\DynamicDesktop.exe" 0 closed
  ExecWait '"$INSTDIR\host\bin\DynamicDesktop.exe" --exit-installed' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "$(CloseFailed)" /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  StrCpy $AppStopped 1
  closed:
  !include "${FILE_LIST}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\DynamicDesktop"
  CreateShortcut "$SMPROGRAMS\DynamicDesktop\DynamicDesktop.lnk" "$INSTDIR\host\bin\DynamicDesktop.exe"
  CreateShortcut "$SMPROGRAMS\DynamicDesktop\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\DynamicDesktop\Installer" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "DisplayName" "DynamicDesktop"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "Publisher" "DynamicDesktop"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "DisplayIcon" "$INSTDIR\host\bin\DynamicDesktop.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop" "EstimatedSize" $0
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd
Section "Uninstall"
  IfFileExists "$INSTDIR\host\bin\DynamicDesktop.exe" 0 unclosed
  ExecWait '"$INSTDIR\host\bin\DynamicDesktop.exe" --exit-installed' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "$(CloseFailed)" /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  unclosed:
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DynamicDesktop"
  ${UnStrStr} $1 $0 '$\"$INSTDIR\host\bin\DynamicDesktop.exe$\"'
  ${If} $1 != ""
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "DynamicDesktop"
  ${EndIf}
  !include "${DELETE_LIST}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\DynamicDesktop\DynamicDesktop.lnk"
  Delete "$SMPROGRAMS\DynamicDesktop\Uninstall.lnk"
  RMDir "$SMPROGRAMS\DynamicDesktop"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DynamicDesktop"
  DeleteRegKey HKCU "Software\DynamicDesktop\Installer"
SectionEnd
