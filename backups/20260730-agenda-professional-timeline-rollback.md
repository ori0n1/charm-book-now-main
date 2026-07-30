# Ponto de rollback — agenda profissional

Base funcional preservada: `832bc0b4d91fa2a5d05c2de334e3428e187b7e4a`.

Backup Git completo: `backups/20260730-agenda-professional-timeline-before.bundle`.

Para desfazer exclusivamente esta reformulação visual:

```powershell
powershell -ExecutionPolicy Bypass -File backups/rollback-agenda-professional-timeline.ps1
```

O script restaura somente os três ficheiros existentes alterados pela agenda e
remove somente os quatro ficheiros novos desta implementação. Nenhum dado do
banco é alterado.
