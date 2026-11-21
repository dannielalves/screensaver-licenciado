# Interativa Gerenciador

Painel web e API de licenciamento para o aplicativo Windows de protecao de tela. O servidor guarda clientes, licencas, configuracoes, usuarios e sessoes no MongoDB Atlas.

## Requisitos

- Node.js 22.13 ou mais recente (recomendado: Node.js 24)
- Conta e cluster MongoDB Atlas
- Uma Database User do Atlas com permissao de leitura e escrita no banco do projeto
- Acesso de rede do servidor autorizado na IP Access List do Atlas

O servidor usa a conexao TLS do Atlas. Restrinja a IP Access List ao endereco de saida do servidor sempre que possivel; nao libere `0.0.0.0/0` em producao.

## Rodar localmente

1. Instale as dependencias: `npm ci`.
2. Copie `.env.example` para `.env`.
3. No Atlas, abra **Connect > Drivers**, copie a connection string e substitua os marcadores em `MONGODB_URI` no `.env`. Use a Database User, nao sua senha de login do Atlas. Se a senha tiver caracteres especiais, codifique-os para URL.
4. Mantenha `MONGODB_DB=interativa_gerenciador` e `NODE_ENV=development` para executar localmente.
5. Rode `npm start` e abra http://localhost:3022. Se precisar escolher outra porta, defina `PANEL_PORT` no ambiente do servidor.

No primeiro acesso, crie a conta de administrador com uma senha de pelo menos 10 caracteres. A connection string fica em `.env`, que e ignorado pelo Git. Nunca publique nem envie esse arquivo.

## Importar dados do SQLite

Se o projeto ja tiver clientes ou usuarios no SQLite, a importacao e opcional e preserva o banco de origem. Configure `.env` primeiro. O destino Atlas precisa estar vazio para evitar sobrescrever dados.

Confira a previa sem gravar no Atlas:

```sh
npm run migrate:sqlite
```

Se os totais estiverem corretos, importe:

```sh
npm run migrate:sqlite -- --apply
```

A importacao mantem os IDs existentes, copia clientes, configuracoes, avisos, usuarios e sessoes, e nao apaga nem altera o arquivo `servidor/dados/interativa.db`. Depois de importar, entre no painel e confira os registros. Se o projeto ainda nao tinha dados uteis no SQLite, basta iniciar o painel e criar o administrador no Atlas.

## Publicar o servidor com Docker

Configure as variaveis `MONGODB_URI`, `MONGODB_DB` (opcional), `INITIAL_ADMIN_TOKEN` (minimo de 32 caracteres) no ambiente ou em um `.env` local nao versionado. Adicione a IP de saida do servidor na IP Access List do Atlas. Depois execute:

```sh
docker compose up --build -d
```

Coloque um proxy HTTPS, como Caddy ou Nginx com certificado TLS, na frente do servico. Nao exponha a porta do Node diretamente a internet. Defina `NODE_ENV=production`, configure `PORT` (3022 por padrao) e mantenha `INITIAL_ADMIN_TOKEN` secreto; ele e pedido apenas ao criar o primeiro administrador.

Sem Docker, em um servidor Linux:

```sh
npm ci --omit=dev
NODE_ENV=production PORT=3022 npm start
```

Configure as mesmas variaveis de ambiente no gerenciador de processos (systemd, PM2 ou equivalente). O deploy nao precisa de armazenamento persistente local, pois os dados ficam no Atlas.

## Criar instalador Windows

```sh
npm ci
npm run dist:win
```

O instalador NSIS aparece em `dist/`. O aplicativo pede o endereco publico do servidor na tela de ativacao. O servidor Node precisa conseguir acessar o Atlas, mas os computadores dos clientes so precisam acessar a API HTTPS.

## Fluxo de licenciamento

1. O administrador configura a primeira conta e entra no painel.
2. O administrador cria o cliente, recebe um codigo aleatorio e pode ativar ou bloquear a licenca.
3. O aplicativo envia codigo e identificador persistente da instalacao para `POST /api/licenca/validar`.
4. O servidor recusa codigos inexistentes, bloqueados ou vinculados a outra instalacao; quando valido, devolve nome e configuracoes do cliente.
5. O aplicativo salva a ultima validacao e consulta novamente a cada 30 segundos. O bloqueio remoto vale na proxima sincronizacao. Uma licenca ativa pode ser liberada para outro computador desativando-a e usando **Liberar instalacao** no painel.
6. O app roda em segundo plano e abre a protecao em todos os monitores apos o tempo configurado. Tecla ou movimento do mouse fecha a tela e reinicia a contagem.

## Painel e API

- `GET /api/status`: disponibilidade do servidor
- `/api/auth/*`: configuracao inicial, login, logout e sessao
- `GET/POST /api/clientes`: consulta e cadastro
- `DELETE /api/clientes/:id`: exclusao permanente do cliente e configuracoes/avisos vinculados (somente administrador)
- `PATCH /api/clientes/:id/status`: ativacao ou bloqueio
- `POST /api/clientes/:id/liberar-instalacao`: desvincular uma instalacao
- `POST /api/licenca/validar`: validacao usada pelo aplicativo

As contas comuns tem acesso somente de consulta; apenas administradores alteram licencas, configuracoes e usuarios. Senhas sao derivadas com scrypt; sessoes usam cookies HttpOnly e tem expiracao. Limites de tentativas sao aplicados a login, configuracao inicial e validacao de licenca.

## Seguranca e operacao

- Guarde a URI do Atlas apenas no `.env` ou no cofre de segredos do provedor; nao a grave no codigo nem em logs.
- Use uma Database User exclusiva para o aplicativo, com os privilegios minimos no banco `interativa_gerenciador`.
- Restrinja a IP Access List a origem do servidor de aplicacao. O IP autorizado e o do servidor, nao o de cada computador que usa o painel.
- Use HTTPS para proteger cookies, senhas de painel e codigos de licenca durante o transporte.
- Configure backups do Atlas e teste a restauracao periodicamente.
- O prazo offline do aplicativo permite uso por ate 30 dias sem contato com o servidor; um bloqueio remoto e aplicado quando o cliente voltar a validar. A tela de protecao e uma janela de aplicativo comum e nao substitui politicas de bloqueio do Windows ou software de quiosque.
