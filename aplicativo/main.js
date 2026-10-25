const {
    app,
    BrowserWindow,
    screen,
    ipcMain,
    powerMonitor
} = require('electron');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ==========================================
// PERMITE APENAS UMA INSTÂNCIA DO APLICATIVO
// ==========================================

const bloqueioInstancia = app.requestSingleInstanceLock();

if (!bloqueioInstancia) {
    console.log(
        'O Interativa Gerenciador já está em execução.'
    );

    app.quit();
}


const DIAS_OFFLINE = 30;
const MILISSEGUNDOS_DIA = 24 * 60 * 60 * 1000;
const INTERVALO_INATIVIDADE = 1000;

let janelasProtecao = [];
let janelaAtivacao = null;

let licenca = null;
let sincronizando = false;
let encerrando = false;
let fechandoProtecao = false;
let monitoramentoIniciado = false;
let ultimaPosicaoMouse = null;
let intervaloMouse = null;
let intervaloInatividade = null;
let intervaloSincronizacao = null;

// Se o usuário tentar abrir o programa novamente,
// mantém a instância original em execução.
app.on('second-instance', () => {
    if (janelaAtivacao && !janelaAtivacao.isDestroyed()) {
        janelaAtivacao.show();
        janelaAtivacao.focus();
        return;
    }

    // Se a proteção estiver aberta, mantém suas janelas
    // existentes sem criar outras.
    for (const janela of janelasProtecao) {
        if (!janela.isDestroyed()) {
            janela.focus();
        }
    }

    console.log(
        'Nova tentativa de abertura bloqueada.'
    );
});


const arquivoLicenca = () => path.join(
    app.getPath('userData'),
    'licenca.json'
);

// Arquivo permanente que identifica esta instalação.
const arquivoIdentificadorInstalacao = () => path.join(
    app.getPath('userData'),
    'identificador-instalacao.txt'
);

// Obtém o identificador existente ou cria um novo.
function obterIdentificadorInstalacao() {
    const arquivo = arquivoIdentificadorInstalacao();

    try {
        if (fs.existsSync(arquivo)) {
            const identificador = fs.readFileSync(
                arquivo,
                'utf8'
            ).trim();

            if (identificador) {
                return identificador;
            }
        }

        const identificador = crypto.randomUUID();

        fs.mkdirSync(path.dirname(arquivo), {
            recursive: true
        });

        fs.writeFileSync(
            arquivo,
            identificador,
            'utf8'
        );

        return identificador;
    } catch (erro) {
        console.error(
            'Erro ao obter identificador da instalação:',
            erro
        );

        throw new Error(
            'Não foi possível identificar este computador.'
        );
    }
}

function lerLicencaLocal() {
    try {
        const arquivo = arquivoLicenca();

        if (!fs.existsSync(arquivo)) {
            return null;
        }

        return JSON.parse(
            fs.readFileSync(arquivo, 'utf8')
        );
    } catch (erro) {
        console.error('Erro ao ler licença local:', erro);
        return null;
    }
}

function salvarLicencaLocal(dados) {
    const pasta = app.getPath('userData');

    fs.mkdirSync(pasta, { recursive: true });

    const temporario = arquivoLicenca() + '.tmp';

    fs.writeFileSync(
        temporario,
        JSON.stringify(dados, null, 2),
        'utf8'
    );

    fs.renameSync(temporario, arquivoLicenca());
}

function removerLicencaLocal() {
    try {
        fs.rmSync(arquivoLicenca(), { force: true });
    } catch (erro) {
        console.error('Erro ao remover licença:', erro);
    }
}

function licencaDentroDoPrazo(dados) {
    if (
        !dados ||
        !dados.codigo ||
        !dados.identificadorInstalacao ||
        !dados.servidor ||
        !dados.ultimaValidacao
    ) {
        return false;
    }

    const ultimaValidacao = Date.parse(
        dados.ultimaValidacao
    );

    if (!Number.isFinite(ultimaValidacao)) {
        return false;
    }

    const agora = Date.now();

    if (ultimaValidacao > agora + 5 * 60 * 1000) {
        return false;
    }

    return (
        agora - ultimaValidacao <
        DIAS_OFFLINE * MILISSEGUNDOS_DIA
    );
}

async function solicitarValidacao(
    servidor,
    codigo,
    identificadorInstalacao
) {
    const endereco = new URL(
        '/api/licenca/validar',
        servidor
    );

    const resposta = await fetch(endereco, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            codigo,
            identificador_instalacao: identificadorInstalacao
        }),
        signal: AbortSignal.timeout(10000)
    });

    let resultado;

    try {
        resultado = await resposta.json();
    } catch {
        throw new Error(
            'O servidor retornou uma resposta inválida.'
        );
    }

    if (!resposta.ok || !resultado.sucesso) {
        const erro = new Error(
            resultado.erro ||
            'Não foi possível validar a licença.'
        );

        erro.status = resposta.status;

        throw erro;
    }

    return resultado;
}

function obterDadosTela() {
    return {
        nomeCliente: licenca?.nomeCliente || ''
    };
}

// Disponibiliza os dados atuais para a proteção de tela.
ipcMain.handle('licenca:obter-dados-tela', () => {
    return obterDadosTela();
});

function notificarJanelasProtecao() {
    const dados = obterDadosTela();

    for (const janela of janelasProtecao) {
        if (
            !janela.isDestroyed() &&
            !janela.webContents.isDestroyed()
        ) {
            janela.webContents.send(
                'licenca:dados-atualizados',
                dados
            );
        }
    }
}

function obterTempoInatividade() {
    const valor = Number(
        licenca?.configuracoes?.tempo_inatividade
    );

    // O valor configurado no painel é interpretado em segundos.
    // Se estiver ausente ou inválido, utiliza 60 segundos.
    if (!Number.isFinite(valor) || valor < 1) {
        return 60;
    }

    return Math.min(Math.floor(valor), 86400);
}

function criarJanelaAtivacao(mensagemInicial = '') {
    if (janelaAtivacao && !janelaAtivacao.isDestroyed()) {
        janelaAtivacao.focus();
        return;
    }

    janelaAtivacao = new BrowserWindow({
        width: 520,
        height: 680,
        minWidth: 360,
        minHeight: 560,
        resizable: true,
        autoHideMenuBar: true,
        backgroundColor: '#030806',

        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    janelaAtivacao.loadFile(
        path.join(__dirname, 'ativacao.html')
    );

    janelaAtivacao.webContents.once('did-finish-load', () => {
        if (mensagemInicial) {
            janelaAtivacao.webContents.send(
                'licenca:mensagem',
                mensagemInicial
            );
        }
    });

    janelaAtivacao.on('closed', () => {
        janelaAtivacao = null;

        if (!licenca && !encerrando) {
            app.quit();
        }
    });
}

function fecharProtecao() {
    if (fechandoProtecao) return;

    fechandoProtecao = true;

    const janelas = [...janelasProtecao];
    janelasProtecao = [];

    for (const janela of janelas) {
        if (!janela.isDestroyed()) {
            janela.close();
        }
    }

    if (intervaloMouse) {
        clearInterval(intervaloMouse);
        intervaloMouse = null;
    }

    ultimaPosicaoMouse = null;
    fechandoProtecao = false;

    console.log(
        'Proteção fechada. Monitoramento de inatividade mantido.'
    );
}

function criarProtecaoEmTodosOsMonitores() {
    if (
        encerrando ||
        !licenca ||
        janelasProtecao.length > 0
    ) {
        return;
    }

    const monitores = screen.getAllDisplays();

    for (const monitor of monitores) {
        const janela = new BrowserWindow({
            x: monitor.bounds.x,
            y: monitor.bounds.y,
            width: monitor.bounds.width,
            height: monitor.bounds.height,

            frame: false,
            fullscreen: true,
            alwaysOnTop: true,
            skipTaskbar: true,
            autoHideMenuBar: true,

            backgroundColor: '#030806',

            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true
            }
        });

        janela.setAlwaysOnTop(true, 'screen-saver');
        janela.setVisibleOnAllWorkspaces(true);

        janela.loadFile(
            path.join(__dirname, 'index.html')
        );

        janela.webContents.on(
            'before-input-event',
            (evento, entrada) => {
               if (
                    entrada.type === 'keyDown' ||
                    entrada.type === 'mouseDown' ||
                    entrada.type === 'mouseUp'
                ) {
                    fecharProtecao();
                }
            }
        );

        janela.on('close', () => {
            if (!fechandoProtecao && !encerrando) {
                fecharProtecao();
            }
        });

        janelasProtecao.push(janela);
    }

    //###########################
            ultimaPosicaoMouse = screen.getCursorScreenPoint();

        intervaloMouse = setInterval(() => {
            if (
                janelasProtecao.length === 0 ||
                fechandoProtecao ||
                encerrando
            ) {
                return;
            }

            const posicaoAtual = screen.getCursorScreenPoint();

            if (
                posicaoAtual.x !== ultimaPosicaoMouse.x ||
                posicaoAtual.y !== ultimaPosicaoMouse.y
            ) {
                fecharProtecao();
                return;
            }

            ultimaPosicaoMouse = posicaoAtual;
        }, 100);

    //###########################

    console.log('Proteção de tela aberta.');
}

function iniciarMonitoramentoInatividade() {
    if (monitoramentoIniciado) return;

    monitoramentoIniciado = true;

    intervaloInatividade = setInterval(() => {
        if (
            encerrando ||
            !licenca ||
            janelaAtivacao ||
            janelasProtecao.length > 0
        ) {
            return;
        }

        const tempoConfigurado = obterTempoInatividade();
        const tempoOcioso = powerMonitor.getSystemIdleTime();

        if (tempoOcioso >= tempoConfigurado) {
            criarProtecaoEmTodosOsMonitores();
        }
    }, INTERVALO_INATIVIDADE);

    console.log('Monitoramento de inatividade iniciado.');
}

function pararMonitoramentoInatividade() {
    if (intervaloInatividade) {
        clearInterval(intervaloInatividade);
        intervaloInatividade = null;
    }

    monitoramentoIniciado = false;
}

async function sincronizarLicenca() {
    if (!licenca || sincronizando || encerrando) return;

    sincronizando = true;

    try {
        const resultado = await solicitarValidacao(
            licenca.servidor,
            licenca.codigo,
            licenca.identificadorInstalacao
        );

        licenca.ultimaValidacao = new Date().toISOString();
        licenca.configuracoes = resultado.configuracoes;
        licenca.nomeCliente = resultado.cliente?.nome || '';

        salvarLicencaLocal(licenca);
        notificarJanelasProtecao();

        console.log('Licença sincronizada com sucesso.');
        console.log(
            'Tempo de inatividade:',
            obterTempoInatividade(),
            'segundos'
        );
    } catch (erro) {
        console.error(
            'Não foi possível sincronizar a licença:',
            erro.message
        );

        if ([403, 404, 409].includes(erro.status)) {
            licenca = null;

            removerLicencaLocal();
            fecharProtecao();
            pararMonitoramentoInatividade();

            criarJanelaAtivacao(
                'A licença foi recusada pelo servidor. Verifique o código ou entre em contato com o administrador.'
            );
        }
    } finally {
        sincronizando = false;
    }
}

ipcMain.handle('licenca:ativar', async (evento, dados) => {
    if (
        !dados ||
        typeof dados.servidor !== 'string' ||
        typeof dados.codigo !== 'string'
    ) {
        return {
            sucesso: false,
            erro: 'Informe o endereço do servidor e o código de licença.'
        };
    }

    const servidorInformado = dados.servidor.trim();
    const codigo = dados.codigo.trim();

    let url;

    try {
        url = new URL(servidorInformado);

        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !['', '/'].includes(url.pathname)
        ) {
            throw new Error('Endereço inválido.');
        }
    } catch {
        return {
            sucesso: false,
            erro: 'Informe um endereço válido para o servidor.'
        };
    }

    if (!codigo || codigo.length > 100) {
        return {
            sucesso: false,
            erro: 'Informe um código de licença válido.'
        };
    }

const identificadorInstalacao =
    obterIdentificadorInstalacao();

    try {
        const resultado = await solicitarValidacao(
            url.origin,
            codigo,
            identificadorInstalacao
        );

        licenca = {
            servidor: url.origin,
            codigo,
            identificadorInstalacao,
            ultimaValidacao: new Date().toISOString(),
            nomeCliente: resultado.cliente?.nome || '',
            configuracoes: resultado.configuracoes
        };

        salvarLicencaLocal(licenca);
        notificarJanelasProtecao();

        if (janelaAtivacao && !janelaAtivacao.isDestroyed()) {
            janelaAtivacao.close();
            janelaAtivacao = null;
        }

        iniciarMonitoramentoInatividade();

        return {
            sucesso: true,
            mensagem: 'Licença ativada com sucesso!'
        };
    } catch (erro) {
        console.error('Falha na ativação:', erro.message);

        return {
            sucesso: false,
            erro: erro.message
        };
    }
});

app.whenReady().then(async () => {
    licenca = lerLicencaLocal();

    if (!licenca) {
        criarJanelaAtivacao();
        return;
    }

    if (!licencaDentroDoPrazo(licenca)) {
        licenca = null;

        removerLicencaLocal();

        criarJanelaAtivacao(
            'O prazo offline terminou. Conecte-se ao servidor para validar novamente sua licença.'
        );

        return;
    }

    // Começa monitorando, usando as configurações salvas localmente.
    iniciarMonitoramentoInatividade();

    // Atualiza a licença e as configurações em segundo plano.
    sincronizarLicenca();

    intervaloSincronizacao = setInterval(() => {
        sincronizarLicenca();
    }, 30 * 1000);
});

app.on('before-quit', () => {
    encerrando = true;
    pararMonitoramentoInatividade();

    if (intervaloSincronizacao) {
        clearInterval(intervaloSincronizacao);
        intervaloSincronizacao = null;
    }
});

app.on('window-all-closed', () => {
    // Não encerra o app: ele precisa continuar monitorando
    // a inatividade mesmo quando não há janelas visíveis.
});