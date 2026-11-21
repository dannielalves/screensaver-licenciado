require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { conectarBanco, fecharBanco } = require('../servidor/database');

const origem = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, '..', 'servidor', 'dados', 'interativa.db'));
const aplicar = process.argv.includes('--apply');

function lerTabela(sqlite, tabela) {
    const existe = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tabela);
    return existe ? sqlite.prepare(`SELECT * FROM ${tabela}`).all() : [];
}

function maiorId(linhas, campo = 'id') {
    return linhas.reduce((maior, linha) => Math.max(maior, Number(linha[campo]) || 0), 0);
}

async function substituirColecao(colecao, documentos) {
    if (!documentos.length) return;
    await colecao.bulkWrite(documentos.map((documento) => ({
        replaceOne: { filter: { _id: documento._id }, replacement: documento, upsert: true }
    })), { ordered: true });
}

async function principal() {
    if (!fs.existsSync(origem)) throw new Error(`Banco SQLite não encontrado em: ${origem}`);
    const sqlite = new DatabaseSync(origem, { readOnly: true });
    let mongo;
    try {
        const clientes = lerTabela(sqlite, 'clientes');
        const configuracoes = lerTabela(sqlite, 'configuracoes');
        const avisos = lerTabela(sqlite, 'avisos');
        const sistema = lerTabela(sqlite, 'sistema_configuracoes');
        const usuarios = lerTabela(sqlite, 'usuarios');
        const sessoes = lerTabela(sqlite, 'sessoes');
        console.log(`Origem: ${origem}`);
        console.log(`Encontrados: ${clientes.length} licenças, ${configuracoes.length} configurações, ${avisos.length} avisos, ${usuarios.length} usuários e ${sessoes.length} sessões.`);
        if (!aplicar) {
            console.log('Prévia concluída. Nenhum dado foi gravado. Use npm run migrate:sqlite -- --apply para importar.');
            return;
        }

        const db = await conectarBanco();
        mongo = db;
        const estado = await db.collection('migracoes').findOne({ _id: 'sqlite-interativa-v1' });
        const colecoes = ['clientes', 'configuracoes', 'avisos', 'usuarios', 'sessoes'];
        const temDados = await Promise.all(colecoes.map((nome) => db.collection(nome).countDocuments()));
        if (temDados.some(Boolean) && !estado) {
            throw new Error('O banco Atlas de destino já tem dados. A importação foi interrompida para evitar sobrescrita.');
        }
        if (estado && estado.origem !== origem) throw new Error(`Há uma migração parcial iniciada por outro arquivo SQLite: ${estado.origem}`);

        await db.collection('migracoes').updateOne(
            { _id: 'sqlite-interativa-v1' },
            { $setOnInsert: { origem, iniciada_em: new Date(), concluida: false } },
            { upsert: true }
        );

        await substituirColecao(db.collection('clientes'), clientes.map((row) => ({
            ...row, _id: String(row.id), id: Number(row.id), ativo: Number(row.ativo),
            ultima_validacao: row.ultima_validacao || null,
            identificador_instalacao: row.identificador_instalacao || null
        })));
        await substituirColecao(db.collection('configuracoes'), configuracoes.map((row) => ({
            ...row, _id: String(row.cliente_id), cliente_id: Number(row.cliente_id)
        })));
        await substituirColecao(db.collection('avisos'), avisos.map((row) => ({ ...row, _id: String(row.id), id: Number(row.id), cliente_id: Number(row.cliente_id) })));
        await substituirColecao(db.collection('sistema_configuracoes'), sistema.map((row) => ({ ...row, _id: Number(row.id) })));

        const administrador = usuarios.find((row) => row.perfil === 'admin');
        await substituirColecao(db.collection('usuarios'), usuarios.map((row) => ({
            ...row, _id: String(row.id), id: Number(row.id), ativo: Number(row.ativo),
            usuario_normalizado: String(row.usuario).toLowerCase(),
            administrador_inicial: administrador ? Number(row.id) === Number(administrador.id) : false
        })));
        await substituirColecao(db.collection('sessoes'), sessoes.map((row) => ({
            _id: String(row.id), usuario_id: Number(row.usuario_id), expira_em: new Date(Number(row.expira_em))
        })));

        for (const [nome, linhas] of [['clientes', clientes], ['usuarios', usuarios], ['avisos', avisos]]) {
            await db.collection('sequencias').updateOne(
                { _id: nome }, { $max: { valor: maiorId(linhas) } }, { upsert: true }
            );
        }
        await db.collection('migracoes').updateOne({ _id: 'sqlite-interativa-v1' }, { $set: { concluida: true, concluida_em: new Date() } });
        console.log('Migração concluída. O SQLite de origem foi mantido sem alterações.');
    } finally {
        sqlite.close();
        if (mongo) await fecharBanco();
    }
}

principal().catch((erro) => {
    console.error('Migração não concluída:', erro.message);
    process.exitCode = 1;
});
