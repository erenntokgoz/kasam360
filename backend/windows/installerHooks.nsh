; Kurulum kimliği: kaldırınca silinen kurulum klasöründe durur, uygulama verisi
; (SQLite) ise kalır. Uygulama açılışta kimliği karşılaştırıp yeniden kurulumu
; fark eder ve hesap oturumunu kapatır; işletme verisine dokunulmaz.

!macro NSIS_HOOK_POSTINSTALL
  ; Güncelleme aynı klasörün üstüne kurulur: dosya varsa kimlik değişmez, oturum sürer.
  ${IfNot} ${FileExists} "$INSTDIR\install-id"
    System::Call 'ole32::CoCreateGuid(g .r0)i'
    FileOpen $1 "$INSTDIR\install-id" w
    FileWrite $1 "$0"
    FileClose $1
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Güncelleme sırasında eski sürümün kaldırıcısı da çalışır; kimlik yalnız gerçek kaldırmada silinir.
  ${If} $UpdateMode <> 1
    Delete "$INSTDIR\install-id"
  ${EndIf}
!macroend
