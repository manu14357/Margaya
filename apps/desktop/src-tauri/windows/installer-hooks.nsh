; Hooks for Tauri's NSIS installer (bundle.windows.nsis.installerHooks).
; Other installer additions belong in these same macros.

; "Send to > Margaya" in File Explorer: the files go to quick add, which
; lists them by name and uploads nothing until the person creates the task.
!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$SENDTO\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--send-to" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

; An update runs the old uninstaller with /UPDATE and then installs again;
; keep the shortcut then, and remove it only on a real uninstall.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$SENDTO\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
