const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Cria a pasta de dados do sistema, se não existir.
const pastaDados = path.join(__dirname, 'dados');

if (!fs.existsSync(pastaDados)) {
    fs.mkdirSync(pastaDados, { recursive: true });
}

// Cria ou abre o banco de dados SQLite.
const db = new Database(
    path.join(pastaDados, 'interativa.db')
);

// Configura o banco de dados.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Tabela de clientes.
db.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE NOT NULL,
        nome TEXT NOT NULL,
        computador TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

// Tabela de configurações e mensagens de cada cliente.
db.exec(`
    CREATE TABLE IF NOT EXISTS configuracoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL UNIQUE,
        tempo_inatividade INTEGER NOT NULL DEFAULT 300,
        protecao_ativa INTEGER NOT NULL DEFAULT 1,
        mensagem_titulo TEXT DEFAULT '',
        mensagem TEXT DEFAULT '',
        pix TEXT DEFAULT '',
        whatsapp TEXT DEFAULT '',
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (cliente_id)
            REFERENCES clientes(id)
            ON DELETE CASCADE
    );
`);

// Tabela de avisos enviados aos clientes.
db.exec(`
    CREATE TABLE IF NOT EXISTS avisos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        titulo TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (cliente_id)
            REFERENCES clientes(id)
            ON DELETE CASCADE
    );
`);

// Configurações gerais do Interativa Gerenciador.
db.exec(`
    CREATE TABLE IF NOT EXISTS sistema_configuracoes (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        endereco_servidor TEXT NOT NULL DEFAULT '100.97.41.23',
        porta_servidor INTEGER NOT NULL DEFAULT 3000,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

// Cria a configuração inicial, caso ainda não exista.
db.prepare(`
    INSERT OR IGNORE INTO sistema_configuracoes (
        id,
        endereco_servidor,
        porta_servidor
    )
    VALUES (1, '100.97.41.23', 3000)
`).run();

/*
 * Preparação do sistema de licenças.
 * Adiciona os campos somente se ainda não existirem.
 * Preserva os clientes e as configurações já cadastrados.
 */

function adicionarColunaSeNaoExistir(tabela, coluna, definicao) {
    const colunas = db.prepare(
        `PRAGMA table_info(${tabela})`
    ).all();

    const existe = colunas.some(
        (item) => item.name === coluna
    );

    if (!existe) {
        db.exec(
            `ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`
        );

        console.log(`Coluna adicionada: ${tabela}.${coluna}`);
    }
}

adicionarColunaSeNaoExistir(
    'clientes',
    'ultima_validacao',
    'TEXT'
);

adicionarColunaSeNaoExistir(
    'clientes',
    'identificador_instalacao',
    'TEXT'
);

console.log('Banco de dados inicializado com sucesso!');

// Exporta a conexão para uso no servidor.
module.exports = db;

// Contas de acesso ao painel administrativo. Senhas nunca são armazenadas em texto puro.
db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
        senha_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        perfil TEXT NOT NULL CHECK (perfil IN ('admin', 'comum')),
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessoes (
        id TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL,
        expira_em INTEGER NOT NULL,
        FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
    );
`);
db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Date.now());
