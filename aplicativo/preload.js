const {
    contextBridge,
    ipcRenderer
} = require('electron');

contextBridge.exposeInMainWorld('interativaLicenca', {
    ativar: (dados) => ipcRenderer.invoke(
        'licenca:ativar',
        dados
    ),

    obterDadosTela: () => ipcRenderer.invoke(
        'licenca:obter-dados-tela'
    ),

    aoAtualizarDados: (callback) => {
        if (typeof callback !== 'function') {
            return;
        }

        const listener = (_evento, dados) => {
            callback(dados);
        };

        ipcRenderer.on(
            'licenca:dados-atualizados',
            listener
        );

        // Permite remover o listener se necessário.
        return () => {
            ipcRenderer.removeListener(
                'licenca:dados-atualizados',
                listener
            );
        };
    }
});