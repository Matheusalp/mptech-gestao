# Changelog

## 1.1.19 - 2026-04-30

- Finalizadas rotas locais de leitura/snapshot para hidratar o frontend pelo PostgreSQL apos login.
- Corrigida persistencia de valores numericos em caixa, contas a pagar/receber e despesas na API local.
- Corrigido roteamento de sincronizacao de estoque, caixa e financeiro para gravar nas tabelas operacionais corretas.
- Incluido botao de sincronizacao manual SaaS na aba Licenca das configuracoes.
- Adicionado endpoint local autenticado para puxar dados do Supabase sem expor service role no frontend.
- Criado relatorio visual mostrando cliente, licenca, plano, modulos, configuracoes e status da atualizacao automatica do banco.
- Corrigido mapeamento de cadastro da loja salvo no SaaS para trazer CNPJ/CPF, endereco, cidade, telefone, email e preferencias quando vierem por configuracoes.

## 1.1.18 - 2026-04-30

- Ajustado layout visual do PDV no topo, busca, catalogo e carrinho vazio.
- Corrigido overflow do atalho visual no botao de gaveta em desktop.
- Melhorada hierarquia do status de caixa, vendedor e acoes rapidas do PDV.

## 1.1.17 - 2026-04-30

- Otimizado CSS global para preservar o redesign visual sem regras de performance globais com `!important`.
- Ajustada sincronizacao local para evitar chamadas autenticadas sem sessao ativa.
- Melhorado carregamento do HTML com preconnect do CDN e dimensoes explicitas do logo.
- Reforcado tema escuro nas variaveis do dashboard e padronizados tamanhos de fonte estaveis.

## 1.1.0 - 2026-04-28

Versao estavel de producao para venda comercial controlada.

- Separada a validacao de licenca para preferir a API local em producao.
- Mantido PostgreSQL local como banco operacional da loja.
- Mantido Supabase/SaaS central apenas para licenca, plano, vencimento, teste, bloqueio e identificacao do cliente.
- Corrigido login da API local em `/api/auth/login`.
- Melhorado backup PostgreSQL em ambientes Windows com PostgreSQL instalado fora do `PATH`.
- Melhorado restore JSON para restaurar colunas reais das tabelas operacionais, nao apenas `payload`.
- Removida inclusao de `.env` no instalador e empacotado runtime Node com dependencias de producao do backend local.
- Revisado `.env.example` com variaveis separadas por ambiente, SaaS, banco local, API e seguranca.
- Reduzidos logs de console em ambiente de producao.
- Usuario inicial agora deve existir no portal SaaS; no primeiro login a API local busca `usuarios_saas` no Supabase, valida a senha no backend e sincroniza o usuario local.
- Fallback de login por `localStorage` bloqueado em producao.

Pendencias controladas:

- Validacao comercial final ainda exige `SAAS_CLIENT_ID` real e Supabase central configurado.
- Fluxos visuais completos de PDV/financeiro/clientes devem ser homologados em navegador com dados reais antes de venda em escala.
