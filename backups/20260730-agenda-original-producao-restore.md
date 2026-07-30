# Backup da agenda original em produção

- Commit de origem: `44b2bda613fcccb0f31608abea0af7c835b88447`
- Arquivo completo: `backups/20260730-agenda-original-producao-completa.zip`
- SHA-256: `CF35100A135E132A132F6625A3C73A1A4B8E6D4D006E7C8D2D1E110E971E2C82`
- Versão Cloudflare original: `d94f2c64-7072-48af-8248-6868c7211a61`

Para restaurar imediatamente a versão original em produção:

```powershell
npx.cmd wrangler rollback d94f2c64-7072-48af-8248-6868c7211a61 --message "Restaurar agenda original" --yes
```

O arquivo ZIP contém a árvore integral do repositório no commit original e deve
permanecer intacto.
