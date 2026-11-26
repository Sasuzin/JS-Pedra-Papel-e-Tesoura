'use strict';

/* =========================================================
   JoKenPô: modo online (dois jogadores numa sala)

   Os navegadores conversam direto entre si (WebRTC) usando a
   biblioteca PeerJS. O servidor público do PeerJS só faz a
   "apresentação" inicial, então não precisa de backend próprio
   e tudo funciona hospedado no GitHub Pages.

   Ninguém consegue roubar espiando a jogada do outro: cada
   jogada é enviada primeiro como um LACRE (hash SHA-256 da
   jogada + um segredo aleatório). Só depois que os dois
   lacraram é que cada um revela a jogada e o segredo, e o
   outro confere se bate com o lacre recebido.
   ========================================================= */

const online = (() => {
    // ---------- Configuração ----------

    const PEERJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js';
    const PEERJS_SRI = 'sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu';
    const PREFIXO = 'jokenpo-sasuzin-v1-'; // evita colisão com outros apps no servidor público
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O/0 e I/1 para não confundir
    const TAMANHO_CODIGO = 5;
    const REGEX_CODIGO = new RegExp(`^[${ALFABETO}]{${TAMANHO_CODIGO}}$`);
    const VERSAO = 1; // versão do "idioma" entre os dois navegadores
    const PING_MS = 3000;
    const SILENCIO_MS = 15000; // sem notícias por esse tempo = conexão caiu
    const SILENCIO_ESCONDIDO_MS = 120000; // mais paciência se o outro só trocou de aba/app
    const CONEXAO_MS = 15000; // tempo máximo para entrar numa sala
    const SERVIDOR_MS = 12000; // tempo máximo para falar com o servidor do PeerJS
    const CHAVE_NOME = 'jokenpo:nome';
    const REACOES = ['👏', '😂', '😱', '🔥', '😎'];
    const MOTIVOS = ['inicio', 'modo', 'reinicio', 'revanche'];

    // ---------- Estado ----------

    const s = {
        status: 'off', // off | criando | conectando | aguardando | jogando
        papel: null, // 'dono' (criou a sala) | 'convidado'
        peer: null,
        conn: null,
        codigo: null,
        nomeAdversario: '',
        tentativa: 0, // invalida operações assíncronas canceladas
        partida: 0, // número da partida; quem decide é o dono da sala
        rodada: 1,
        minha: null, // { r, escolha, sal, hash, revelado }
        preparando: false, // calculando o lacre da minha jogada
        lacres: {}, // rodada -> lacre do adversário
        jogadas: {}, // rodada -> jogada do adversário (já conferida)
        revanche: { eu: false, ele: false },
        fila: [], // ações que esperam a animação da rodada terminar
        ultimoContato: 0,
        timerPing: null,
        timerConexao: null,
        timerPainel: null,
        tentativasServidor: 0,
        adversarioEscondido: false, // a aba do outro jogador está em segundo plano
        ultimaReacao: 0,
        reacoesRecebidas: [],
    };

    const ui = {};

    // ---------- Utilidades ----------

    const ativo = () => s.status === 'aguardando' || s.status === 'jogando';

    function normalizarCodigo(texto) {
        return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TAMANHO_CODIGO);
    }

    function gerarCodigo() {
        // 256 é múltiplo de 32 (tamanho do alfabeto), então todas as letras têm a mesma chance
        const bytes = crypto.getRandomValues(new Uint8Array(TAMANHO_CODIGO));
        return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
    }

    function hexAleatorio(bytes) {
        return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function sha256(texto) {
        const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
        return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('');
    }

    // O lacre amarra a jogada a quem jogou, à partida e à rodada: não dá para reaproveitar um lacre
    // antigo nem copiar o lacre do adversário para forçar empate
    const lacrar = (papel, escolha, sal, partida, rodada) => sha256(`${papel}:${escolha}:${sal}:${partida}:${rodada}`);
    const papelDoAdversario = () => (s.papel === 'dono' ? 'convidado' : 'dono');

    function limparNome(nome) {
        return String(nome ?? '')
            .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 16);
    }

    const meuNome = () => limparNome(ui.inputNome.value) || 'Jogador';

    function guardarNome() {
        armazenamento.gravar(CHAVE_NOME, limparNome(ui.inputNome.value));
    }

    function linkDaSala() {
        const url = new URL(window.location.href);
        url.search = '';
        url.hash = '';
        url.searchParams.set('sala', s.codigo || '');
        return url.toString();
    }

    function mensagemDeErro(erro) {
        switch (erro && erro.type) {
            case 'peer-unavailable':
                return 'Sala não encontrada. Confira o código ou peça um link novo.';
            case 'sala-cheia':
                return 'Essa sala já tem dois jogadores.';
            case 'tempo-conexao':
                return 'Não deu para conectar. A sala pode ter fechado ou a rede bloqueou a conexão.';
            case 'browser-incompatible':
                return 'Seu navegador não suporta o modo online. Tente o Chrome, Edge, Firefox ou Safari atualizados.';
            case 'inseguro':
                return 'O modo online precisa do site aberto por https (pelo link do GitHub Pages, por exemplo).';
            case 'biblioteca':
                return 'Não foi possível carregar o modo online. Confira sua internet e tente de novo.';
            case 'versao':
                return 'Vocês estão com versões diferentes do jogo. Atualizem a página (F5) e tentem de novo.';
            case 'unavailable-id':
                return 'Não consegui criar a sala agora. Tente de novo.';
            case 'network':
            case 'server-error':
            case 'socket-error':
            case 'socket-closed':
            case 'server-timeout':
                return 'Sem conexão com o servidor do jogo. Confira sua internet e tente de novo.';
            default:
                return 'Algo deu errado na conexão. Tente de novo.';
        }
    }

    function exigirRecursos() {
        if (!window.crypto || !crypto.subtle) throw { type: 'inseguro' };
        if (!window.RTCPeerConnection) throw { type: 'browser-incompatible' };
    }

    // Só ações que mexem na tela da partida esperam a animação da rodada acabar
    function quandoLivre(acao) {
        if (estado.ocupado) s.fila.push(acao);
        else acao();
    }

    // ---------- PeerJS (carregado só quando alguém usa o modo online) ----------

    let promessaPeerJS = null;

    function carregarPeerJS() {
        if (window.Peer) return Promise.resolve();
        if (!promessaPeerJS) {
            promessaPeerJS = new Promise((resolver, rejeitar) => {
                const script = document.createElement('script');
                script.src = PEERJS_URL;
                script.integrity = PEERJS_SRI;
                script.crossOrigin = 'anonymous';
                script.referrerPolicy = 'no-referrer';
                script.onload = () => (window.Peer ? resolver() : rejeitar({ type: 'biblioteca' }));
                script.onerror = () => {
                    promessaPeerJS = null;
                    script.remove();
                    rejeitar({ type: 'biblioteca' });
                };
                document.head.appendChild(script);
            });
        }
        return promessaPeerJS;
    }

    // Registra este navegador no servidor do PeerJS (com um id fixo para o dono da sala)
    function criarPeer(id) {
        return new Promise((resolver, rejeitar) => {
            const peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
            const timer = setTimeout(() => falhou({ type: 'server-timeout' }), SERVIDOR_MS);
            function limpar() {
                clearTimeout(timer);
                peer.off('open', abriu);
                peer.off('error', falhou);
            }
            function abriu() {
                limpar();
                resolver(peer);
            }
            function falhou(erro) {
                limpar();
                peer.destroy();
                rejeitar(erro);
            }
            peer.on('open', abriu);
            peer.on('error', falhou);
        });
    }

    function ligarEventosPeer(peer) {
        peer.on('error', (erro) => erroDoPeer(peer, erro));
        // perdeu o servidor (a partida em andamento continua pela conexão direta)
        peer.on('disconnected', () => {
            if (peer !== s.peer || peer.destroyed) return;
            atualizarBarra();
            if (s.tentativasServidor >= 5) return;
            s.tentativasServidor += 1;
            setTimeout(() => {
                if (peer === s.peer && !peer.destroyed && peer.disconnected) peer.reconnect();
            }, 1500 * s.tentativasServidor);
        });
        peer.on('open', () => {
            if (peer !== s.peer) return;
            s.tentativasServidor = 0;
            atualizarBarra();
        });
    }

    function erroDoPeer(peer, erro) {
        if (peer !== s.peer) return;
        if (s.status === 'conectando') {
            falharConexao(erro);
            return;
        }
        const tipo = erro && erro.type;
        if (tipo === 'peer-unavailable') return;
        if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(tipo)) {
            atualizarBarra();
            return;
        }
        if (s.status === 'aguardando') toast(mensagemDeErro(erro), 'erro');
    }

    // ---------- Conexão entre os dois jogadores ----------

    function enviar(msg) {
        const conn = s.conn;
        if (!conn || !conn.open) return false;
        try {
            conn.send(msg);
            return true;
        } catch {
            return false;
        }
    }

    function ligarConexao(conn) {
        s.conn = conn;
        conn.on('open', () => {
            if (conn !== s.conn) return;
            s.ultimoContato = Date.now();
            enviar({ t: 'ola', v: VERSAO, nome: meuNome() });
            iniciarPing();
        });
        conn.on('data', (dados) => {
            if (conn === s.conn) receber(dados);
        });
        conn.on('close', () => conexaoCaiu(conn));
        conn.on('error', () => conexaoCaiu(conn));
    }

    // Dono da sala: alguém está entrando
    function receberConexao(conn) {
        if (s.papel !== 'dono' || s.status !== 'aguardando' || s.conn) {
            // sala cheia: avisa e fecha
            conn.on('open', () => {
                try {
                    conn.send({ t: 'cheia' });
                } catch {
                    /* ignora */
                }
                setTimeout(() => conn.close(), 400);
            });
            return;
        }
        ligarConexao(conn);
        // se o convidado não conseguir terminar de entrar, libera a sala de novo
        clearTimeout(s.timerConexao);
        s.timerConexao = setTimeout(() => {
            if (s.conn === conn && s.status === 'aguardando') conexaoCaiu(conn);
        }, CONEXAO_MS);
    }

    function iniciarPing() {
        pararPing();
        s.ultimoContato = Date.now();
        s.timerPing = setInterval(() => {
            if (!s.conn) {
                pararPing();
                return;
            }
            // com a aba escondida o navegador atrasa os timers: não dá para confiar no relógio
            const limite = s.adversarioEscondido ? SILENCIO_ESCONDIDO_MS : SILENCIO_MS;
            if (!document.hidden && Date.now() - s.ultimoContato > limite) {
                conexaoCaiu(s.conn, 'silencio');
                return;
            }
            enviar({ t: 'ping' });
        }, PING_MS);
    }

    function pararPing() {
        clearInterval(s.timerPing);
        s.timerPing = null;
    }

    function conexaoCaiu(conn, motivo = 'caiu') {
        if (!conn || conn !== s.conn) return;
        s.conn = null;
        pararPing();
        clearTimeout(s.timerConexao);
        try {
            conn.close();
        } catch {
            /* já estava fechada */
        }
        if (s.status === 'conectando') {
            falharConexao({ type: 'tempo-conexao' });
            return;
        }
        // dono: alguém desistiu antes de terminar de entrar; a sala continua esperando
        if (s.status !== 'jogando') return;
        quandoLivre(() => adversarioSaiu(motivo));
    }

    // Desliga tudo da rede e volta o estado do modo online ao zero
    function desmontar() {
        s.tentativa += 1;
        pararPing();
        clearTimeout(s.timerConexao);
        const { conn, peer } = s;
        Object.assign(s, {
            status: 'off',
            papel: null,
            peer: null,
            conn: null,
            codigo: null,
            nomeAdversario: '',
            tentativasServidor: 0,
            partida: 0,
            adversarioEscondido: false,
        });
        zerarPartida();
        // um tempinho para o "tchau" sair antes de fechar tudo
        setTimeout(() => {
            try {
                if (conn) conn.close();
            } catch {
                /* ignora */
            }
            try {
                if (peer && !peer.destroyed) peer.destroy();
            } catch {
                /* ignora */
            }
        }, 250);
    }

    // ---------- Mensagens recebidas ----------

    function receber(msg) {
        s.ultimoContato = Date.now();
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

        switch (msg.t) {
            case 'ping':
                return;
            case 'ola':
                receberOla(msg);
                return;
            case 'cheia':
                if (s.status === 'conectando') falharConexao({ type: 'sala-cheia' });
                return;
            case 'tchau':
                conexaoCaiu(s.conn, 'saiu');
                return;
            case 'visivel':
                s.adversarioEscondido = msg.h === true;
                return;
            default:
                break;
        }

        if (s.status !== 'jogando') return;
        if (msg.t === 'reacao') {
            receberReacao(msg);
            return;
        }
        const tratar = { nova: receberNova, escolhi: receberLacre, revelo: receberJogada, revanche: receberRevanche }[msg.t];
        if (!tratar) return;
        // "nova" espera a animação da rodada acabar. Se tem algo na fila, as jogadas seguintes
        // também esperam, senão chegariam antes da partida nova e seriam descartadas.
        if (msg.t === 'nova' || s.fila.length) quandoLivre(() => tratar(msg));
        else tratar(msg);
    }

    function receberOla(msg) {
        if (s.status === 'jogando') return;
        if (msg.v !== VERSAO) {
            if (s.papel === 'convidado') {
                falharConexao({ type: 'versao' });
            } else {
                toast(mensagemDeErro({ type: 'versao' }), 'erro');
                conexaoCaiu(s.conn);
            }
            return;
        }

        clearTimeout(s.timerConexao);
        s.status = 'jogando';
        s.nomeAdversario = limparNome(msg.nome) || 'Adversário';
        definirAdversario({ nome: s.nomeAdversario, emoji: '👤', online: true });
        const focoNoPainel = ui.modal.contains(document.activeElement);
        fecharPainel({ devolverFoco: false });
        mostrarInterfaceOnline();
        if (focoNoPainel) el.escolhas[0].focus({ preventScroll: true });
        som.entrou();
        const c = centro(el.palcoCpu);
        fx.faiscas(c.x, c.y, ['#4ade80', '#22d3ee', '#ffffff'], 30);

        if (s.papel === 'dono') {
            toast(`🎮 ${s.nomeAdversario} entrou na sala!`, 'sucesso');
            novaPartida('inicio');
        } else {
            toast(`🎮 Você entrou na sala de ${s.nomeAdversario}!`, 'sucesso');
            // a partida começa quando o dono mandar a mensagem "nova"
            reiniciarPartida('Conectado!', 'Preparando a partida…');
            bloquearEscolhas();
        }
    }

    // ---------- Partidas ----------

    function zerarPartida() {
        s.rodada = 1;
        s.minha = null;
        s.preparando = false;
        s.lacres = {};
        s.jogadas = {};
        s.revanche = { eu: false, ele: false };
    }

    function textosDaPartida(motivo) {
        const modo = MODOS[estado.modo];
        switch (motivo) {
            case 'modo':
                return [modo.titulo, modo.texto];
            case 'reinicio':
                return ['Placar zerado!', 'Bora de novo? Escolha sua jogada 💪'];
            case 'revanche':
                return ['Revanche! 🔥', 'Valendo de novo. Boa sorte!'];
            default:
                return ['Partida valendo!', `${modo.titulo}: escolha sua jogada.`];
        }
    }

    function comecarPartida(partida, modo, motivo) {
        s.partida = partida;
        zerarPartida();
        // se o fim de partida estava aberto, o foco do teclado volta para as opções
        const focoNoModal = !el.modal.hidden
            && (el.modal.contains(document.activeElement) || document.activeElement === document.body);
        esconderModal();
        if (focoNoModal) el.escolhas[0].focus({ preventScroll: true });
        aplicarModo(modo);
        const [titulo, sub] = textosDaPartida(motivo);
        reiniciarPartida(titulo, sub);
        renderizarSelos();
        atualizarBarra();
    }

    // Só o dono da sala começa partidas; o convidado segue o número que ele mandar
    function novaPartida(motivo) {
        if (s.papel !== 'dono' || s.status !== 'jogando') return;
        s.partida += 1;
        enviar({ t: 'nova', p: s.partida, modo: estado.modo, motivo });
        comecarPartida(s.partida, estado.modo, motivo);
    }

    function receberNova(msg) {
        if (s.papel !== 'convidado' || s.status !== 'jogando') return;
        if (!Number.isSafeInteger(msg.p) || msg.p <= s.partida || !Object.hasOwn(MODOS, msg.modo)) return;
        const motivo = MOTIVOS.includes(msg.motivo) ? msg.motivo : 'inicio';
        const mudouModo = msg.modo !== estado.modo;
        comecarPartida(msg.p, msg.modo, motivo);
        if (motivo === 'modo' && mudouModo) toast(`${s.nomeAdversario} mudou para ${MODOS[msg.modo].titulo}.`);
        if (motivo === 'reinicio') toast(`${s.nomeAdversario} zerou o placar.`);
    }

    // ---------- Rodada: lacrar, revelar e conferir ----------

    function podeJogar() {
        return s.status === 'jogando' && s.partida > 0 && !s.minha && !s.preparando
            && !estado.ocupado && !estado.encerrada;
    }

    function explicarBloqueio() {
        if (s.status === 'aguardando') toast('Espere alguém entrar na sala para jogar.');
        else if (s.status === 'jogando' && s.partida === 0) toast('Preparando a partida…');
    }

    async function jogar(escolha) {
        if (!podeJogar() || !Object.hasOwn(OPCOES, escolha)) return;
        const partida = s.partida;
        const rodada = s.rodada;
        s.preparando = true;
        bloquearEscolhas(escolha);
        renderizarSelos();

        let hash;
        const sal = hexAleatorio(16);
        try {
            hash = await lacrar(s.papel, escolha, sal, partida, rodada);
        } catch {
            hash = null;
        }
        s.preparando = false;

        // a partida pode ter mudado enquanto o lacre era calculado
        if (partida !== s.partida || rodada !== s.rodada || s.status !== 'jogando') return;
        if (!hash) {
            liberarEscolhas();
            renderizarSelos();
            toast('Não consegui registrar sua jogada. Tente de novo.', 'erro');
            return;
        }

        s.minha = { r: rodada, escolha, sal, hash, revelado: false };
        enviar({ t: 'escolhi', p: partida, r: rodada, h: hash });
        mostrarMensagem(
            `Esperando ${s.nomeAdversario}…`,
            `Você escolheu ${OPCOES[escolha].nome.toLowerCase()}. Ninguém vê até os dois jogarem 🤫`,
            'aguardando',
        );
        renderizarSelos();
        tentarRevelar();
    }

    function receberLacre(msg) {
        if (msg.p !== s.partida || !Number.isInteger(msg.r)) return;
        if (msg.r !== s.rodada && msg.r !== s.rodada + 1) return;
        if (typeof msg.h !== 'string' || !/^[0-9a-f]{64}$/.test(msg.h) || s.lacres[msg.r]) return;
        // devolver o meu próprio lacre seria uma tentativa de forçar empate
        if (s.minha && msg.h === s.minha.hash) {
            conexaoCaiu(s.conn, 'trapaca');
            return;
        }
        s.lacres[msg.r] = msg.h;
        if (msg.r === s.rodada && !estado.ocupado) {
            som.pronto();
            renderizarSelos();
        }
        tentarRevelar();
    }

    // Só revelo minha jogada depois de receber o lacre do adversário
    function tentarRevelar() {
        const minha = s.minha;
        if (!minha || minha.revelado || minha.r !== s.rodada || !s.lacres[minha.r]) return;
        minha.revelado = true;
        enviar({ t: 'revelo', p: s.partida, r: minha.r, e: minha.escolha, s: minha.sal });
        tentarResolver();
    }

    async function receberJogada(msg) {
        const partida = s.partida;
        const rodada = s.rodada;
        if (msg.p !== partida || msg.r !== rodada || s.jogadas[rodada]) return;
        const lacreDele = s.lacres[rodada];
        if (!lacreDele) return; // revelou sem ter lacrado: ignora

        const valida = typeof msg.e === 'string' && Object.hasOwn(OPCOES, msg.e)
            && typeof msg.s === 'string' && /^[0-9a-f]{32}$/.test(msg.s);
        let confere = false;
        if (valida) {
            try {
                confere = (await lacrar(papelDoAdversario(), msg.e, msg.s, partida, rodada)) === lacreDele;
            } catch {
                confere = false;
            }
        }
        if (partida !== s.partida || rodada !== s.rodada || s.jogadas[rodada]) return;
        if (!confere) {
            conexaoCaiu(s.conn, 'trapaca');
            return;
        }
        s.jogadas[rodada] = msg.e;
        tentarResolver();
    }

    // As duas jogadas conferidas: hora do Jo… Ken… Pô!
    function tentarResolver() {
        const rodada = s.rodada;
        const minha = s.minha;
        const dele = s.jogadas[rodada];
        if (!minha || minha.r !== rodada || !minha.revelado || !dele) return;

        s.minha = null;
        delete s.lacres[rodada];
        delete s.jogadas[rodada];
        s.rodada = rodada + 1;

        quandoLivre(async () => {
            estado.ocupado = true;
            bloquearEscolhas(minha.escolha);
            renderizarSelos();
            const vencedor = await disputarRodada(minha.escolha, dele);
            await finalizarRodada(vencedor);
        });
    }

    // Chamado pelo jogo no fim de cada rodada (e da animação)
    function depoisDaRodada() {
        const fila = s.fila.splice(0);
        fila.forEach((acao) => acao());
        if (!ativo()) return;
        renderizarSelos();
        atualizarRevanche();
    }

    // ---------- Revanche ----------

    function pedirRevanche() {
        if (s.status !== 'jogando' || !estado.encerrada || s.revanche.eu) return;
        s.revanche.eu = true;
        som.clique();
        enviar({ t: 'revanche', p: s.partida });
        atualizarRevanche();
        verificarRevanche();
    }

    function receberRevanche(msg) {
        if (msg.p !== s.partida || s.revanche.ele) return;
        s.revanche.ele = true;
        som.pronto();
        atualizarRevanche();
        verificarRevanche();
    }

    function verificarRevanche() {
        if (s.papel === 'dono' && s.revanche.eu && s.revanche.ele) {
            quandoLivre(() => novaPartida('revanche'));
        }
    }

    function atualizarRevanche() {
        if (!adversario.online || el.modal.hidden || !estado.encerrada) return;
        const { eu, ele } = s.revanche;
        if (eu) {
            el.btnNovamente.disabled = true;
            el.btnNovamente.textContent = `Esperando ${s.nomeAdversario}…`;
        } else if (ele) {
            el.btnNovamente.textContent = 'Aceitar revanche';
        }
        // a região fica sempre no DOM (vazia) para o leitor de tela anunciar quando o texto chegar
        el.modalRevanche.textContent = ele && !eu ? `${s.nomeAdversario} quer revanche! 🔥` : '';
    }

    // ---------- Reações ----------

    function reagir(emoji) {
        if (s.status !== 'jogando' || !REACOES.includes(emoji)) return;
        const agora = Date.now();
        if (agora - s.ultimaReacao < 600) return;
        s.ultimaReacao = agora;
        enviar({ t: 'reacao', e: emoji });
        mostrarReacao(emoji, el.palcoJogador);
    }

    function receberReacao(msg) {
        if (!REACOES.includes(msg.e)) return;
        const agora = Date.now();
        s.reacoesRecebidas = s.reacoesRecebidas.filter((t) => agora - t < 3000);
        if (s.reacoesRecebidas.length >= 6) return; // limite contra spam
        s.reacoesRecebidas.push(agora);
        mostrarReacao(msg.e, el.palcoCpu);
        som.reacao();
    }

    // A bolha fica fixa na tela (fora da arena, que corta o que passa da borda)
    function mostrarReacao(emoji, palco) {
        const c = centro(palco);
        const bolha = document.createElement('span');
        bolha.className = 'reacao-voando';
        bolha.textContent = emoji;
        bolha.setAttribute('aria-hidden', 'true');
        bolha.style.left = `${c.x}px`;
        bolha.style.top = `${c.y}px`;
        bolha.style.setProperty('--dx', `${aleatorio(-40, 40)}px`);
        bolha.style.setProperty('--rot', `${aleatorio(-25, 25)}deg`);
        document.body.appendChild(bolha);
        bolha.addEventListener('animationend', () => bolha.remove());
        setTimeout(() => bolha.remove(), 2200);
    }

    // ---------- Criar sala / entrar / sair ----------

    async function criarSala() {
        if (s.status !== 'off') return;
        guardarNome();
        som.clique();
        const tentativa = ++s.tentativa;
        s.status = 'criando';
        mostrarErro('');
        definirCarregando(ui.btnCriar, true, 'Criando sala…');
        ui.btnEntrar.disabled = true;

        try {
            exigirRecursos();
            await carregarPeerJS();
            let peer = null;
            let codigo = null;
            for (let i = 0; i < 4 && !peer; i++) {
                if (tentativa !== s.tentativa) return;
                codigo = gerarCodigo();
                try {
                    peer = await criarPeer(PREFIXO + codigo);
                } catch (erro) {
                    if (!erro || erro.type !== 'unavailable-id') throw erro;
                }
            }
            if (!peer) throw { type: 'unavailable-id' };
            if (tentativa !== s.tentativa) {
                peer.destroy();
                return;
            }

            s.peer = peer;
            s.codigo = codigo;
            s.papel = 'dono';
            peer.on('connection', receberConexao);
            ligarEventosPeer(peer);
            entrarEmEspera({ titulo: 'Sala criada!', sub: 'Mande o link para um amigo entrar.' });
            mostrarEtapa('aguardando');
        } catch (erro) {
            if (tentativa !== s.tentativa) return;
            s.status = 'off';
            mostrarErro(mensagemDeErro(erro));
        } finally {
            if (tentativa === s.tentativa) {
                definirCarregando(ui.btnCriar, false);
                ui.btnEntrar.disabled = false;
            }
        }
    }

    // Dono da sala esperando alguém (logo depois de criar, ou quando o adversário sai)
    function entrarEmEspera({ titulo, sub }) {
        s.status = 'aguardando';
        s.nomeAdversario = '';
        s.adversarioEscondido = false;
        zerarPartida();
        esconderModal();
        definirAdversario({ nome: 'Aguardando…', emoji: '⏳', online: true });
        mostrarInterfaceOnline();
        renderizarCodigoGrande();
        ui.linkSala.value = linkDaSala();
        reiniciarPartida(titulo, sub);
        bloquearEscolhas();
        renderizarSelos();
    }

    async function entrarNaSala() {
        if (s.status !== 'off') return;
        const codigo = normalizarCodigo(ui.inputCodigo.value);
        if (!REGEX_CODIGO.test(codigo)) {
            mostrarErro('Digite o código de 5 letras da sala.');
            ui.inputCodigo.focus();
            return;
        }
        guardarNome();
        som.clique();
        const tentativa = ++s.tentativa;
        // partida 0: o convidado espera o número que o dono da sala mandar
        Object.assign(s, { status: 'conectando', papel: 'convidado', codigo, partida: 0 });
        mostrarErro('');
        ui.codigoConectando.textContent = codigo;
        mostrarEtapa('conectando');

        try {
            exigirRecursos();
            await carregarPeerJS();
            const peer = await criarPeer(null);
            if (tentativa !== s.tentativa) {
                peer.destroy();
                return;
            }
            s.peer = peer;
            ligarEventosPeer(peer);
            const conn = peer.connect(PREFIXO + codigo, { reliable: true });
            ligarConexao(conn);
            clearTimeout(s.timerConexao);
            s.timerConexao = setTimeout(() => {
                if (s.status === 'conectando' && tentativa === s.tentativa) falharConexao({ type: 'tempo-conexao' });
            }, CONEXAO_MS);
        } catch (erro) {
            if (tentativa !== s.tentativa) return;
            falharConexao(erro);
        }
    }

    function falharConexao(erro) {
        desmontar();
        mostrarEtapa('inicio');
        mostrarErro(mensagemDeErro(erro));
        if (!painelAberto()) abrirPainel();
    }

    function adversarioSaiu(motivo) {
        if (s.status === 'off') return; // a gente já tinha saído antes
        const nome = s.nomeAdversario || 'Seu adversário';
        som.saiu();
        let aviso;
        if (motivo === 'trapaca') aviso = `A jogada de ${nome} não bateu com o lacre. Conexão encerrada.`;
        else if (motivo === 'silencio') aviso = `A conexão com ${nome} caiu.`;
        else aviso = s.papel === 'dono' ? `${nome} saiu da sala.` : `${nome} fechou a sala.`;
        toast(aviso, 'erro');

        if (s.papel === 'dono' && s.peer && !s.peer.destroyed) {
            entrarEmEspera({ titulo: `${nome} saiu`, sub: 'A sala continua aberta: mande o link para alguém entrar.' });
        } else {
            desmontar();
            voltarAoComputador('Partida online encerrada', 'De volta ao modo contra o computador.');
        }
    }

    // Botão "Sair": avisa o outro jogador e volta a jogar contra o computador
    function sair() {
        if (s.status === 'off') return;
        enviar({ t: 'tchau' });
        desmontar();
        quandoLivre(() => voltarAoComputador('Você saiu da sala online', 'De volta ao modo contra o computador.'));
    }

    function voltarAoComputador(titulo, sub) {
        const ativoAntes = document.activeElement;
        const focoPerdido = ativoAntes === document.body || el.modal.contains(ativoAntes)
            || ui.modal.contains(ativoAntes) || ui.barra.contains(ativoAntes);
        fecharPainel({ devolverFoco: false });
        esconderModal();
        ui.barra.hidden = true;
        ui.reacoes.hidden = true;
        ui.btnOnline.hidden = false;
        atualizarBarra();
        if (focoPerdido) ui.btnOnline.focus({ preventScroll: true });
        definirAdversario(COMPUTADOR);
        atualizarModosBloqueados();
        limparConviteDaUrl();
        reiniciarPartida(titulo, sub);
        renderizarSelos();
    }

    // ---------- Comandos vindos do jogo (modo e placar) ----------

    function mudarModo(modo) {
        if (s.papel !== 'dono') {
            toast('Só quem criou a sala escolhe o modo de jogo.');
            return;
        }
        som.clique();
        aplicarModo(modo);
        if (s.status === 'jogando') quandoLivre(() => novaPartida('modo'));
    }

    function reiniciar() {
        if (s.papel !== 'dono') {
            toast('Só quem criou a sala pode zerar o placar.');
            return;
        }
        if (s.status !== 'jogando') {
            toast('Ninguém entrou na sala ainda.');
            return;
        }
        reiniciarAnimacao(el.btnReiniciar, 'girando');
        som.clique();
        novaPartida('reinicio');
    }

    // ---------- Interface ----------

    function mostrarInterfaceOnline() {
        ui.btnOnline.hidden = true;
        ui.barra.hidden = false;
        ui.reacoes.hidden = s.status !== 'jogando';
        atualizarModosBloqueados();
        atualizarBarra();
    }

    function atualizarBarra() {
        ui.codigoBarra.textContent = s.codigo || '-----';
        const semServidor = Boolean(s.peer && s.peer.disconnected);
        let texto = 'Aguardando adversário…';
        let classe = '';
        if (s.status === 'jogando') {
            texto = `Jogando contra ${s.nomeAdversario}`;
            classe = 'conectado';
        } else if (semServidor) {
            texto = 'Reconectando ao servidor…';
            classe = 'instavel';
        }
        ui.statusBarra.textContent = texto;
        ui.ponto.className = `online-ponto ${classe}`.trim();
    }

    function atualizarModosBloqueados() {
        const bloquear = s.papel === 'convidado' && ativo();
        el.modos.forEach((botao) => {
            if (bloquear) {
                botao.setAttribute('aria-disabled', 'true');
                botao.title = 'Só quem criou a sala escolhe o modo';
            } else {
                botao.removeAttribute('aria-disabled');
                botao.removeAttribute('title');
            }
        });
    }

    function renderizarSelos() {
        const mostrar = s.status === 'jogando' && s.partida > 0 && !estado.ocupado && !estado.encerrada;
        if (!mostrar) {
            definirSelo(el.seloJogador, '');
            definirSelo(el.seloCpu, '');
            return;
        }
        const euPronto = s.preparando || Boolean(s.minha && s.minha.r === s.rodada);
        const elePronto = Boolean(s.lacres[s.rodada]);
        definirSelo(el.seloJogador, euPronto ? '✔ Pronto' : '', 'pronto');
        if (elePronto) definirSelo(el.seloCpu, '✔ Pronto', 'pronto');
        else definirSelo(el.seloCpu, 'Pensando', 'pensando');
    }

    function renderizarCodigoGrande() {
        const letras = [...(s.codigo || '')].map((letra, i) => {
            const span = document.createElement('span');
            span.textContent = letra;
            span.style.setProperty('--i', i);
            return span;
        });
        ui.codigoGrande.replaceChildren(...letras);
        ui.codigoGrande.setAttribute('aria-label', `Código da sala: ${(s.codigo || '').split('').join(' ')}`);
    }

    function mostrarEtapa(nome) {
        ui.etapas.forEach((etapa) => {
            etapa.hidden = etapa.dataset.etapa !== nome;
        });
        if (nome === 'aguardando') {
            ui.btnCompartilhar.hidden = typeof navigator.share !== 'function';
            ui.linkSala.value = linkDaSala();
        }
        if (!ui.modal.hidden) focarEtapa(nome);
    }

    function focarEtapa(nome) {
        let alvo = null;
        if (nome === 'inicio') {
            if (REGEX_CODIGO.test(ui.inputCodigo.value) && !ui.convite.hidden) alvo = ui.inputNome.value ? ui.btnEntrar : ui.inputNome;
            else alvo = ui.inputNome.value ? ui.btnCriar : ui.inputNome;
        } else if (nome === 'aguardando') {
            alvo = ui.btnCopiarLink;
        } else {
            alvo = ui.btnCancelarConexao;
        }
        if (alvo) alvo.focus({ preventScroll: true });
    }

    function mostrarErro(texto) {
        ui.erro.textContent = texto;
    }

    function definirCarregando(botao, carregando, texto = '') {
        if (carregando) {
            if (!botao.dataset.textoOriginal) botao.dataset.textoOriginal = botao.textContent;
            botao.textContent = texto;
            botao.disabled = true;
        } else {
            if (botao.dataset.textoOriginal) botao.textContent = botao.dataset.textoOriginal;
            delete botao.dataset.textoOriginal;
            botao.disabled = false;
        }
    }

    function painelAberto() {
        return Boolean(ui.modal) && !ui.modal.hidden;
    }

    function abrirPainel() {
        if (estado.ocupado) {
            toast('Espere a rodada terminar.');
            return;
        }
        if (s.status === 'off') mostrarEtapa('inicio');
        else if (s.status === 'aguardando') mostrarEtapa('aguardando');
        clearTimeout(s.timerPainel);
        el.app.inert = true;
        ui.modal.hidden = false;
        void ui.modal.offsetWidth;
        ui.modal.classList.add('aberto');
        const etapaVisivel = ui.etapas.find((etapa) => !etapa.hidden);
        focarEtapa(etapaVisivel ? etapaVisivel.dataset.etapa : 'inicio');
    }

    function fecharPainel({ devolverFoco = true } = {}) {
        if (!painelAberto()) return;
        // fechar no meio da criação/conexão cancela a tentativa
        if (s.status === 'criando' || s.status === 'conectando') {
            desmontar();
            definirCarregando(ui.btnCriar, false);
            ui.btnEntrar.disabled = false;
            mostrarEtapa('inicio');
        }
        ui.modal.classList.remove('aberto');
        if (el.modal.hidden) el.app.inert = false;
        clearTimeout(s.timerPainel);
        s.timerPainel = setTimeout(() => {
            ui.modal.hidden = true;
        }, 300);
        if (devolverFoco) {
            const alvo = ui.btnOnline.hidden ? ui.btnCopiarBarra : ui.btnOnline;
            alvo.focus({ preventScroll: true });
        }
    }

    async function copiarLink() {
        const link = linkDaSala();
        let copiou = false;
        try {
            await navigator.clipboard.writeText(link);
            copiou = true;
        } catch {
            // plano B para navegadores sem a API de área de transferência
            const campo = document.createElement('textarea');
            campo.value = link;
            campo.setAttribute('readonly', '');
            campo.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
            document.body.appendChild(campo);
            campo.select();
            try {
                copiou = document.execCommand('copy');
            } catch {
                copiou = false;
            }
            campo.remove();
        }
        if (copiou) {
            som.clique();
            toast('🔗 Link copiado! Mande para seu amigo.', 'sucesso');
        } else {
            toast(`Copie o link: ${link}`);
        }
    }

    async function compartilhar() {
        try {
            await navigator.share({
                title: 'JoKenPô online',
                text: `Bora jogar JoKenPô comigo? Sala ${s.codigo}`,
                url: linkDaSala(),
            });
        } catch {
            /* a pessoa cancelou */
        }
    }

    // ---------- Convite pelo link (?sala=CODIGO) ----------

    function lerConvite() {
        const codigo = normalizarCodigo(new URLSearchParams(window.location.search).get('sala'));
        if (!REGEX_CODIGO.test(codigo)) return;
        ui.inputCodigo.value = codigo;
        ui.conviteCodigo.textContent = codigo;
        ui.convite.hidden = false;
        ui.textoOnline.textContent = 'Digite seu nome e clique em Entrar para começar.';
        abrirPainel();
    }

    function limparConviteDaUrl() {
        ui.convite.hidden = true;
        ui.textoOnline.textContent = ui.textoOnline.dataset.original;
        const url = new URL(window.location.href);
        if (!url.searchParams.has('sala')) return;
        url.searchParams.delete('sala');
        history.replaceState(null, '', url.toString());
    }

    // ---------- Início ----------

    function iniciar() {
        const $o = (seletor) => document.querySelector(seletor);
        Object.assign(ui, {
            modal: $o('#modal-online'),
            etapas: [...document.querySelectorAll('#modal-online .etapa')],
            btnOnline: $o('#btn-online'),
            btnFechar: $o('#btn-fechar-online'),
            inputNome: $o('#input-nome'),
            inputCodigo: $o('#input-codigo'),
            btnCriar: $o('#btn-criar-sala'),
            btnEntrar: $o('#btn-entrar-sala'),
            erro: $o('#erro-online'),
            convite: $o('#convite'),
            conviteCodigo: $o('#convite-codigo'),
            textoOnline: $o('#online-texto'),
            codigoGrande: $o('#codigo-grande'),
            linkSala: $o('#link-sala'),
            btnCopiarLink: $o('#btn-copiar-link'),
            btnCompartilhar: $o('#btn-compartilhar'),
            btnCancelarSala: $o('#btn-cancelar-sala'),
            codigoConectando: $o('#codigo-conectando'),
            btnCancelarConexao: $o('#btn-cancelar-conexao'),
            barra: $o('#barra-online'),
            ponto: $o('#online-ponto'),
            codigoBarra: $o('#online-codigo'),
            statusBarra: $o('#online-status'),
            btnCopiarBarra: $o('#btn-copiar-barra'),
            btnSairSala: $o('#btn-sair-sala'),
            reacoes: $o('#reacoes'),
        });
        ui.textoOnline.dataset.original = ui.textoOnline.textContent;
        ui.inputNome.value = limparNome(armazenamento.ler(CHAVE_NOME, ''));
        ui.btnOnline.hidden = false; // só aparece depois que o modo online carregou

        ui.btnOnline.addEventListener('click', () => {
            som.clique();
            abrirPainel();
        });
        ui.btnFechar.addEventListener('click', () => fecharPainel());
        ui.modal.addEventListener('click', (e) => {
            if (e.target === ui.modal) fecharPainel();
        });
        ui.btnCriar.addEventListener('click', criarSala);
        ui.btnEntrar.addEventListener('click', entrarNaSala);
        ui.inputCodigo.addEventListener('input', () => {
            const normalizado = normalizarCodigo(ui.inputCodigo.value);
            if (normalizado !== ui.inputCodigo.value) ui.inputCodigo.value = normalizado;
            mostrarErro('');
        });
        ui.inputCodigo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') entrarNaSala();
        });
        ui.inputNome.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (REGEX_CODIGO.test(ui.inputCodigo.value)) entrarNaSala();
            else criarSala();
        });
        ui.btnCopiarLink.addEventListener('click', copiarLink);
        ui.btnCopiarBarra.addEventListener('click', copiarLink);
        ui.btnCompartilhar.addEventListener('click', compartilhar);
        ui.btnCancelarSala.addEventListener('click', sair);
        ui.btnCancelarConexao.addEventListener('click', () => fecharPainel());
        ui.btnSairSala.addEventListener('click', sair);
        ui.reacoes.querySelectorAll('.reacao').forEach((botao) => {
            botao.addEventListener('click', () => reagir(botao.dataset.reacao));
        });

        // Ao voltar para a aba, dá um fôlego antes de considerar a conexão perdida.
        // E avisa o outro jogador, para ele ter paciência enquanto a gente está em outro app.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) s.ultimoContato = Date.now();
            enviar({ t: 'visivel', h: document.hidden });
        });
        window.addEventListener('pagehide', () => enviar({ t: 'tchau' }));

        lerConvite();
    }

    return {
        iniciar,
        ativo,
        podeJogar,
        explicarBloqueio,
        jogar,
        depoisDaRodada,
        pedirRevanche,
        sair,
        mudarModo,
        reiniciar,
        painelAberto,
        fecharPainel,
    };
})();
