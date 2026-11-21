const { MongoClient } = require('mongodb');

let cliente;
let conexaoEmCurso;

async function conectarBanco() {
    if (cliente) return cliente.db(process.env.MONGODB_DB || 'interativa_gerenciador');
    if (conexaoEmCurso) return conexaoEmCurso;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI não configurada. Crie o arquivo .env usando .env.example como modelo.');
    }

    conexaoEmCurso = (async () => {
        cliente = new MongoClient(uri, {
            appName: 'InterativaGerenciador',
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 10000
        });
        await cliente.connect();
        const db = cliente.db(process.env.MONGODB_DB || 'interativa_gerenciador');
        await prepararIndices(db);
        return db;
    })();

    try {
        return await conexaoEmCurso;
    } catch (erro) {
        cliente = undefined;
        conexaoEmCurso = undefined;
        throw erro;
    }
}

async function prepararIndices(db) {
    await db.collection('clientes').createIndex({ id: 1 }, { unique: true });
    await db.collection('clientes').createIndex({ codigo: 1 }, { unique: true });
    await db.collection('clientes').createIndex({ ultima_validacao: 1 });
    await db.collection('configuracoes').createIndex({ cliente_id: 1 }, { unique: true });
    await db.collection('usuarios').createIndex({ id: 1 }, { unique: true });
    await db.collection('usuarios').createIndex({ usuario_normalizado: 1 }, { unique: true });
    await db.collection('usuarios').createIndex(
        { administrador_inicial: 1 },
        { unique: true, partialFilterExpression: { administrador_inicial: true } }
    );
    await db.collection('sessoes').createIndex({ usuario_id: 1 });
    await db.collection('sessoes').createIndex({ expira_em: 1 }, { expireAfterSeconds: 0 });
    await db.collection('avisos').createIndex({ cliente_id: 1, criado_em: -1 });
}

async function proximoId(db, colecao) {
    const resultado = await db.collection('sequencias').findOneAndUpdate(
        { _id: colecao },
        { $inc: { valor: 1 } },
        { upsert: true, returnDocument: 'after' }
    );
    const documento = resultado?.value || resultado;
    return documento.valor;
}

async function fecharBanco() {
    if (cliente) await cliente.close();
    cliente = undefined;
    conexaoEmCurso = undefined;
}

module.exports = { conectarBanco, proximoId, fecharBanco };
