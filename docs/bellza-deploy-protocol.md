# Protocolo de publicação Bellza

Este documento complementa o `AGENTS.md` principal. Vale para todos os agentes e artefatos. A versão ativa da Cloudflare é a fonte de verdade; uma branch ou um build local não a substituem. O operador regista evidência verificável de cada fase antes de alterar tráfego. A verificação automática em `npm run bellza:release-gate -- --evidence <ficheiro.json>` recusa campos ausentes ou falhados, mas não autentica por si só as evidências. Confira-as por OAuth e mantenha o ficheiro de evidência fora do artefato Worker.

## 1. Preparação

1. Consulte a versão e o deployment ativos. Compare código, assets, rotas, runtime, commit, hashes, bindings, nomes/tipos de secrets, crons e domínios com o candidato imutável. Nunca imprima valores de secrets.
2. Justifique cada diferença; recuse funcionalidade não aprovada, perda de binding ou mudança de dados, permissões ou configuração não autorizada.
3. Confirme que a versão anterior ainda pode ser selecionada para 100% do tráfego, que os seus recursos continuam disponíveis e que o novo código não introduz escrita incompatível com o Worker anterior. Se uma migração não tiver reversão segura, resolva antes de publicar.
4. Registe a autorização expressa para o artefato exato. Ela pode abranger upload, testes, promoção, smoke tests, monitoramento e rollback emergencial seguro do Worker. Alteração de código, SQL, dados, configurações e outros artefatos exigem autorização própria.

## 2. Upload sem tráfego

1. Use o artefato aprovado, sem reconstruir, e `wrangler versions upload`. Não use `wrangler deploy`, que também envia tráfego.
2. Leia de volta o ID, ETag/hash do script, configuração da versão, bindings e runtime. Confirme que o deployment anterior segue a 100%, com crons e domínios intactos.
3. Guarde o hash local do manifesto ordenado de ficheiros e o hash da configuração; a Cloudflare pode não fornecer um hash agregado dos assets. Não declare equivalência de bytes remotos sem prova correspondente.

## 3. Testes atômicos antes de ativar

Cada item recebe `PASS` ou `FAIL`, versão testada, método, evidência e indicação de isolamento. Valide inicialização; rotas/APIs essenciais; autenticação/permissões; agenda/reservas; pagamentos e Stripe Connect sem cobrança; WhatsApp, e-mail e push com provedores simulados; bindings/secrets/crons; funcionalidades existentes; ausência de erros críticos. Use identidades e dados sintéticos num ambiente isolado. Nunca envie mensagens ou cobranças reais.

Teste diretamente o artefato carregado quando houver caminho seguro. Uma Version URL da Cloudflare usa os recursos de produção do Worker: não faça operações de escrita nela como se fosse QA. Um override de versão só funciona quando a versão integra o deployment, mesmo com 0% de tráfego; criar esse deployment é uma operação separada que requer avaliação do risco. Se a versão carregada não for alcançável e as provas alternativas não forem suficientes para um fluxo crítico, marque `FAIL` e mantenha o Worker anterior ativo. Teste local isolado, por si só, não aprova o artefato remoto.

## 4. Ativação e monitoramento

Execute o gate automatizado com evidências reais e confira manualmente os links, IDs e hashes. Se todos os testes passarem e a autorização expressa incluir promoção, selecione **somente** a versão aprovada para 100%. Não peça segunda autorização para essa promoção quando o ciclo completo já foi aprovado. Releia imediatamente deployment e percentagem; faça smoke tests sem dados reais e monitore erros, disponibilidade e fluxos críticos. Se a confirmação falhar, suspenda a operação e reporte o estado efetivo.

## 5. Rollback emergencial

Uma autorização expressa para o ciclo pode pré-autorizar somente a reversão segura do **tráfego do Worker** em caso de regressão crítica comprovadamente causada por essa publicação. Confirme a causa e a disponibilidade da versão anterior. Reverta para ela a 100%, releia o deployment, verifique recuperação e registe o incidente. Não faça correção direta em produção; não reverta SQL, dados, migrações ou recursos irreversíveis automaticamente. Quando a compatibilidade ou a causa não estiver comprovada, interrompa e peça decisão específica. Considere que páginas antigas podem ainda pedir assets da versão nova durante a propagação.

## Evidência para o gate

O ficheiro JSON local contém `authorization`, `baseline`, `artifact`, `config`, `safety` e `tests`. Cada teste em `tests` tem `{ "status": "PASS", "versionId": "<ID carregado>", "method": "remote-version", "evidence": "<referência verificável>", "isolated": true }`. Para verificações de metadados, use `method: "cloudflare-metadata"`; para testes de comportamento, o método deve atingir a versão carregada. `safety` deve confirmar ausência de cobranças, mensagens e escritas reais. O gate recusa promoção quando falta qualquer prova; nunca preencha um resultado `PASS` apenas para satisfazer o formato.

## Aplicação à agenda em 21/11/2026

O commit `5d3e1ceab8489f5f4e403e256afbe08c7bfa76e2` foi carregado como versão `a376d3e8-acac-41cb-b05d-85f0d19bb394`. O deployment `74453a81-17ef-4902-bd30-39ebe04880e6` ainda encaminha 100% para `0e57911e-af99-432d-9fb6-70ad5046d4ee`. A nova versão tem ETag `017416795e821ee8ffd31ddb46bf02f4273ec507462af9391d1050d9260b7d36`; o manifesto local do artefato tem SHA-256 `b6a64ff6a3a658944e3ae5a2316397c4d04cb0df6fb7b53b8c9bb2242970a7e6` e a configuração SHA-256 `cc8af1ea8e4ca14d9e44f27d8cdb0c8d037ed21cae85aa84086c65c7b4b42634`.

**Estado: BLOQUEADO para promoção.** A API informa `previews_enabled=false` e a raiz da Version URL devolve 404. Um teste remoto de escrita usaria recursos de produção; a aprovação de QA local anterior não comprova por si só os testes atômicos do artefato carregado. Não foi criado deployment 100/0, nem alterada a configuração de produção. A versão anterior permanece ativa. Reavaliar apenas quando existir caminho seguro e autorizado para testar os fluxos críticos da versão carregada, sem dados ou provedores reais.
