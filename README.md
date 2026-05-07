# MPTech Gestao

Sistema web estatico de PDV, estoque, financeiro, clientes, vendas, relatorios e configuracoes para a World Acessorios Atacado.

O projeto roda em HTML, CSS e JavaScript puro no frontend, com backend local opcional em Node.js para PostgreSQL. Sem backend configurado, ele continua abrindo o `index.html`, salva dados em `localStorage` e usa fallback local.

## Modulos

- Login local com sessao temporizada.
- Dashboard com vendas, caixa, lucro, entradas, saidas e estoque baixo.
- PDV com carrinho, desconto, troco, baixa de estoque e comprovante.
- Produtos e estoque com fornecedor, margem, inativacao e ajuste manual.
- Financeiro com caixa, despesas, entradas, saidas, contas a pagar e contas a receber.
- Vendas com historico, cancelamento, devolucao de estoque e impressao de comprovante.
- Clientes com cadastro completo, busca, indicadores, historico de compras e CSV.
- Relatorios com resumo gerencial, backup JSON e exportacao CSV/TXT.
- Configuracoes de loja, seguranca, backup, comprovante, aparencia e status de licenca SaaS.
- O painel SaaS/licenciamento roda em servidor separado; este projeto e a aplicacao da loja/cliente.

## Tecnologias

- HTML5
- CSS3
- JavaScript puro
- `localStorage`
- Supabase JavaScript v2 via CDN
- Node.js local-server
- PostgreSQL local por loja
- Supabase central para SaaS/licencas

## Estrutura

```text
.
|-- index.html
|-- style.css
|-- app.js
|-- MPTech Gestao.cmd
|-- assets/
|   `-- logo-world.svg
|-- scripts/
|   |-- local-server.js
|   |-- local_server.py
|   |-- start-local.ps1
|   |-- validate-settings.js
|   `-- update-version.ps1
|-- supabase/
|   |-- README.md
|   |-- saas_schema.sql
|   |-- seed.sql
|   `-- migrations/
|-- local-server/
|   |-- server.js
|   |-- db.js
|   |-- sync-service.js
|   |-- migrations/
|   `-- routes/
|-- docs/
|   |-- README.md
|   |-- checklists/
|   |-- operacao/
|   |-- release/
|   `-- suporte/
|-- README.md
`-- CHANGELOG.md
```

## Como rodar

No Windows, execute o arquivo:

```text
MPTech Gestao.cmd
```

Ele inicia um servidor local em `http://localhost:8765` e abre o sistema no navegador. Se o servidor ja estiver aberto, ele apenas abre o sistema novamente, funcionando como um atalho.

O atalho e portatil: pode mover a pasta inteira para outro diretorio ou computador e executar o mesmo `MPTech Gestao.cmd`. Mantenha o arquivo `.cmd` na raiz, junto com `index.html`, `app.js`, `style.css`, `assets/`, `scripts/`, `src/`, `local-server/`, `supabase/` e `runtime/` quando existir.

Tambem e possivel abrir diretamente:

```text
MPTech Gestao\MPTech Gestao.exe
```

Esse executavel ja inclui o servidor local e nao precisa de Node.js, Python ou instalacao adicional no computador de destino.

Para levar para outro computador, gere um pacote novo em `dist/` e instale a partir do instalador ou do pacote portatil. Nao distribua a pasta de desenvolvimento com `.env`, `backups/`, `build/`, `runtime/` de testes ou arquivos temporarios.

Abra `index.html` diretamente no navegador.

Para testar com servidor local:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

Acesse `http://localhost:8765`.

## Instalar como servico do Windows

Em uma maquina de loja, abra PowerShell como Administrador na pasta do sistema e execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows-service.ps1
```

Isso registra tres servicos automaticos:

- `MPTechGestaoPostgres`: PostgreSQL local na porta `55432`.
- `MPTechGestaoApi`: API local em `http://127.0.0.1:3001`.
- `MPTechGestaoWeb`: sistema web em `http://127.0.0.1:8765`.

Para remover os servicos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-windows-service.ps1
```

O painel SaaS central nao faz parte da operacao da loja em producao.

## Acesso inicial

O usuario inicial deve ser criado no portal SaaS/licenciamento.

Na loja, configure `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no `.env`. O `SAAS_CLIENT_ID` pode ficar vazio no primeiro acesso: ao fazer login com o e-mail cadastrado em `usuarios_saas`, a API local identifica o `cliente_id`, grava esse valor no `.env` e sincroniza o usuario autorizado para o PostgreSQL local. Se o mesmo e-mail existir em mais de uma loja, configure `SAAS_CLIENT_ID` manualmente para evitar ambiguidade.

## Arquitetura de dados

O sistema agora separa dois bancos:

- Supabase central: somente SaaS, licencas, clientes contratantes, planos, modulos, configuracoes administrativas e logs de validacao. Use `supabase/saas_schema.sql` no servidor SaaS separado.
- PostgreSQL local: operacao da loja, produtos, estoque, vendas, caixa, financeiro, clientes da loja, usuarios internos e configuracoes. Use `local-server/migrations/001_operational_schema.sql`.

O frontend nao conecta diretamente no PostgreSQL. A API local fica em `local-server/` e responde em `http://127.0.0.1:3001`.
Se a API local nao estiver configurada, o app mantem o fallback atual em `localStorage`.

Rotas principais do backend local:

- `POST /api/license/validate`: validacao local/server-side da licenca contra o SaaS central e cache local.
- `GET /api/core/snapshot`: carrega dados operacionais do PostgreSQL local para hidratar o frontend apos login.
- `POST /api/core/venda`: venda transacional com baixa de estoque.
- `POST /api/core/cancelamento`: cancelamento com devolucao de estoque.
- `POST /api/core/caixa/abrir`, `/fechar`, `/movimento`: operacao de caixa.
- `GET /api/produtos`, `/clientes`, `/vendas`, `/financeiro`, `/caixa`: leitura REST autenticada dos recursos locais.
- `GET /api/backup/export` e `POST /api/backup/restore`: backup e restore JSON do PostgreSQL local.

Configure as variaveis com base em `.env.example`. Nao coloque credenciais reais no codigo.
O servidor local gera `/config.js` a partir do `.env` expondo somente variaveis publicas para o navegador:
`APP_ENV`, `SAAS_CLIENT_ID` e `MPTECH_LOCAL_API_URL`.
Variaveis como `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `LOCAL_DATABASE_URL`, `JWT_SECRET` e senhas nao sao enviadas ao frontend.

## Persistencia

- Local: sessao, cache simples e preferencias em `localStorage`.
- PostgreSQL local: dados operacionais da loja quando `LOCAL_DATABASE_URL` estiver configurado.
- Supabase central: validacao de licenca, plano, modulos e logs SaaS.

## Versao do sistema

A versao fica em `APP_VERSION` e `APP_VERSION_UPDATED_AT` no `app.js` e entra nos backups JSON.

Sempre que alterar codigo que sera entregue, rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-version.ps1
```

Para uma versao especifica:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-version.ps1 -Version 1.2.0
```

Use `-Bump minor` ou `-Bump major` quando a entrega nao for apenas correcao pequena.

## Validacoes locais

Para conferir a tela de configuracoes:

```powershell
node scripts\validate-settings.js
```

Antes de liberar uma loja real, execute o fluxo consolidado:

```powershell
npm run release:check
```

Use `docs/production-release-checklist.md` como checklist auditavel da implantacao.

## Seguranca atual

- O primeiro login administrativo vem do portal SaaS e e sincronizado para o banco local.
- O backend local possui servico de hash de senha para usuarios internos sincronizados.
- Em producao, o navegador nao deve receber a chave anon/publica do Supabase; a validacao passa pela API local.
- `service_role`, `DATABASE_URL`, senha de banco e segredos nunca devem ir para frontend ou repositorio.
- Operacoes criticas de PDV, caixa, estoque, contas financeiras, backup e hidratacao inicial passam pela API local autenticada.
- Em `APP_ENV=production`, venda sem API local autenticada/PostgreSQL disponivel e bloqueada para evitar baixa de estoque silenciosa em `localStorage`.
- A API local usa CORS restrito em producao. Configure `LOCAL_API_CORS_ORIGINS` apenas com origens locais controladas.

## Limitacoes conhecidas

- O backend/API local existe, mas ainda precisa ser instalado e testado com PostgreSQL real em maquina limpa.
- O login inicial nao cria `admin/admin`; ele depende do usuario cadastrado no portal SaaS.
- O `SAAS_CLIENT_ID` e descoberto no primeiro login quando o e-mail pertence a uma unica loja SaaS.
- RLS versionado esta habilitado no schema SaaS, mas as politicas finais ainda precisam ser revisadas no projeto Supabase real por usuario, perfil e loja.
- Os testes automatizados cobrem fluxos principais, mas nao substituem homologacao em impressora, leitor USB, Windows limpo, Supabase real e dados reais de loja.
- A sincronizacao offline deduplica fila local, mas conflito real entre duas estacoes vendendo o mesmo item ainda precisa de homologacao com PostgreSQL compartilhado.
- O fallback `localStorage` e operacional/offline, nao e barreira de seguranca contra usuario malicioso no mesmo computador.

## Roadmap de producao

- Homologar instalacao completa em Windows limpo com PostgreSQL, API local e servidor web como servicos.
- Aplicar e validar `supabase/migrations/001_saas_schema.sql` no projeto Supabase real.
- Rodar advisors do Supabase e revisar politicas finais por usuario, perfil e loja.
- Homologar leitor de codigo de barras e impressoras termicas reais 58mm/80mm.
- Executar piloto com dados reais antes de vender em escala.

## Roadmap SaaS

- Manter o Supabase central restrito a licenca, planos, modulos, configuracoes SaaS, usuarios SaaS e logs.
- Nao gravar produtos, vendas, caixa, clientes finais ou financeiro operacional da loja no Supabase central.
- Usar `SUPABASE_SERVICE_ROLE_KEY` somente no backend local ou em ambiente administrativo controlado.
- Revisar onboarding e login real com Supabase Auth antes da primeira venda comercial.

## Checklist tecnico

Use `docs/checklists/CHECKLIST_REVISAO_COMPLETA_SISTEMA.md` como backlog tecnico antes de colocar clientes reais em producao.

Consulte tambem:

- `docs/README.md` para o indice completo da documentacao.
- `docs/suporte/SUPORTE_OPERACIONAL.md` para suporte, backup, restauracao e diagnostico.
- `docs/operacao/ROTEIRO_OPERADOR.md` para rotina diaria de caixa e venda.
- `docs/operacao/ROTEIRO_ADMINISTRADOR.md` para usuarios, permissoes, metas, backup e restore.
- `docs/checklists/CHECKLIST_IMPLANTACAO_CLIENTE.md` para cada nova loja.
- `docs/checklists/CHECKLIST_CLIENTE_PAGANTE_STATUS.md` para status consolidado de liberacao comercial.
- `docs/checklists/CHECKLIST_HOMOLOGACAO_HARDWARE.md` para impressora, corte e leitor USB.
- `docs/checklists/CHECKLIST_WINDOWS_LIMPO_SERVICOS.md` para instalacao limpa e servicos Windows.
- `docs/checklists/CHECKLIST_SUPABASE_REAL.md` para schema, RLS, advisors e onboarding.
- `docs/checklists/CHECKLIST_PILOTO_DADOS_REAIS.md` para ciclo operacional com dados reais.
- `docs/suporte/POLITICA_BACKUP_RECUPERACAO.md` para backup criptografado, restore e troca de computador.
- `docs/suporte/SUPORTE_PRIMEIRO_ATENDIMENTO.md` para triagem de chamados.
- `docs/operacao/TERMO_ACEITE_PILOTO.md` para aceite formal do piloto.
- `docs/release/RELATORIO_TRATAMENTO_CHECKLIST_CLIENTE_PAGANTE.md` para o historico de tratamento do checklist comercial.

Scripts de release:

- `scripts/pre-release-check.js` executa a bateria tecnica e auditorias de seguranca antes da entrega.
- `scripts/check-no-secrets.js` verifica ausencia de `.env`, valores reais sensiveis, chaves privadas e tokens hardcoded nas superficies publicas.
- `scripts/validate-permissions.js` valida 401/403 nas rotas sensiveis em producao.
- `scripts/audit-release-package.js` audita o pacote `dist/`, `/config.js` e permissoes.
