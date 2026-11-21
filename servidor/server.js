require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { BSON } = require('mongodb');
const { conectarBanco, proximoId, executarTransacao, fecharBanco } = require('./database');

const app = express();
const PORT = Number(process.env.PANEL_PORT || process.env.PORT || 3022);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000;
const COOKIE_SESSAO = 'interativa_sessao';
const COLECOES_BACKUP = ['clientes', 'configuracoes', 'usuarios', 'avisos', 'sistema_configuracoes', 'sequencias'];
const VERSAO_BACKUP = 1;
const TAMANHO_MAX_BACKUP = 50 * 1024 * 1024;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT deve estar entre 1 e 65535.');
}

let db;
const tentativas = new Map();
const agoraIso = () => new Date().toISOString();
const usuarioPublico = ({ id, nome, usuario, perfil }) => ({ id, nome, usuario, perfil });

function lerCookie(req, nome) {
    const item = (req.headers.cookie || '').split(';').map((v) => v.trim()).find((v) => v.startsWith(`${nome}=`));
    return item ? decodeURIComponent(item.slice(nome.length + 1)) : '';
}

function criarHashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
    return { salt, hash: crypto.scryptSync(senha, salt, 64).toString('hex') };
}

async function obterUsuarioDaSessao(req) {
    const idSessao = lerCookie(req, COOKIE_SESSAO);
    if (!/^[a-f0-9]{64}$/.test(idSessao)) return null;
    const sessao = await db.collection('sessoes').findOne({ _id: idSessao, expira_em: { $gt: new Date() } });
    if (!sessao) return null;
    const conta = await db.collection('usuarios').findOne({ id: sessao.usuario_id, ativo: 1 });
    return conta ? usuarioPublico(conta) : null;
}

async function exigirLogin(req, res, next) {
    try {
        req.usuario = await obterUsuarioDaSessao(req);
        if (!req.usuario) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
        next();
    } catch (erro) { next(erro); }
}

function exigirAdministrador(req, res, next) {
    exigirLogin(req, res, () => {
        if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Esta ação é permitida somente ao administrador.' });
        next();
    });
}

function definirCookieSessao(res, id) {
    const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_SESSAO}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}${seguro}`);
}

function limitarTentativas(limite, janelaMs) {
    return (req, res, next) => {
        const agora = Date.now();
        const chave = `${req.ip}:${req.path}`;
        let estado = tentativas.get(chave);
        if (!estado || estado.inicio <= agora - janelaMs) estado = { inicio: agora, total: 0 };
        estado.total += 1;
        tentativas.set(chave, estado);
        if (tentativas.size > 10000) {
            for (const [k, v] of tentativas) if (v.inicio <= agora - janelaMs) tentativas.delete(k);
        }
        if (estado.total > limite) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde e tente novamente.' });
        next();
    };
}

function idNumerico(valor) {
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function erroDuplicidade(erro) { return erro?.code === 11000; }

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
});
app.use(express.json({ limit: '32kb' }));

function validarBackup(backup) {
    if (!backup || backup.formato !== 'interativa-gerenciador-backup' || backup.versao !== VERSAO_BACKUP || !backup.colecoes || typeof backup.colecoes !== 'object' || Array.isArray(backup.colecoes)) return false;
    const chaves = Object.keys(backup.colecoes).sort();
    if (JSON.stringify(chaves) !== JSON.stringify([...COLECOES_BACKUP].sort())) return false;
    try {
        return COLECOES_BACKUP.every((nome) => Array.isArray(backup.colecoes[nome]) && backup.colecoes[nome].every((doc) => {
            if (typeof doc !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(doc)) return false;
            return BSON.deserialize(Buffer.from(doc, 'base64')) && true;
        }));
    } catch { return false; }
}

app.get('/api/backup', exigirAdministrador, async (req, res, next) => {
    try {
        const colecoes = {};
        await executarTransacao(async (sessao) => {
            for (const nome of COLECOES_BACKUP) {
                const documentos = await db.collection(nome).find({}, { session: sessao }).toArray();
                colecoes[nome] = documentos.map((documento) => BSON.serialize(documento).toString('base64'));
            }
        });
        const backup = { formato: 'interativa-gerenciador-backup', versao: VERSAO_BACKUP, criado_em: agoraIso(), colecoes };
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="interativa-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(JSON.stringify(backup));
    } catch (erro) { next(erro); }
});

app.post('/api/backup/restaurar', exigirAdministrador, express.raw({ type: 'application/octet-stream', limit: TAMANHO_MAX_BACKUP }), async (req, res, next) => {
    try {
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: 'Envie um arquivo de backup válido.' });
        let backup;
        try { backup = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ erro: 'O arquivo não contém um JSON válido.' }); }
        if (!validarBackup(backup)) return res.status(400).json({ erro: 'Formato ou conteúdo do backup incompatível com este sistema.' });
        const colecoesRestauradas = Object.fromEntries(COLECOES_BACKUP.map((nome) => [nome, backup.colecoes[nome].map((documento) => BSON.deserialize(Buffer.from(documento, 'base64')))]));

        // A substituição usa transação: se falhar, o MongoDB desfaz as alterações.
        try {
            await executarTransacao(async (sessao) => {
                for (const nome of COLECOES_BACKUP) {
                    await db.collection(nome).deleteMany({}, { session: sessao });
                    if (colecoesRestauradas[nome].length) await db.collection(nome).insertMany(colecoesRestauradas[nome], { session: sessao });
                }
                await db.collection('sessoes').deleteMany({}, { session: sessao });
            });
        } catch (erro) {
            // O MongoDB reverte as alterações da transação quando ela falha.
            console.error('Falha na restauração do backup; a transação foi revertida.');
            throw erro;
        }
        res.json({ sucesso: true, mensagem: 'Backup restaurado. Todas as sessões foram encerradas; entre novamente.' });
    } catch (erro) { next(erro); }
});

app.get('/api/auth/status', async (req, res) => {
    const quantidade = await db.collection('usuarios').countDocuments();
    const usuario = await obterUsuarioDaSessao(req);
    res.json({ configuracaoInicial: quantidade === 0, autenticado: Boolean(usuario), tokenRequerido: process.env.NODE_ENV === 'production', usuario });
});

app.post('/api/auth/setup', limitarTentativas(5, 15 * 60 * 1000), async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        const esperado = process.env.INITIAL_ADMIN_TOKEN || '';
        const fornecido = typeof req.get('x-initial-admin-token') === 'string' ? req.get('x-initial-admin-token') : '';
        const a = Buffer.from(esperado); const b = Buffer.from(fornecido);
        if (a.length < 32 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ erro: 'Token inicial inválido ou não configurado no servidor.' });
    }
    const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (nome.length < 2 || nome.length > 100 || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario) || senha.length < 10 || senha.length > 200) return res.status(400).json({ erro: 'Informe nome, usuário (3 a 40 caracteres) e senha com pelo menos 10 caracteres.' });
    try {
        if (await db.collection('usuarios').countDocuments()) return res.status(409).json({ erro: 'A configuração inicial já foi concluída. Faça login.' });
        const hash = criarHashSenha(senha);
        const conta = { id: await proximoId(db, 'usuarios'), nome, usuario, usuario_normalizado: usuario.toLowerCase(), senha_hash: hash.hash, salt: hash.salt, perfil: 'admin', ativo: 1, administrador_inicial: true, criado_em: agoraIso() };
        await db.collection('usuarios').insertOne(conta);
        const idSessao = crypto.randomBytes(32).toString('hex');
        await db.collection('sessoes').insertOne({ _id: idSessao, usuario_id: conta.id, expira_em: new Date(Date.now() + DURACAO_SESSAO_MS) });
        definirCookieSessao(res, idSessao);
        res.status(201).json({ sucesso: true, usuario: usuarioPublico(conta) });
    } catch (erro) {
        if (erroDuplicidade(erro)) return res.status(409).json({ erro: 'A configuração inicial já foi concluída ou esse usuário já está em uso.' });
        throw erro;
    }
});

app.post('/api/auth/login', limitarTentativas(10, 15 * 60 * 1000), async (req, res) => {
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const conta = await db.collection('usuarios').findOne({ usuario_normalizado: usuario.toLowerCase(), ativo: 1 });
    if (!conta || senha.length > 200) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    const hash = crypto.scryptSync(senha, conta.salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex'); const b = Buffer.from(conta.senha_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    const idSessao = crypto.randomBytes(32).toString('hex');
    await db.collection('sessoes').insertOne({ _id: idSessao, usuario_id: conta.id, expira_em: new Date(Date.now() + DURACAO_SESSAO_MS) });
    definirCookieSessao(res, idSessao);
    res.json({ sucesso: true, usuario: usuarioPublico(conta) });
});

app.post('/api/auth/logout', async (req, res) => {
    const idSessao = lerCookie(req, COOKIE_SESSAO);
    if (idSessao) await db.collection('sessoes').deleteOne({ _id: idSessao });
    res.setHeader('Set-Cookie', `${COOKIE_SESSAO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ sucesso: true });
});

app.get('/api/auth/me', exigirLogin, (req, res) => res.json({ usuario: req.usuario }));

app.get('/api/usuarios', exigirAdministrador, async (req, res) => {
    const contas = await db.collection('usuarios').find({}, { projection: { _id: 0, id: 1, nome: 1, usuario: 1, perfil: 1, ativo: 1, criado_em: 1 } }).sort({ id: 1 }).toArray();
    res.json(contas);
});

app.post('/api/usuarios', exigirAdministrador, async (req, res) => {
    const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const perfil = req.body.perfil === 'admin' ? 'admin' : 'comum';
    if (nome.length < 2 || nome.length > 100 || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario) || senha.length < 10 || senha.length > 200) return res.status(400).json({ erro: 'Confira os dados. A senha deve ter pelo menos 10 caracteres.' });
    const hash = criarHashSenha(senha);
    try {
        const conta = { id: await proximoId(db, 'usuarios'), nome, usuario, usuario_normalizado: usuario.toLowerCase(), senha_hash: hash.hash, salt: hash.salt, perfil, ativo: 1, administrador_inicial: false, criado_em: agoraIso() };
        await db.collection('usuarios').insertOne(conta);
        res.status(201).json({ sucesso: true, id: conta.id });
    } catch (erro) {
        if (erroDuplicidade(erro)) return res.status(409).json({ erro: 'Esse nome de usuário já está em uso.' });
        throw erro;
    }
});

app.patch('/api/usuarios/:id/status', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id); const ativo = req.body.ativo;
    if (!id || typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Dados inválidos.' });
    if (id === req.usuario.id && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
    const resultado = await db.collection('usuarios').updateOne({ id }, { $set: { ativo: ativo ? 1 : 0 } });
    if (!resultado.matchedCount) return res.status(404).json({ erro: 'Conta não encontrada.' });
    if (!ativo) await db.collection('sessoes').deleteMany({ usuario_id: id });
    res.json({ sucesso: true });
});

app.put('/api/usuarios/:id/senha', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id); const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!id || senha.length < 10 || senha.length > 200) return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 10 caracteres.' });
    const hash = criarHashSenha(senha);
    const resultado = await db.collection('usuarios').updateOne({ id }, { $set: { senha_hash: hash.hash, salt: hash.salt } });
    if (!resultado.matchedCount) return res.status(404).json({ erro: 'Conta não encontrada.' });
    await db.collection('sessoes').deleteMany({ usuario_id: id });
    res.json({ sucesso: true });
});

app.use(express.static(path.join(__dirname, '..', 'painel')));

app.get('/api/configuracao-servidor', exigirLogin, async (req, res) => {
    const configuracao = await db.collection('sistema_configuracoes').findOne({ _id: 1 });
    if (!configuracao) return res.status(404).json({ erro: 'Configuração do servidor não encontrada.' });
    res.json({ endereco_servidor: configuracao.endereco_servidor, porta_servidor: configuracao.porta_servidor, atualizado_em: configuracao.atualizado_em });
});

app.put('/api/configuracao-servidor', exigirAdministrador, async (req, res) => {
    const endereco = typeof req.body.endereco === 'string' ? req.body.endereco.trim() : '';
    const porta = req.body.porta;
    if (!endereco || endereco.length > 253 || /[\s/\\?#@]/.test(endereco)) return res.status(400).json({ erro: 'Informe um IP ou nome de computador válido.' });
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return res.status(400).json({ erro: 'A porta deve estar entre 1 e 65535.' });
    await db.collection('sistema_configuracoes').updateOne({ _id: 1 }, { $set: { endereco_servidor: endereco, porta_servidor: porta, atualizado_em: agoraIso() } }, { upsert: true });
    res.json({ sucesso: true, mensagem: 'Configuração do servidor salva com sucesso!' });
});

app.post('/api/licenca/validar', limitarTentativas(120, 60 * 1000), async (req, res) => {
    const codigo = typeof req.body.codigo === 'string' ? req.body.codigo.trim() : '';
    const identificador = typeof req.body.identificador_instalacao === 'string' ? req.body.identificador_instalacao.trim() : '';
    if (!codigo || !identificador) return res.status(400).json({ sucesso: false, erro: 'Informe o código do cliente e o identificador da instalação.' });
    if (codigo.length > 100 || identificador.length > 200) return res.status(400).json({ sucesso: false, erro: 'Os dados de identificação são inválidos.' });

    const clientes = db.collection('clientes');
    const cliente = await clientes.findOne({ codigo });
    if (!cliente) return res.status(404).json({ sucesso: false, erro: 'Código de licença não encontrado.' });
    if (cliente.ativo !== 1) return res.status(403).json({ sucesso: false, erro: 'Esta licença está desativada. Entre em contato com o suporte.' });
    if (cliente.identificador_instalacao && cliente.identificador_instalacao !== identificador) return res.status(409).json({ sucesso: false, erro: 'Esta licença já está vinculada a outra instalação.' });

    const atualizacao = await clientes.updateOne(
        { id: cliente.id, ativo: 1, $or: [{ identificador_instalacao: null }, { identificador_instalacao: { $exists: false } }, { identificador_instalacao: identificador }] },
        { $set: { identificador_instalacao: identificador, ultima_validacao: agoraIso() } }
    );
    if (!atualizacao.matchedCount) return res.status(409).json({ sucesso: false, erro: 'Esta licença já está vinculada a outra instalação.' });

    const configuracoes = await db.collection('configuracoes').findOne({ cliente_id: cliente.id }, { projection: { _id: 0, tempo_inatividade: 1, protecao_ativa: 1, mensagem_titulo: 1, mensagem: 1, pix: 1, whatsapp: 1, atualizado_em: 1 } });
    if (!configuracoes) return res.status(500).json({ sucesso: false, erro: 'As configurações deste cliente não foram encontradas.' });
    console.log(`Licença validada: ${cliente.nome}`);
    res.json({ sucesso: true, mensagem: 'Licença validada com sucesso.', cliente: { codigo: cliente.codigo, nome: cliente.nome }, validado_em: agoraIso(), prazo_offline_dias: 30, configuracoes });
});

app.get('/api/status', (req, res) => res.json({ sucesso: true, mensagem: 'Servidor Interativa Gerenciador funcionando!' }));

app.get('/api/clientes', exigirLogin, async (req, res) => {
    const [clientes, configuracoes] = await Promise.all([
        db.collection('clientes').find({}, { projection: { _id: 0, id: 1, codigo: 1, nome: 1, computador: 1, ativo: 1, ultima_validacao: 1, identificador_instalacao: 1, criado_em: 1 } }).sort({ id: -1 }).toArray(),
        db.collection('configuracoes').find({}, { projection: { _id: 0, cliente_id: 1, tempo_inatividade: 1 } }).toArray()
    ]);
    const tempos = new Map(configuracoes.map((item) => [item.cliente_id, item.tempo_inatividade]));
    const agora = Date.now();
    res.json(clientes.map((cliente) => ({
        id: cliente.id,
        codigo: cliente.codigo,
        nome: cliente.nome,
        computador: cliente.computador,
        ativo: cliente.ativo,
        ultima_validacao: cliente.ultima_validacao,
        criado_em: cliente.criado_em,
        online: cliente.ultima_validacao && agora - new Date(cliente.ultima_validacao).getTime() <= 60000 ? 1 : 0,
        instalacao_vinculada: cliente.identificador_instalacao ? 1 : 0,
        tempo_inatividade: tempos.get(cliente.id) ?? null
    })));
});

app.post('/api/clientes', exigirAdministrador, async (req, res) => {
    const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    if (nome.length > 100) return res.status(400).json({ erro: 'O nome deve ter no máximo 100 caracteres.' });
    const codigo = crypto.randomUUID();
    const id = await proximoId(db, 'clientes');
    const criado_em = agoraIso();
    const cliente = { id, codigo, nome, computador: null, ativo: 1, criado_em, ultima_validacao: null, identificador_instalacao: null };
    try {
        await db.collection('clientes').insertOne(cliente);
        await db.collection('configuracoes').insertOne({ cliente_id: id, tempo_inatividade: 300, protecao_ativa: 1, mensagem_titulo: '', mensagem: '', pix: '', whatsapp: '', atualizado_em: criado_em });
    } catch (erro) {
        await db.collection('clientes').deleteOne({ id });
        throw erro;
    }
    console.log('Cliente cadastrado:', nome);
    res.status(201).json({ sucesso: true, mensagem: 'Cliente cadastrado com sucesso!', cliente: { id, codigo, nome } });
});

app.delete('/api/clientes/:id', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID de cliente inválido.' });

    const resultado = await executarTransacao(async (sessao) => {
        const clientes = db.collection('clientes');
        const cliente = await clientes.findOne({ id }, { session: sessao });
        if (!cliente) return null;

        await db.collection('configuracoes').deleteMany({ cliente_id: id }, { session: sessao });
        await db.collection('avisos').deleteMany({ cliente_id: id }, { session: sessao });
        await clientes.deleteOne({ id }, { session: sessao });
        return { nome: cliente.nome };
    });

    if (!resultado) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    console.log(`Cliente excluído: ${resultado.nome} (ID ${id})`);
    res.json({ sucesso: true, mensagem: `Cliente "${resultado.nome}" e seus dados vinculados foram excluídos.` });
});

app.patch('/api/clientes/:id/nome', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id); const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    if (!id) return res.status(400).json({ erro: 'ID do cliente inválido.' });
    if (!nome) return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    if (nome.length > 100) return res.status(400).json({ erro: 'O nome deve ter no máximo 100 caracteres.' });
    const resultado = await db.collection('clientes').updateOne({ id }, { $set: { nome } });
    if (!resultado.matchedCount) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Nome do cliente atualizado com sucesso!', cliente: { id, nome } });
});

app.patch('/api/clientes/:id/status', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id); const { ativo } = req.body;
    if (!id) return res.status(400).json({ erro: 'ID de cliente inválido.' });
    if (typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Informe se o cliente ficará ativo ou inativo.' });
    const resultado = await db.collection('clientes').updateOne({ id }, { $set: { ativo: ativo ? 1 : 0 } });
    if (!resultado.matchedCount) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    res.json({ sucesso: true, mensagem: ativo ? 'Cliente ativado com sucesso!' : 'Cliente desativado com sucesso!' });
});

app.post('/api/clientes/:id/liberar-instalacao', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID do cliente inválido.' });
    const cliente = await db.collection('clientes').findOne({ id });
    if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    if (cliente.ativo === 1) return res.status(409).json({ erro: 'Desative a licença antes de liberar a instalação.' });
    if (!cliente.identificador_instalacao) return res.json({ sucesso: true, mensagem: 'Esta licença já está sem instalação vinculada.' });
    await db.collection('clientes').updateOne({ id }, { $set: { identificador_instalacao: null } });
    res.json({ sucesso: true, mensagem: 'Instalação liberada! A licença poderá ser ativada em outro computador.' });
});

app.patch('/api/clientes/:id/tempo', exigirAdministrador, async (req, res) => {
    const id = idNumerico(req.params.id); const tempo = req.body.tempo;
    if (!id) return res.status(400).json({ erro: 'ID do cliente inválido.' });
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 3600) return res.status(400).json({ erro: 'O tempo deve estar entre 30 e 3600 segundos.' });
    if (!await db.collection('clientes').findOne({ id }, { projection: { _id: 1 } })) return res.status(404).json({ erro: 'Cliente não encontrado.' });
    await db.collection('configuracoes').updateOne({ cliente_id: id }, { $set: { tempo_inatividade: tempo, atualizado_em: agoraIso() }, $setOnInsert: { protecao_ativa: 1, mensagem_titulo: '', mensagem: '', pix: '', whatsapp: '' } }, { upsert: true });
    res.json({ sucesso: true, mensagem: 'Tempo de inatividade salvo com sucesso!' });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'painel', 'index.html')));

app.use((erro, req, res, next) => {
    console.error('Erro na solicitação:', erro);
    if (res.headersSent) return next(erro);
    const status = erro?.status === 413 ? 413 : 500;
    res.status(status).json({ erro: status === 413 ? 'O arquivo excede o limite de 50 MB.' : 'O servidor não conseguiu concluir a solicitação.' });
});

async function iniciarServidor() {
    db = await conectarBanco();
    await db.collection('sistema_configuracoes').updateOne(
        { _id: 1 },
        { $setOnInsert: { endereco_servidor: 'localhost', porta_servidor: 3022, atualizado_em: agoraIso() } },
        { upsert: true }
    );
    const servidor = app.listen(PORT, HOST, () => {
        console.log('====================================');
        console.log(' INTERATIVA GERENCIADOR');
        console.log('====================================');
        console.log(`Banco: MongoDB (${process.env.MONGODB_DB || 'interativa_gerenciador'})`);
        console.log(`Painel: http://localhost:${PORT}`);
        console.log('Aguardando conexões...');
    });
    const encerrar = async () => {
        servidor.close(async () => { await fecharBanco(); process.exit(0); });
    };
    process.once('SIGINT', encerrar);
    process.once('SIGTERM', encerrar);
}

iniciarServidor().catch((erro) => {
    console.error('Não foi possível iniciar o servidor MongoDB:', erro.message);
    process.exitCode = 1;
});
