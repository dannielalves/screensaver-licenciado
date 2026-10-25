const express = require('express');
const path = require('path');IG
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = 3000;

// Autenticação por sessão armazenada no SQLite.
const DURACAO_SESSAO_MS = 8 * 60 * 60 * 1000;
const COOKIE_SESSAO = 'interativa_sessao';

function lerCookie(req, nome) {
    const cookies = (req.headers.cookie || '').split(';');
    const item = cookies.map((v) => v.trim()).find((v) => v.startsWith(nome + '='));
    return item ? decodeURIComponent(item.slice(nome.length + 1)) : '';
}

function criarHashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
    return { salt, hash };
}

function obterUsuarioDaSessao(req) {
    const idSessao = lerCookie(req, COOKIE_SESSAO);
    if (!/^[a-f0-9]{64}$/.test(idSessao)) return null;
    const agora = Date.now();
    db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(agora);
    return db.prepare(`
        SELECT usuarios.id, usuarios.nome, usuarios.usuario, usuarios.perfil
        FROM sessoes JOIN usuarios ON usuarios.id = sessoes.usuario_id
        WHERE sessoes.id = ? AND sessoes.expira_em > ? AND usuarios.ativo = 1
    `).get(idSessao, agora) || null;
}

function exigirLogin(req, res, next) {
    req.usuario = obterUsuarioDaSessao(req);
    if (!req.usuario) return res.status(401).json({ erro: 'Sua sessão expirou. Entre novamente.' });
    next();
}

function exigirAdministrador(req, res, next) {
    exigirLogin(req, res, () => {
        if (req.usuario.perfil !== 'admin') {
            return res.status(403).json({ erro: 'Esta ação é permitida somente ao administrador.' });
        }
        next();
    });
}

function definirCookieSessao(res, id) {
    const seguro = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_SESSAO}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(DURACAO_SESSAO_MS / 1000)}${seguro}`);
}

// Permite receber dados no formato JSON.
app.use(express.json());

// Primeira configuração: somente possível quando ainda não existe nenhuma conta.
app.get('/api/auth/status', (req, res) => {
    const quantidade = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
    const usuario = obterUsuarioDaSessao(req);
    res.json({ configuracaoInicial: quantidade === 0, autenticado: Boolean(usuario), usuario });
});

app.post('/api/auth/setup', (req, res) => {
    const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (nome.length < 2 || nome.length > 100 || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario) || senha.length < 10 || senha.length > 200) {
        return res.status(400).json({ erro: 'Informe nome, usuário (3 a 40 caracteres) e senha com pelo menos 10 caracteres.' });
    }
    try {
        const hash = criarHashSenha(senha);
        const criarPrimeiro = db.transaction(() => {
            if (db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total !== 0) return null;
            return db.prepare(`INSERT INTO usuarios (nome, usuario, senha_hash, salt, perfil) VALUES (?, ?, ?, ?, 'admin')`).run(nome, usuario, hash.hash, hash.salt).lastInsertRowid;
        });
        const idUsuario = criarPrimeiro();
        if (!idUsuario) return res.status(409).json({ erro: 'A configuração inicial já foi concluída. Faça login.' });
        const idSessao = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessoes (id, usuario_id, expira_em) VALUES (?, ?, ?)').run(idSessao, idUsuario, Date.now() + DURACAO_SESSAO_MS);
        definirCookieSessao(res, idSessao);
        res.status(201).json({ sucesso: true, usuario: { id: idUsuario, nome, usuario, perfil: 'admin' } });
    } catch (erro) {
        if (String(erro.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ erro: 'Esse nome de usuário já está em uso.' });
        console.error('Erro na configuração inicial:', erro);
        res.status(500).json({ erro: 'Não foi possível criar o administrador.' });
    }
});

app.post('/api/auth/login', (req, res) => {
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const conta = db.prepare('SELECT * FROM usuarios WHERE usuario = ? COLLATE NOCASE AND ativo = 1').get(usuario);
    if (!conta || senha.length > 200) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    const hash = crypto.scryptSync(senha, conta.salt, 64).toString('hex');
    const a = Buffer.from(hash, 'hex'); const b = Buffer.from(conta.senha_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    const idSessao = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessoes (id, usuario_id, expira_em) VALUES (?, ?, ?)').run(idSessao, conta.id, Date.now() + DURACAO_SESSAO_MS);
    definirCookieSessao(res, idSessao);
    res.json({ sucesso: true, usuario: { id: conta.id, nome: conta.nome, usuario: conta.usuario, perfil: conta.perfil } });
});

app.post('/api/auth/logout', (req, res) => {
    const idSessao = lerCookie(req, COOKIE_SESSAO);
    if (idSessao) db.prepare('DELETE FROM sessoes WHERE id = ?').run(idSessao);
    res.setHeader('Set-Cookie', `${COOKIE_SESSAO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ sucesso: true });
});

app.get('/api/auth/me', exigirLogin, (req, res) => res.json({ usuario: req.usuario }));

// Gestão de contas, exclusiva para administradores.
app.get('/api/usuarios', exigirAdministrador, (req, res) => {
    res.json(db.prepare('SELECT id, nome, usuario, perfil, ativo, criado_em FROM usuarios ORDER BY id').all());
});
app.post('/api/usuarios', exigirAdministrador, (req, res) => {
    const nome = typeof req.body.nome === 'string' ? req.body.nome.trim() : '';
    const usuario = typeof req.body.usuario === 'string' ? req.body.usuario.trim() : '';
    const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    const perfil = req.body.perfil === 'admin' ? 'admin' : 'comum';
    if (nome.length < 2 || nome.length > 100 || !/^[a-zA-Z0-9._-]{3,40}$/.test(usuario) || senha.length < 10 || senha.length > 200) return res.status(400).json({ erro: 'Confira os dados. A senha deve ter pelo menos 10 caracteres.' });
    const hash = criarHashSenha(senha);
    try {
        const id = db.prepare('INSERT INTO usuarios (nome, usuario, senha_hash, salt, perfil) VALUES (?, ?, ?, ?, ?)').run(nome, usuario, hash.hash, hash.salt, perfil).lastInsertRowid;
        res.status(201).json({ sucesso: true, id });
    } catch (erro) {
        if (String(erro.code).includes('SQLITE_CONSTRAINT')) return res.status(409).json({ erro: 'Esse nome de usuário já está em uso.' });
        console.error(erro); res.status(500).json({ erro: 'Não foi possível criar a conta.' });
    }
});
app.patch('/api/usuarios/:id/status', exigirAdministrador, (req, res) => {
    const id = Number(req.params.id); const ativo = req.body.ativo;
    if (!Number.isInteger(id) || id < 1 || typeof ativo !== 'boolean') return res.status(400).json({ erro: 'Dados inválidos.' });
    if (id === req.usuario.id && !ativo) return res.status(400).json({ erro: 'Você não pode desativar a própria conta.' });
    const result = db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo ? 1 : 0, id);
    if (!result.changes) return res.status(404).json({ erro: 'Conta não encontrada.' });
    if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    res.json({ sucesso: true });
});
app.put('/api/usuarios/:id/senha', exigirAdministrador, (req, res) => {
    const id = Number(req.params.id); const senha = typeof req.body.senha === 'string' ? req.body.senha : '';
    if (!Number.isInteger(id) || id < 1 || senha.length < 10 || senha.length > 200) return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 10 caracteres.' });
    const hash = criarHashSenha(senha);
    const result = db.prepare('UPDATE usuarios SET senha_hash = ?, salt = ? WHERE id = ?').run(hash.hash, hash.salt, id);
    if (!result.changes) return res.status(404).json({ erro: 'Conta não encontrada.' });
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
    res.json({ sucesso: true });
});

// Disponibiliza os arquivos do painel.
app.use(express.static(path.join(__dirname, '..', 'painel')));

/**
 * Consulta a configuração de conexão do servidor.
 */
app.get('/api/configuracao-servidor', exigirLogin, (req, res) => {
    try {
        const configuracao = db.prepare(`
            SELECT
                endereco_servidor,
                porta_servidor,
                atualizado_em
            FROM sistema_configuracoes
            WHERE id = 1
        `).get();

        if (!configuracao) {
            return res.status(404).json({
                erro: 'Configuração do servidor não encontrada.'
            });
        }

        res.json(configuracao);
    } catch (erro) {
        console.error('Erro ao consultar configuração:', erro);

        res.status(500).json({
            erro: 'Não foi possível consultar a configuração.'
        });
    }
});

/**
 * Atualiza o endereço e a porta do servidor.
 */
app.put(
    '/api/configuracao-servidor',
    exigirAdministrador,
    (req, res) => {

    try {
        const endereco = typeof req.body.endereco === 'string'
            ? req.body.endereco.trim()
            : '';

        const porta = req.body.porta;

        if (
            !endereco ||
            endereco.length > 253 ||
            /[\s/\\?#@]/.test(endereco)
        ) {
            return res.status(400).json({
                erro: 'Informe um IP ou nome de computador válido.'
            });
        }

        if (
            !Number.isInteger(porta) ||
            porta < 1 ||
            porta > 65535
        ) {
            return res.status(400).json({
                erro: 'A porta deve estar entre 1 e 65535.'
            });
        }

        db.prepare(`
            UPDATE sistema_configuracoes
            SET
                endereco_servidor = ?,
                porta_servidor = ?,
                atualizado_em = CURRENT_TIMESTAMP
            WHERE id = 1
        `).run(endereco, porta);

        res.json({
            sucesso: true,
            mensagem: 'Configuração do servidor salva com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao salvar configuração:', erro);

        res.status(500).json({
            erro: 'Não foi possível salvar a configuração.'
        });
    }
});

// Verifica se o servidor está funcionando.

/**
 * Valida a licença de um cliente e envia suas configurações.
 *
 * O aplicativo precisa enviar:
 * - codigo: código exclusivo do cliente.
 * - identificador_instalacao: identificador persistente desta instalação.
 */
app.post('/api/licenca/validar', (req, res) => {
    try {
        const codigo = typeof req.body.codigo === 'string'
            ? req.body.codigo.trim()
            : '';

        const identificador = typeof req.body.identificador_instalacao === 'string'
            ? req.body.identificador_instalacao.trim()
            : '';

        if (!codigo || !identificador) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Informe o código do cliente e o identificador da instalação.'
            });
        }

        if (codigo.length > 100 || identificador.length > 200) {
            return res.status(400).json({
                sucesso: false,
                erro: 'Os dados de identificação são inválidos.'
            });
        }

        // Busca o cliente pelo código exclusivo.
        const cliente = db.prepare(`
            SELECT
                id,
                codigo,
                nome,
                ativo,
                identificador_instalacao
            FROM clientes
            WHERE codigo = ?
        `).get(codigo);

        if (!cliente) {
            return res.status(404).json({
                sucesso: false,
                erro: 'Código de licença não encontrado.'
            });
        }

        if (cliente.ativo !== 1) {
            return res.status(403).json({
                sucesso: false,
                erro: 'Esta licença está desativada. Entre em contato com o suporte.'
            });
        }

        // Impede que o mesmo código seja usado por outra instalação.
        if (
            cliente.identificador_instalacao &&
            cliente.identificador_instalacao !== identificador
        ) {
            return res.status(409).json({
                sucesso: false,
                erro: 'Esta licença já está vinculada a outra instalação.'
            });
        }

        // Registra a instalação e a data da validação.
        const validarLicenca = db.transaction(() => {
            db.prepare(`
                UPDATE clientes
                SET
                    identificador_instalacao = ?,
                    ultima_validacao = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(identificador, cliente.id);

            // Obtém as configurações personalizadas do cliente.
            return db.prepare(`
                SELECT
                    tempo_inatividade,
                    protecao_ativa,
                    mensagem_titulo,
                    mensagem,
                    pix,
                    whatsapp,
                    atualizado_em
                FROM configuracoes
                WHERE cliente_id = ?
            `).get(cliente.id);
        });

        const configuracoes = validarLicenca();

        if (!configuracoes) {
            return res.status(500).json({
                sucesso: false,
                erro: 'As configurações deste cliente não foram encontradas.'
            });
        }

        console.log(
            `Licença validada: ${cliente.nome}`
        );

        return res.json({
            sucesso: true,
            mensagem: 'Licença validada com sucesso.',
            cliente: {
                codigo: cliente.codigo,
                nome: cliente.nome
            },
            validado_em: new Date().toISOString(),
            prazo_offline_dias: 30,
            configuracoes
        });
    } catch (erro) {
        console.error('Erro ao validar licença:', erro);

        return res.status(500).json({
            sucesso: false,
            erro: 'Não foi possível validar a licença.'
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        sucesso: true,
        mensagem: 'Servidor Interativa Gerenciador funcionando!'
    });
});

// Lista todos os clientes.
app.get('/api/clientes', exigirLogin, (req, res) => {
    try {
        const clientes = db.prepare(`
            SELECT
                clientes.id,
                clientes.codigo,
                clientes.nome,
                clientes.computador,
                clientes.ativo,
                clientes.ultima_validacao,
                CASE
                    WHEN clientes.ultima_validacao IS NOT NULL
                        AND datetime(clientes.ultima_validacao)
                            >= datetime('now', '-60 seconds')
                    THEN 1
                    ELSE 0
                END AS online,                

                CASE
                    WHEN clientes.identificador_instalacao IS NOT NULL
                        AND clientes.identificador_instalacao != ''
                    THEN 1
                    ELSE 0
                END AS instalacao_vinculada,

                clientes.criado_em,
                configuracoes.tempo_inatividade
            FROM clientes
            LEFT JOIN configuracoes
                ON configuracoes.cliente_id = clientes.id
            ORDER BY clientes.id DESC
        `).all();

        res.json(clientes);
    } catch (erro) {
        console.error('Erro ao listar clientes:', erro);

        res.status(500).json({
            erro: 'Não foi possível listar os clientes.'
        });
    }
});

// Cadastra um novo cliente.
app.post('/api/clientes', exigirAdministrador, (req, res) => {
    try {
        const nome = typeof req.body.nome === 'string'
            ? req.body.nome.trim()
            : '';

        if (!nome) {
            return res.status(400).json({
                erro: 'Informe o nome do cliente.'
            });
        }

        if (nome.length > 100) {
            return res.status(400).json({
                erro: 'O nome deve ter no máximo 100 caracteres.'
            });
        }

        // Gera um código único para identificar o cliente.
        const codigo = crypto.randomUUID();

        // Cadastra o cliente e suas configurações iniciais.
        const cadastrarCliente = db.transaction(() => {
            const resultado = db.prepare(`
                INSERT INTO clientes (codigo, nome)
                VALUES (?, ?)
            `).run(codigo, nome);

            const clienteId = resultado.lastInsertRowid;

            db.prepare(`
                INSERT INTO configuracoes (cliente_id)
                VALUES (?)
            `).run(clienteId);

            return {
                id: clienteId,
                codigo,
                nome
            };
        });

        const cliente = cadastrarCliente();

        console.log('Cliente cadastrado:', cliente.nome);

        return res.status(201).json({
            sucesso: true,
            mensagem: 'Cliente cadastrado com sucesso!',
            cliente
        });
    } catch (erro) {
        console.error('Erro ao cadastrar cliente:', erro);

        return res.status(500).json({
            erro: 'Não foi possível cadastrar o cliente.'
        });
    }
});

/**
 * Atualiza o nome de um cliente cadastrado.
 */
app.patch(
    '/api/clientes/:id/nome',
    exigirAdministrador,
    (req, res) => {
        try {
            const id = Number(req.params.id);

            const nome = typeof req.body.nome === 'string'
                ? req.body.nome.trim()
                : '';

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    erro: 'ID do cliente inválido.'
                });
            }

            if (!nome) {
                return res.status(400).json({
                    erro: 'Informe o nome do cliente.'
                });
            }

            if (nome.length > 100) {
                return res.status(400).json({
                    erro: 'O nome deve ter no máximo 100 caracteres.'
                });
            }

            const resultado = db.prepare(`
                UPDATE clientes
                SET nome = ?
                WHERE id = ?
            `).run(nome, id);

            if (resultado.changes === 0) {
                return res.status(404).json({
                    erro: 'Cliente não encontrado.'
                });
            }

            console.log(`Nome do cliente atualizado: ${nome}`);

            return res.json({
                sucesso: true,
                mensagem: 'Nome do cliente atualizado com sucesso!',
                cliente: {
                    id,
                    nome
                }
            });
        } catch (erro) {
            console.error('Erro ao atualizar nome:', erro);

            return res.status(500).json({
                erro: 'Não foi possível atualizar o nome do cliente.'
            });
        }
    }
);

// Ativa ou desativa um cliente.
app.patch(
    '/api/clientes/:id/status',
    exigirAdministrador,
    (req, res) => {
    try {
        const id = Number(req.params.id);
        const { ativo } = req.body;

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: 'ID de cliente inválido.'
            });
        }

        if (typeof ativo !== 'boolean') {
            return res.status(400).json({
                erro: 'Informe se o cliente ficará ativo ou inativo.'
            });
        }

        const resultado = db.prepare(`
            UPDATE clientes
            SET ativo = ?
            WHERE id = ?
        `).run(ativo ? 1 : 0, id);

        if (resultado.changes === 0) {
            return res.status(404).json({
                erro: 'Cliente não encontrado.'
            });
        }

        res.json({
            sucesso: true,
            mensagem: ativo
                ? 'Cliente ativado com sucesso!'
                : 'Cliente desativado com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao alterar status:', erro);

        res.status(500).json({
            erro: 'Não foi possível alterar o status do cliente.'
        });
    }
});

// Libera a instalação vinculada a uma licença desativada.
app.post(
    '/api/clientes/:id/liberar-instalacao',
    exigirAdministrador,
    (req, res) => {
        try {
            const id = Number(req.params.id);

            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({
                    erro: 'ID do cliente inválido.'
                });
            }

            const cliente = db.prepare(`
                SELECT
                    id,
                    nome,
                    ativo,
                    identificador_instalacao
                FROM clientes
                WHERE id = ?
            `).get(id);

            if (!cliente) {
                return res.status(404).json({
                    erro: 'Cliente não encontrado.'
                });
            }

            if (cliente.ativo === 1) {
                return res.status(409).json({
                    erro: 'Desative a licença antes de liberar a instalação.'
                });
            }

            if (!cliente.identificador_instalacao) {
                return res.json({
                    sucesso: true,
                    mensagem: 'Esta licença já está sem instalação vinculada.'
                });
            }

            db.prepare(`
                UPDATE clientes
                SET identificador_instalacao = NULL
                WHERE id = ?
            `).run(id);

            console.log(
                `Instalação liberada para o cliente: ${cliente.nome}`
            );

            return res.json({
                sucesso: true,
                mensagem: 'Instalação liberada! A licença poderá ser ativada em outro computador.'
            });
        } catch (erro) {
            console.error(
                'Erro ao liberar instalação:',
                erro
            );

            return res.status(500).json({
                erro: 'Não foi possível liberar a instalação.'
            });
        }
    }
);

// Atualiza o tempo de inatividade de um cliente.
app.patch(
    '/api/clientes/:id/tempo',
    exigirAdministrador,
    (req, res) => {
    try {
        const id = Number(req.params.id);
        const tempo = req.body.tempo;

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                erro: 'ID do cliente inválido.'
            });
        }

        if (
            !Number.isInteger(tempo) ||
            tempo < 30 ||
            tempo > 3600
        ) {
            return res.status(400).json({
                erro: 'O tempo deve estar entre 30 e 3600 segundos.'
            });
        }

        const cliente = db.prepare(`
            SELECT id FROM clientes WHERE id = ?
        `).get(id);

        if (!cliente) {
            return res.status(404).json({
                erro: 'Cliente não encontrado.'
            });
        }

        db.prepare(`
            INSERT INTO configuracoes (
                cliente_id,
                tempo_inatividade
            )
            VALUES (?, ?)
            ON CONFLICT(cliente_id)
            DO UPDATE SET
                tempo_inatividade = excluded.tempo_inatividade,
                atualizado_em = CURRENT_TIMESTAMP
        `).run(id, tempo);

        res.json({
            sucesso: true,
            mensagem: 'Tempo de inatividade salvo com sucesso!'
        });
    } catch (erro) {
        console.error('Erro ao salvar tempo:', erro);

        res.status(500).json({
            erro: 'Não foi possível salvar o tempo.'
        });
    }
});

// Abre a página principal do painel.
app.get('/', (req, res) => {
    res.sendFile(
        path.join(__dirname, '..', 'painel', 'index.html')
    );
});

// Inicia o servidor.
app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log(' INTERATIVA GERENCIADOR');
    console.log('====================================');
    console.log(`Painel: http://localhost:${PORT}`);
    console.log('Aguardando conexões...');
});