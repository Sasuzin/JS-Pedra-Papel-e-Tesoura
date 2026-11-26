'use strict';

/* =========================================================
   JoKenPô: lista de salas públicas (o "saguão")

   Quem cria uma sala pública anuncia o código dela num
   servidor MQTT público (um "mural" de mensagens). Quem está
   procurando partida assina esse mural e vê as salas abertas.
   A partida em si continua pela conexão direta do online.js.

   Para não depender de um servidor só, o anúncio vai para
   dois servidores públicos e a lista junta os dois.

   O anúncio sai da lista quando:
   - alguém entra na sala ou o dono sai (o dono apaga o anúncio);
   - a aba do dono fecha ou a internet dele cai (o próprio
     servidor apaga, pela "última vontade" do MQTT);
   - o anúncio para de ser renovado (fica velho e é ignorado).
   ========================================================= */

const salas = (() => {
    const MQTT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.16.1/mqtt.min.js';
    const MQTT_SRI = 'sha384-ilRYg/zm2XqUafLvBoGVk40UfNRnvUkYMy+e/JPo4YgsFR6X9Q3jYEkqFQXquX4r';
    const SERVIDORES = [
        'wss://broker.hivemq.com:8884/mqtt',
        'wss://broker.emqx.io:8084/mqtt',
    ];
    const TOPICO = 'jokenpo-sasuzin/v1/salas';
    const REGEX_CODIGO = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
    const RENOVAR_MS = 25000; // o dono renova o anúncio
    const VALIDADE_MS = 80000; // anúncio sem renovação por mais que isso = sala morta
    const MAX_SALAS = 30;
    const MAX_BYTES = 600;

    const opcoesBase = { clean: true, reconnectPeriod: 5000, connectTimeout: 10000, protocolVersion: 4 };

    // só aceita texto: um objeto com toString malicioso não pode quebrar a lista
    function limparNome(nome) {
        return (typeof nome === 'string' ? nome : '')
            .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 16);
    }

    const idCliente = () => `jokenpo-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')}`;

    // ---------- Biblioteca MQTT (carregada só quando precisa) ----------

    let promessaMqtt = null;

    function carregar() {
        if (window.mqtt && typeof window.mqtt.connect === 'function') return Promise.resolve();
        if (!promessaMqtt) {
            promessaMqtt = new Promise((resolver, rejeitar) => {
                const script = document.createElement('script');
                script.src = MQTT_URL;
                script.integrity = MQTT_SRI;
                script.crossOrigin = 'anonymous';
                script.referrerPolicy = 'no-referrer';
                script.onload = () => (window.mqtt ? resolver() : rejeitar(new Error('mqtt')));
                script.onerror = () => {
                    promessaMqtt = null;
                    script.remove();
                    rejeitar(new Error('mqtt'));
                };
                document.head.appendChild(script);
            });
        }
        return promessaMqtt;
    }

    function encerrar(cliente) {
        try {
            cliente.end(true);
        } catch {
            /* já estava fechado */
        }
    }

    // ---------- Anúncio (dono de uma sala pública) ----------

    const anuncio = {
        clientes: [],
        dados: null,
        timer: null,
        versao: 0,
        aoMudar: null,
        informado: null,
        timerConfirmacao: null,
    };

    const topicoDe = (codigo) => `${TOPICO}/${codigo}`;

    function publicarEm(cliente) {
        if (!anuncio.dados || !cliente.connected) return;
        const { versao } = anuncio;
        const corpo = JSON.stringify({ ...anuncio.dados, v: 1, ts: Date.now() });
        cliente.publish(topicoDe(anuncio.dados.codigo), corpo, { qos: 1, retain: true }, (erro) => {
            // o servidor confirmou: a sala está mesmo na lista
            if (!erro && versao === anuncio.versao) informar('publicada');
        });
    }

    function publicarTudo() {
        anuncio.clientes.forEach(publicarEm);
    }

    // Conta para quem anunciou se a sala entrou na lista ('publicada') ou não ('falhou')
    function informar(situacao) {
        if (!anuncio.aoMudar || anuncio.informado === situacao) return;
        if (anuncio.informado === 'publicada') return; // depois de publicada, não volta atrás
        anuncio.informado = situacao;
        try {
            anuncio.aoMudar(situacao);
        } catch {
            /* problema de quem ouve não pode derrubar o anúncio */
        }
    }

    // dados: { codigo, nome, modo, criada }; aoMudar('publicada' | 'falhou') é opcional
    async function anunciar(dados, aoMudar = null) {
        const versao = ++anuncio.versao;
        await retirar({ manterVersao: true });
        if (versao !== anuncio.versao) return false; // cancelado enquanto apagava o anterior
        anuncio.dados = { codigo: dados.codigo, nome: limparNome(dados.nome) || 'Jogador', modo: dados.modo, criada: dados.criada };
        anuncio.aoMudar = aoMudar;
        anuncio.informado = null;
        // se nenhum servidor confirmar em 15 s, avisa que a sala não entrou na lista
        anuncio.timerConfirmacao = setTimeout(() => {
            if (versao === anuncio.versao) informar('falhou');
        }, 15000);
        try {
            await carregar();
        } catch {
            if (versao === anuncio.versao) {
                informar('falhou');
                anuncio.dados = null;
            }
            return false;
        }
        if (versao !== anuncio.versao) return false; // cancelado enquanto carregava (retirar já limpou)

        const topico = topicoDe(dados.codigo);
        anuncio.clientes = SERVIDORES.map((url) => {
            const cliente = window.mqtt.connect(url, {
                ...opcoesBase,
                clientId: idCliente(),
                keepalive: 30,
                // se a aba fechar ou a internet cair, o servidor apaga o anúncio sozinho
                will: { topic: topico, payload: '', qos: 1, retain: true },
            });
            cliente.on('connect', () => publicarEm(cliente)); // também ao reconectar
            cliente.on('error', () => { /* o outro servidor segue funcionando */ });
            return cliente;
        });
        anuncio.timer = setInterval(publicarTudo, RENOVAR_MS);
        return true;
    }

    // Muda algo no anúncio (por exemplo, o modo de jogo) sem recriar a sala
    function atualizar(parcial) {
        if (!anuncio.dados) return;
        Object.assign(anuncio.dados, parcial);
        if (parcial.nome !== undefined) anuncio.dados.nome = limparNome(parcial.nome) || 'Jogador';
        publicarTudo();
    }

    // Apaga o anúncio (mensagem vazia retida) e fecha as conexões
    function retirar({ manterVersao = false } = {}) {
        if (!manterVersao) anuncio.versao += 1;
        clearInterval(anuncio.timer);
        clearTimeout(anuncio.timerConfirmacao);
        anuncio.timer = null;
        anuncio.aoMudar = null;
        const { clientes, dados } = anuncio;
        anuncio.clientes = [];
        anuncio.dados = null;
        if (!dados || !clientes.length) {
            clientes.forEach(encerrar);
            return Promise.resolve();
        }
        const topico = topicoDe(dados.codigo);
        return Promise.all(clientes.map((cliente) => new Promise((pronto) => {
            let feito = false;
            const fim = () => {
                if (feito) return;
                feito = true;
                encerrar(cliente);
                pronto();
            };
            if (cliente.connected) cliente.publish(topico, '', { qos: 1, retain: true }, fim);
            else fim();
            setTimeout(fim, 1500);
        })));
    }

    const anunciando = () => Boolean(anuncio.dados);

    // ---------- Lista (quem está procurando partida) ----------

    const lista = { clientes: [], salas: new Map(), ouvinte: null, timer: null, conectados: 0, tentou: 0 };

    function estadoDaLista() {
        if (lista.conectados > 0) return 'ok';
        if (lista.clientes.some((cliente) => cliente.connected)) return 'conectando'; // esperando as salas guardadas
        if (lista.tentou >= lista.clientes.length && lista.clientes.length) return 'erro';
        return 'conectando';
    }

    function avisar() {
        if (!lista.ouvinte) return;
        const ordenadas = [...lista.salas.values()].sort((a, b) => a.criada - b.criada);
        lista.ouvinte({ estado: estadoDaLista(), salas: ordenadas });
    }

    function limparVelhas() {
        const agora = Date.now();
        for (const [codigo, sala] of lista.salas) {
            if (agora - sala.visto > VALIDADE_MS) lista.salas.delete(codigo);
        }
    }

    function receber(topico, payload, pacote) {
        const codigo = topico.slice(TOPICO.length + 1);
        if (!REGEX_CODIGO.test(codigo)) return;
        if (anuncio.dados && anuncio.dados.codigo === codigo) return; // a minha própria sala

        if (!payload || payload.length === 0) {
            if (lista.salas.delete(codigo)) avisar();
            return;
        }
        if (payload.length > MAX_BYTES) return;

        let d;
        try {
            d = JSON.parse(new TextDecoder().decode(payload));
        } catch {
            return;
        }
        if (!d || typeof d !== 'object' || d.v !== 1 || d.codigo !== codigo) return;
        if (typeof d.modo !== 'string' || !Object.hasOwn(MODOS, d.modo)) return;
        if (!Number.isFinite(d.ts) || !Number.isFinite(d.criada)) return;

        const agora = Date.now();
        // horário no futuro: anúncio forjado para nunca "envelhecer" (relógios tortos ficam bem abaixo disso)
        if (d.ts > agora + 120000) return;
        // anúncio guardado no servidor há muito tempo: a sala provavelmente já morreu
        if (pacote && pacote.retain && agora - d.ts > VALIDADE_MS) return;

        if (!lista.salas.has(codigo) && lista.salas.size >= MAX_SALAS) return;
        lista.salas.set(codigo, {
            codigo,
            nome: limparNome(d.nome) || 'Jogador',
            modo: d.modo,
            criada: Math.min(Math.max(d.criada, agora - 3600000), agora),
            visto: agora,
        });
        avisar();
    }

    // Nada que chegue do servidor público pode quebrar o processamento das mensagens seguintes
    function receberComSeguranca(topico, payload, pacote) {
        try {
            receber(topico, payload, pacote);
        } catch {
            /* anúncio malformado: ignora */
        }
    }

    // Começa a acompanhar as salas abertas; ouvinte({ estado, salas }) é chamado a cada mudança
    async function acompanhar(ouvinte) {
        lista.ouvinte = ouvinte;
        if (lista.clientes.length) {
            avisar();
            return;
        }
        lista.conectados = 0;
        lista.tentou = 0;
        avisar();
        try {
            await carregar();
        } catch {
            lista.tentou = Infinity;
            if (lista.ouvinte) lista.ouvinte({ estado: 'erro', salas: [] });
            return;
        }
        if (lista.ouvinte !== ouvinte || lista.clientes.length) return; // parou ou já começou

        lista.clientes = SERVIDORES.map((url) => {
            const cliente = window.mqtt.connect(url, {
                ...opcoesBase,
                clientId: idCliente(),
                keepalive: 45,
                // MQTT 5: pede ao servidor para nem mandar mensagens grandes (anúncios reais têm ~200 bytes)
                protocolVersion: 5,
                properties: { maximumPacketSize: 2048 },
            });
            let conectado = false;
            let contouTentativa = false;
            const marcarTentativa = () => {
                if (!contouTentativa) {
                    contouTentativa = true;
                    lista.tentou += 1;
                }
            };
            cliente.on('connect', () => {
                marcarTentativa();
                // só conta como "pronto" depois que o servidor confirmou a assinatura e mandou as
                // salas guardadas; antes disso a lista vazia não quer dizer "nenhuma sala"
                cliente.subscribe(`${TOPICO}/+`, { qos: 0 }, () => {
                    setTimeout(() => {
                        if (!conectado && lista.clientes.includes(cliente) && cliente.connected) {
                            conectado = true;
                            lista.conectados += 1;
                        }
                        avisar();
                    }, 600);
                });
            });
            cliente.on('close', () => {
                marcarTentativa();
                if (conectado) {
                    conectado = false;
                    lista.conectados -= 1;
                }
                avisar();
            });
            cliente.on('error', () => { /* tratado no close */ });
            cliente.on('message', receberComSeguranca);
            return cliente;
        });
        lista.timer = setInterval(() => {
            limparVelhas();
            avisar(); // também atualiza o "há X min"
        }, 5000);
    }

    function pararDeAcompanhar() {
        lista.ouvinte = null;
        clearInterval(lista.timer);
        lista.timer = null;
        lista.clientes.forEach(encerrar);
        lista.clientes = [];
        lista.salas.clear();
        lista.conectados = 0;
        lista.tentou = 0;
    }

    // Ao fechar a aba, tenta apagar o anúncio na hora (a "última vontade" cobre se não der)
    window.addEventListener('pagehide', () => {
        if (anuncio.dados) retirar();
    });

    return { anunciar, atualizar, retirar, anunciando, acompanhar, pararDeAcompanhar };
})();
