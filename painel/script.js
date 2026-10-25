
async function iniciarAutenticacao() {
    try {
        const resposta = await fetch('/api/auth/status', { credentials: 'same-origin' });
        const estado = await resposta.json();
        modoConfiguracaoInicial = estado.configuracaoInicial;
        if (estado.autenticado && estado.usuario) {
            mostrarPainel(estado.usuario);
        } else {
            mostrarAcesso();
        }
    } catch (erro) {
        mostrarAcesso();
        mensagemAcesso.textContent = 'Não foi possível conectar ao servidor.';
    }
}

function mostrarAcesso() {
    telaAcesso.hidden = false; areaPainel.hidden = true;
    camposSetup.hidden = !modoConfiguracaoInicial;
    tituloAcesso.textContent = modoConfiguracaoInicial ? 'Configuração inicial' : 'Servidor de Licenças LPM';
    subtituloAcesso.textContent = modoConfiguracaoInicial ? 'Crie a primeira conta de administrador.' : 'Entre com sua conta para continuar.';
    btnEntrar.textContent = modoConfiguracaoInicial ? 'Criar administrador' : 'Entrar';
    document.getElementById('setupNome').required = modoConfiguracaoInicial;
    document.getElementById('loginUsuario').autocomplete = modoConfiguracaoInicial ? 'username' : 'username';
}

function mostrarPainel(usuario) {
    usuarioAtual = usuario; telaAcesso.hidden = true; areaPainel.hidden = false;
    areaPainel.classList.toggle('usuario-comum', usuario.perfil !== 'admin');
    document.getElementById('usuarioLogado').textContent = `${usuario.nome} (${usuario.perfil === 'admin' ? 'Administrador' : 'Usuário'})`;
    const admin = usuario.perfil === 'admin';
    document.getElementById('btnAbrirCadastro').hidden = !admin;
    document.getElementById('btnConfiguracoes').hidden = !admin;
    const botaoUsuarios = document.getElementById('btnUsuarios'); if (botaoUsuarios) botaoUsuarios.hidden = !admin;
    document.getElementById('colunaAcoes').hidden = !admin;
    carregarClientes(); carregarConfiguracaoServidor();
}

const formCliente = document.getElementById('formCliente');
const nomeCliente = document.getElementById('nomeCliente');
const listaClientes = document.getElementById('listaClientes');
const mensagem = document.getElementById('mensagem');
const btnSalvar = document.getElementById('btnSalvar');

const buscarCliente = document.getElementById('buscarCliente');
const filtroStatus = document.getElementById('filtroStatus');
const btnLimparFiltros = document.getElementById('btnLimparFiltros');
const itensPorPagina = document.getElementById('itensPorPagina');
const informacaoPaginacao = document.getElementById('informacaoPaginacao');
const paginaAtual = document.getElementById('paginaAtual');
const btnPaginaAnterior = document.getElementById('btnPaginaAnterior');
const btnProximaPagina = document.getElementById('btnProximaPagina');
const resumoBusca = document.getElementById('resumoBusca');

const modalCadastro = document.getElementById('modalCadastro');
const modalConfiguracoes = document.getElementById('modalConfiguracoes');
const btnAbrirCadastro = document.getElementById('btnAbrirCadastro');
const btnConfiguracoes = document.getElementById('btnConfiguracoes');

let usuarioAtual = null;
const telaAcesso = document.getElementById('telaAcesso');
const areaPainel = document.getElementById('areaPainel');
const formLogin = document.getElementById('formLogin');
const camposSetup = document.getElementById('camposSetup');
const tituloAcesso = document.getElementById('tituloAcesso');
const subtituloAcesso = document.getElementById('subtituloAcesso');
const btnEntrar = document.getElementById('btnEntrar');
const mensagemAcesso = document.getElementById('mensagemAcesso');
let modoConfiguracaoInicial = false;

formLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    mensagemAcesso.textContent = ''; btnEntrar.disabled = true;
    const usuario = document.getElementById('loginUsuario').value.trim();
    const senha = document.getElementById('loginSenha').value;
    const dados = modoConfiguracaoInicial
        ? { nome: document.getElementById('setupNome').value.trim(), usuario, senha }
        : { usuario, senha };
    try {
        const resposta = await fetch(modoConfiguracaoInicial ? '/api/auth/setup' : '/api/auth/login', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados)
        });
        const resultado = await resposta.json();
        if (!resposta.ok) throw new Error(resultado.erro || 'Não foi possível entrar.');
        document.getElementById('loginSenha').value = '';
        mostrarPainel(resultado.usuario);
    } catch (erro) { mensagemAcesso.textContent = erro.message; mensagemAcesso.className = 'mensagem erro'; }
    finally { btnEntrar.disabled = false; }
});

document.getElementById('btnLogoff').addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    finally { usuarioAtual = null; mostrarAcesso(); }
});




// Lista recebida da API e estado da paginação.
let todosOsClientes = [];
let pagina = 1;
let carregandoClientes = false;

const temposDisponiveis = [
    { segundos: 30, texto: '30 segundos' },
    { segundos: 60, texto: '1 minuto' },
    { segundos: 120, texto: '2 minutos' },
    { segundos: 180, texto: '3 minutos' },
    { segundos: 240, texto: '4 minutos' },
    { segundos: 300, texto: '5 minutos' },
    { segundos: 600, texto: '10 minutos' },
    { segundos: 900, texto: '15 minutos' },
    { segundos: 1800, texto: '30 minutos' },
    { segundos: 3600, texto: '60 minutos' }
];

// --------------------------------------------------
// Mensagens
// --------------------------------------------------

function exibirMensagem(texto, tipo) {
    mensagem.textContent = texto;
    mensagem.className = `mensagem ${tipo || ''}`.trim();
}

function exibirMensagemServidor(texto, tipo) {
    const elemento = document.getElementById('mensagemServidor');
    elemento.textContent = texto;
    elemento.className = `mensagem ${tipo || ''}`.trim();
}

function criarCelula(valor) {
    const celula = document.createElement('td');
    celula.textContent = valor ?? '';
    return celula;
}

// --------------------------------------------------
// Abertura e fechamento dos modais
// --------------------------------------------------

function abrirModal(modal) {
    modal.hidden = false;
    document.body.classList.add('modal-aberto');

    const primeiroCampo = modal.querySelector(
        'input:not([type="hidden"]), select, button'
    );

    if (primeiroCampo) {
        primeiroCampo.focus();
    }
}

function fecharModal(modal) {
    modal.hidden = true;

    const existeOutroModalAberto = Array.from(
        document.querySelectorAll('.sobreposicao-modal')
    ).some((item) => !item.hidden);

    if (!existeOutroModalAberto) {
        document.body.classList.remove('modal-aberto');
    }
}

btnAbrirCadastro.addEventListener('click', () => {
    formCliente.reset();
    abrirModal(modalCadastro);
});

btnConfiguracoes.addEventListener('click', () => {
    abrirModal(modalConfiguracoes);
});

document.querySelectorAll('[data-fechar-modal]').forEach((botao) => {
    botao.addEventListener('click', () => {
        const modal = document.getElementById(
            botao.dataset.fecharModal
        );

        if (modal) {
            fecharModal(modal);
        }
    });
});

// Clicar no fundo escuro fecha o modal.
document.querySelectorAll('.sobreposicao-modal').forEach((modal) => {
    modal.addEventListener('click', (evento) => {
        if (evento.target === modal) {
            fecharModal(modal);
        }
    });
});

// Esc fecha o modal que estiver aberto.
document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') {
        return;
    }

    document.querySelectorAll('.sobreposicao-modal').forEach((modal) => {
        if (!modal.hidden) {
            fecharModal(modal);
        }
    });
});

// --------------------------------------------------
// Busca, filtros e paginação
// --------------------------------------------------

function obterClientesFiltrados() {
    const termo = buscarCliente.value.trim().toLocaleLowerCase('pt-BR');
    const statusSelecionado = filtroStatus.value;

    return todosOsClientes.filter((cliente) => {
        const nome = String(cliente.nome || '').toLocaleLowerCase('pt-BR');
        const codigo = String(cliente.codigo || '').toLocaleLowerCase('pt-BR');

        const correspondeBusca =
            !termo ||
            nome.includes(termo) ||
            codigo.includes(termo);

        const estaAtivo = Number(cliente.ativo) === 1;

        const correspondeStatus =
            statusSelecionado === 'todos' ||
            (statusSelecionado === 'ativo' && estaAtivo) ||
            (statusSelecionado === 'inativo' && !estaAtivo);

        return correspondeBusca && correspondeStatus;
    });
}

function atualizarTabela() {
    const clientesFiltrados = obterClientesFiltrados();
    const quantidadePorPagina = Number(itensPorPagina.value) || 10;

    const totalClientes = clientesFiltrados.length;
    const totalPaginas = Math.max(
        1,
        Math.ceil(totalClientes / quantidadePorPagina)
    );

    // Se a filtragem diminuir os resultados, mantém uma página válida.
    pagina = Math.min(pagina, totalPaginas);

    const inicio = (pagina - 1) * quantidadePorPagina;
    const clientesDaPagina = clientesFiltrados.slice(
        inicio,
        inicio + quantidadePorPagina
    );

    listaClientes.replaceChildren();

    if (totalClientes === 0) {
        const linha = document.createElement('tr');
        const celula = document.createElement('td');

        celula.colSpan = 6;
        celula.className = 'estado-tabela';
        celula.textContent = todosOsClientes.length === 0
            ? 'Nenhum cliente cadastrado.'
            : 'Nenhum cliente corresponde à busca e aos filtros.';

        linha.appendChild(celula);
        listaClientes.appendChild(linha);
    } else {
        clientesDaPagina.forEach((cliente) => {
            listaClientes.appendChild(criarLinhaCliente(cliente));
        });
    }

    const primeiroResultado = totalClientes === 0 ? 0 : inicio + 1;
    const ultimoResultado = Math.min(
        inicio + quantidadePorPagina,
        totalClientes
    );

    informacaoPaginacao.textContent =
        `Exibindo ${primeiroResultado}–${ultimoResultado} de ${totalClientes} cliente(s)`;

    paginaAtual.textContent = `${pagina} / ${totalPaginas}`;
    btnPaginaAnterior.disabled = pagina <= 1;
    btnProximaPagina.disabled = pagina >= totalPaginas;

    resumoBusca.textContent = totalClientes === todosOsClientes.length
        ? `${todosOsClientes.length} cliente(s) cadastrado(s).`
        : `${totalClientes} resultado(s) encontrado(s) de ${todosOsClientes.length} cliente(s).`;
}

buscarCliente.addEventListener('input', () => {
    pagina = 1;
    atualizarTabela();
});

filtroStatus.addEventListener('change', () => {
    pagina = 1;
    atualizarTabela();
});

itensPorPagina.addEventListener('change', () => {
    pagina = 1;
    atualizarTabela();
});

btnLimparFiltros.addEventListener('click', () => {
    buscarCliente.value = '';
    filtroStatus.value = 'todos';
    pagina = 1;
    atualizarTabela();
});

btnPaginaAnterior.addEventListener('click', () => {
    if (pagina > 1) {
        pagina--;
        atualizarTabela();
    }
});

btnProximaPagina.addEventListener('click', () => {
    const totalPaginas = Math.max(
        1,
        Math.ceil(
            obterClientesFiltrados().length /
            (Number(itensPorPagina.value) || 10)
        )
    );

    if (pagina < totalPaginas) {
        pagina++;
        atualizarTabela();
    }
});

// --------------------------------------------------
// Carregamento dos clientes
// --------------------------------------------------

async function carregarClientes() {
    if (carregandoClientes) {
        return;
    }

    carregandoClientes = true;

    try {
        const resposta = await fetch('/api/clientes');

        if (!resposta.ok) {
            throw new Error('Falha ao consultar os clientes.');
        }

        const clientes = await resposta.json();

        if (!Array.isArray(clientes)) {
            throw new Error('A resposta da API não contém uma lista válida.');
        }

        todosOsClientes = clientes;
        atualizarTabela();
    } catch (erro) {
        console.error(erro);

        listaClientes.replaceChildren();

        const linha = document.createElement('tr');
        const celula = document.createElement('td');

        celula.colSpan = 6;
        celula.className = 'estado-tabela';
        celula.textContent = 'Não foi possível carregar os clientes.';

        linha.appendChild(celula);
        listaClientes.appendChild(linha);

        informacaoPaginacao.textContent = 'Falha ao carregar';
        paginaAtual.textContent = '—';
        resumoBusca.textContent = '';
        exibirMensagem(erro.message, 'erro');
    } finally {
        carregandoClientes = false;
    }
}

// --------------------------------------------------
// Criação das linhas da tabela e ações do cliente
// --------------------------------------------------

function criarLinhaCliente(cliente) {
    const linha = document.createElement('tr');
    linha.dataset.clienteId = cliente.id;

    linha.appendChild(criarCelula(cliente.id));

    // Célula com o nome e o indicador de conexão.
    const celulaNome = document.createElement('td');

    const indicadorOnline = document.createElement('span');
    indicadorOnline.dataset.clienteId = cliente.id;

    indicadorOnline.className = Number(cliente.online) === 1
        ? 'indicador-conexao online'
        : 'indicador-conexao offline';

    indicadorOnline.title = Number(cliente.online) === 1
        ? 'Cliente online'
        : 'Cliente offline';

    indicadorOnline.setAttribute('aria-label', indicadorOnline.title);

    const nomeCliente = document.createElement('span');
    nomeCliente.textContent = cliente.nome;

    celulaNome.appendChild(indicadorOnline);
    celulaNome.appendChild(nomeCliente);

    linha.appendChild(celulaNome);

    linha.appendChild(criarCelula(cliente.codigo));

    const estaAtivo = Number(cliente.ativo) === 1;

    const celulaStatus = document.createElement('td');
    const etiquetaStatus = document.createElement('span');

    etiquetaStatus.className = estaAtivo
        ? 'status-ativo'
        : 'status-inativo';

    etiquetaStatus.textContent = estaAtivo ? 'Ativo' : 'Inativo';
    celulaStatus.appendChild(etiquetaStatus);
    linha.appendChild(celulaStatus);

    // Seletor de tempo de inatividade.
    const celulaTempo = document.createElement('td');
    const seletor = document.createElement('select');

    seletor.className = 'seletor-tempo';
    seletor.setAttribute(
        'aria-label',
        `Tempo de inatividade do cliente ${cliente.nome}`
    );

    const tempoAtual = Number(cliente.tempo_inatividade || 300);

    temposDisponiveis.forEach((item) => {
        const opcao = document.createElement('option');

        opcao.value = item.segundos;
        opcao.textContent = item.texto;
        opcao.selected = item.segundos === tempoAtual;

        seletor.appendChild(opcao);
    });

    // Preserva um tempo existente que não esteja na lista padrão.
    if (!temposDisponiveis.some((item) => item.segundos === tempoAtual)) {
        const opcaoAtual = document.createElement('option');
        opcaoAtual.value = tempoAtual;
        opcaoAtual.textContent = `${tempoAtual} segundos (personalizado)`;
        opcaoAtual.selected = true;
        seletor.appendChild(opcaoAtual);
    }

    celulaTempo.appendChild(seletor);
    linha.appendChild(celulaTempo);

    // Botões de ação.
    const celulaAcoes = document.createElement('td');
    const acoes = document.createElement('div');

    acoes.className = 'acoes-cliente';

    const botaoEditarNome = document.createElement('button');
    botaoEditarNome.type = 'button';
    botaoEditarNome.textContent = 'Editar nome';
    botaoEditarNome.className = 'botao botao-editar';

    botaoEditarNome.addEventListener('click', async () => {
        const nomeAtualizado = prompt(
            'Digite o novo nome do cliente:',
            cliente.nome
        );

        if (nomeAtualizado === null) {
            return;
        }

        const nome = nomeAtualizado.trim();

        if (!nome) {
            exibirMensagem('O nome não pode ficar vazio.', 'erro');
            return;
        }

        if (nome.length > 100) {
            exibirMensagem(
                'O nome deve ter no máximo 100 caracteres.',
                'erro'
            );
            return;
        }

        botaoEditarNome.disabled = true;

        try {
            const resposta = await fetch(
                `/api/clientes/${cliente.id}/nome`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ nome })
                }
            );

            const resultado = await resposta.json();

            if (!resposta.ok) {
                throw new Error(
                    resultado.erro || 'Não foi possível atualizar o nome.'
                );
            }

            exibirMensagem(resultado.mensagem, 'sucesso');
            await carregarClientes();
        } catch (erro) {
            exibirMensagem(erro.message, 'erro');
            console.error(erro);
        } finally {
            botaoEditarNome.disabled = false;
        }
    });

    acoes.appendChild(botaoEditarNome);

    const botaoTempo = document.createElement('button');
    botaoTempo.type = 'button';
    botaoTempo.textContent = 'Salvar tempo';
    botaoTempo.className = 'botao botao-tempo';

    botaoTempo.addEventListener('click', () => {
        salvarTempo(
            cliente.id,
            Number(seletor.value),
            botaoTempo
        );
    });

    acoes.appendChild(botaoTempo);

    const botaoStatus = document.createElement('button');
    botaoStatus.type = 'button';
    botaoStatus.textContent = estaAtivo ? 'Desativar' : 'Ativar';
    botaoStatus.className = estaAtivo
        ? 'botao botao-desativar'
        : 'botao botao-ativar';

    botaoStatus.addEventListener('click', () => {
        alterarStatus(cliente.id, !estaAtivo, botaoStatus);
    });

    acoes.appendChild(botaoStatus);


const botaoLiberar = document.createElement('button');
botaoLiberar.type = 'button';
botaoLiberar.textContent = 'Liberar instalação';
botaoLiberar.className = 'botao botao-liberar';

const temInstalacaoVinculada =
    Number(cliente.instalacao_vinculada) === 1;

// Só mostra o botão quando a licença está inativa
// e existe uma instalação vinculada.
botaoLiberar.hidden = estaAtivo || !temInstalacaoVinculada;

botaoLiberar.title =
    'Permite vincular a licença a outro computador.';

botaoLiberar.addEventListener('click', () => {
    liberarInstalacao(cliente.id, botaoLiberar);
});

acoes.appendChild(botaoLiberar);


    celulaAcoes.appendChild(acoes);
    linha.appendChild(celulaAcoes);

    return linha;
}

// --------------------------------------------------
// Salvar tempo de inatividade
// --------------------------------------------------

async function salvarTempo(id, tempo, botao) {
    botao.disabled = true;

    try {
        const resposta = await fetch(
            `/api/clientes/${id}/tempo`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tempo })
            }
        );

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro || 'Não foi possível salvar o tempo.'
            );
        }

        exibirMensagem(resultado.mensagem, 'sucesso');
        await carregarClientes();
    } catch (erro) {
        exibirMensagem(erro.message, 'erro');
        console.error(erro);
    } finally {
        botao.disabled = false;
    }
}

// --------------------------------------------------
// Ativar ou desativar cliente
// --------------------------------------------------

async function alterarStatus(id, ativo, botao) {
    botao.disabled = true;

    try {
        const resposta = await fetch(
            `/api/clientes/${id}/status`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ativo })
            }
        );

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro || 'Não foi possível alterar o status.'
            );
        }

        exibirMensagem(resultado.mensagem, 'sucesso');
        await carregarClientes();
    } catch (erro) {
        exibirMensagem(erro.message, 'erro');
        console.error(erro);
    } finally {
        botao.disabled = false;
    }
}

// --------------------------------------------------
// Liberar instalação vinculada
// --------------------------------------------------

async function liberarInstalacao(id, botao) {
    const confirmado = confirm(
        'Deseja liberar a instalação deste cliente? ' +
        'A licença precisa estar desativada. ' +
        'Depois da liberação, ela poderá ser ativada em outro computador.'
    );

    if (!confirmado) {
        return;
    }

    botao.disabled = true;

    try {
        const resposta = await fetch(
            `/api/clientes/${id}/liberar-instalacao`,
            {
                method: 'POST',
                headers: {
                }
            }
        );

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro ||
                'Não foi possível liberar a instalação.'
            );
        }

        exibirMensagem(resultado.mensagem, 'sucesso');
        await carregarClientes();
    } catch (erro) {
        exibirMensagem(erro.message, 'erro');
        console.error(erro);
    } finally {
        botao.disabled = false;
    }
}

// --------------------------------------------------
// Cadastro de clientes
// --------------------------------------------------

formCliente.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const nome = nomeCliente.value.trim();

    if (!nome) {
        exibirMensagem('Digite o nome do cliente.', 'erro');
        nomeCliente.focus();
        return;
    }

    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';

    try {
        const resposta = await fetch('/api/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome })
        });

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro || 'Não foi possível cadastrar o cliente.'
            );
        }

        formCliente.reset();
        fecharModal(modalCadastro);

        buscarCliente.value = '';
        filtroStatus.value = 'todos';
        pagina = 1;

        exibirMensagem('Cliente cadastrado com sucesso!', 'sucesso');
        await carregarClientes();
    } catch (erro) {
        // O modal permanece aberto para permitir corrigir o problema.
        exibirMensagem(erro.message, 'erro');
        console.error(erro);
    } finally {
        btnSalvar.disabled = false;
        btnSalvar.textContent = 'Cadastrar cliente';
    }
});

// --------------------------------------------------
// Configuração do servidor
// --------------------------------------------------

const formServidor = document.getElementById('formServidor');
const tipoEndereco = document.getElementById('tipoEndereco');
const enderecoServidor = document.getElementById('enderecoServidor');
const portaServidor = document.getElementById('portaServidor');
const btnSalvarServidor = document.getElementById('btnSalvarServidor');


async function carregarConfiguracaoServidor() {
    try {
        const resposta = await fetch('/api/configuracao-servidor');

        if (!resposta.ok) {
            throw new Error('Não foi possível carregar a configuração.');
        }

        const configuracao = await resposta.json();

        enderecoServidor.value = configuracao.endereco_servidor ?? '';
        portaServidor.value = configuracao.porta_servidor ?? 3000;

        const endereco = String(configuracao.endereco_servidor || '');
        const pareceIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(endereco);

        tipoEndereco.value = pareceIP ? 'ip' : 'nome';
    } catch (erro) {
        console.error(erro);

        exibirMensagemServidor(
            'Não foi possível carregar a configuração do servidor.',
            'erro'
        );
    }
}

formServidor.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    const endereco = enderecoServidor.value.trim();
    const porta = Number(portaServidor.value);

    if (!endereco || !Number.isInteger(porta) || porta < 1 || porta > 65535) {
        exibirMensagemServidor(
            'Informe um endereço e uma porta válidos.',
            'erro'
        );
        return;
    }

    btnSalvarServidor.disabled = true;
    btnSalvarServidor.textContent = 'Salvando...';

    try {
        const resposta = await fetch('/api/configuracao-servidor', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endereco, porta })
        });

        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(
                resultado.erro || 'Não foi possível salvar a configuração.'
            );
        }

        exibirMensagemServidor(
            resultado.mensagem || 'Configuração salva com sucesso.',
            'sucesso'
        );

        exibirMensagem(
            'Configuração do servidor salva com sucesso.',
            'sucesso'
        );

        // Fecha o modal após um salvamento bem-sucedido.
        fecharModal(modalConfiguracoes);
    } catch (erro) {
        exibirMensagemServidor(erro.message, 'erro');
        console.error(erro);
    } finally {
        btnSalvarServidor.disabled = false;
        btnSalvarServidor.textContent = 'Salvar configuração';
    }
});

// A interface do painel só é exibida após autenticação válida.

// --------------------------------------------------
// Gerenciamento de contas (somente administradores)
// --------------------------------------------------
const btnUsuarios = document.getElementById('btnUsuarios');
const modalUsuarios = document.getElementById('modalUsuarios');
const formNovoUsuario = document.getElementById('formNovoUsuario');
const listaUsuarios = document.getElementById('listaUsuarios');
const mensagemUsuarios = document.getElementById('mensagemUsuarios');

if (btnUsuarios) btnUsuarios.addEventListener('click', async () => {
    if (!usuarioAtual || usuarioAtual.perfil !== 'admin') return;
    mensagemUsuarios.textContent = '';
    formNovoUsuario.reset();
    abrirModal(modalUsuarios);
    await carregarUsuarios();
});

function mostrarMensagemUsuarios(texto, tipo = '') {
    mensagemUsuarios.textContent = texto;
    mensagemUsuarios.className = `mensagem ${tipo}`.trim();
}

async function carregarUsuarios() {
    listaUsuarios.replaceChildren();
    try {
        const resposta = await fetch('/api/usuarios', { credentials: 'same-origin' });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível carregar os usuários.');
        if (!dados.length) { listaUsuarios.textContent = 'Nenhuma conta cadastrada.'; return; }
        const tabela = document.createElement('table');
        tabela.className = 'tabela-usuarios';
        const cabecalho = document.createElement('thead');
        cabecalho.innerHTML = '<tr><th>Nome / usuário</th><th>Perfil</th><th>Status</th><th>Ações</th></tr>';
        tabela.append(cabecalho);
        const corpo = document.createElement('tbody');
        dados.forEach((conta) => {
            const linha = document.createElement('tr');
            const identidade = document.createElement('td');
            const nome = document.createElement('strong'); nome.textContent = conta.nome;
            const login = document.createElement('small'); login.textContent = conta.usuario;
            identidade.append(nome, document.createElement('br'), login);
            const perfil = document.createElement('td'); perfil.textContent = conta.perfil === 'admin' ? 'Administrador' : 'Usuário comum';
            const status = document.createElement('td'); status.textContent = conta.ativo ? 'Ativo' : 'Desativado';
            const acoes = document.createElement('td'); acoes.className = 'acoes-usuarios';
            const btnStatus = document.createElement('button'); btnStatus.type = 'button'; btnStatus.className = 'botao botao-contorno'; btnStatus.textContent = conta.ativo ? 'Desativar' : 'Ativar';
            btnStatus.disabled = conta.id === usuarioAtual.id;
            btnStatus.addEventListener('click', async () => {
                if (!confirm(`${conta.ativo ? 'Desativar' : 'Ativar'} a conta ${conta.usuario}?`)) return;
                try { const r = await fetch(`/api/usuarios/${conta.id}/status`, { method:'PATCH', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ativo:!conta.ativo}) }); const d=await r.json(); if(!r.ok) throw new Error(d.erro || 'Falha ao alterar status.'); await carregarUsuarios(); mostrarMensagemUsuarios('Status atualizado.', 'sucesso'); }
                catch(e) { mostrarMensagemUsuarios(e.message, 'erro'); }
            });
            const btnSenha = document.createElement('button'); btnSenha.type='button'; btnSenha.className='botao botao-contorno'; btnSenha.textContent='Redefinir senha';
            btnSenha.addEventListener('click', async () => {
                const senha = prompt(`Digite a nova senha para ${conta.usuario} (mínimo 10 caracteres):`);
                if (senha === null) return;
                if (senha.length < 10) { mostrarMensagemUsuarios('A senha precisa ter pelo menos 10 caracteres.', 'erro'); return; }
                try { const r=await fetch(`/api/usuarios/${conta.id}/senha`, {method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({senha})}); const d=await r.json(); if(!r.ok) throw new Error(d.erro || 'Falha ao redefinir a senha.'); mostrarMensagemUsuarios('Senha redefinida. A conta precisará entrar novamente.', 'sucesso'); await carregarUsuarios(); }
                catch(e) { mostrarMensagemUsuarios(e.message, 'erro'); }
            });
            acoes.append(btnStatus, btnSenha); linha.append(identidade, perfil, status, acoes); corpo.append(linha);
        });
        tabela.append(corpo); listaUsuarios.append(tabela);
    } catch (erro) { listaUsuarios.textContent = erro.message; }
}

if (formNovoUsuario) formNovoUsuario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const btn = document.getElementById('btnCriarUsuario'); btn.disabled = true;
    const dados = { nome: document.getElementById('novoNomeUsuario').value.trim(), usuario: document.getElementById('novoLoginUsuario').value.trim(), senha: document.getElementById('novaSenhaUsuario').value, perfil: document.getElementById('novoPerfilUsuario').value };
    try {
        const resposta = await fetch('/api/usuarios', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dados) });
        const resultado = await resposta.json(); if (!resposta.ok) throw new Error(resultado.erro || 'Não foi possível criar a conta.');
        formNovoUsuario.reset(); mostrarMensagemUsuarios('Conta criada com sucesso.', 'sucesso'); await carregarUsuarios();
    } catch (erro) { mostrarMensagemUsuarios(erro.message, 'erro'); }
    finally { btn.disabled = false; }
});


iniciarAutenticacao();

/**
 * Atualiza somente os indicadores de conexão,
 * sem reconstruir a tabela inteira.
 */
let atualizandoStatusConexao = false;

async function atualizarStatusConexao() {
    if (atualizandoStatusConexao) {
        return;
    }

    atualizandoStatusConexao = true;

    try {
        const resposta = await fetch('/api/clientes');

        if (!resposta.ok) {
            throw new Error('Não foi possível atualizar os status.');
        }

        const clientesAtualizados = await resposta.json();

        if (!Array.isArray(clientesAtualizados)) {
            return;
        }

        // Atualiza os dados em memória, preservando os demais campos.
        const statusPorId = new Map(
            clientesAtualizados.map(cliente => [
                String(cliente.id),
                Number(cliente.online) === 1 ? 1 : 0
            ])
        );

        todosOsClientes = todosOsClientes.map(cliente => {
            const id = String(cliente.id);

            if (!statusPorId.has(id)) {
                return cliente;
            }

            return {
                ...cliente,
                online: statusPorId.get(id)
            };
        });

        // Atualiza apenas as bolinhas que estão visíveis na tabela.
        document
            .querySelectorAll('.indicador-conexao[data-cliente-id]')
            .forEach(indicador => {
                const id = String(indicador.dataset.clienteId);

                if (!statusPorId.has(id)) {
                    return;
                }

                const online = statusPorId.get(id) === 1;

                indicador.classList.toggle('online', online);
                indicador.classList.toggle('offline', !online);

                indicador.title = online
                    ? 'Cliente online'
                    : 'Cliente offline';

                indicador.setAttribute(
                    'aria-label',
                    indicador.title
                );
            });

    } catch (erro) {
        // Se houver falha de rede, mantém o último status exibido.
        console.error('Erro ao atualizar os status de conexão:', erro);
    } finally {
        atualizandoStatusConexao = false;
    }
}

// Atualiza os indicadores a cada 10 segundos.
setInterval(atualizarStatusConexao, 10000);
