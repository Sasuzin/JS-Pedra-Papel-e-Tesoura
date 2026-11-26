'use strict';

/* =========================================================
   JoKenPô: chat da sala (modo online)

   As mensagens vão pela mesma conexão direta da partida
   (online.js). Este arquivo cuida só da conversa: a tela do
   chat, o balão em cima da mão de quem escreveu e os limites
   contra spam. Tudo o que chega do outro jogador entra na
   tela apenas como texto.
   ========================================================= */

const chat = (() => {
    const MAX_CARACTERES = 200;
    const MAX_HISTORICO = 100;
    const INTERVALO_ENVIO_MS = 700; // no máximo uma mensagem a cada 0,7 s
    const LIMITE_RECEBIDAS = 8; // mais que isso em 10 s é ignorado (spam)
    const JANELA_RECEBIDAS_MS = 10000;
    const PREVIA_MS = 4500;

    // Caracteres de controle e de direção do texto (montados por código, sem ficarem "crus" no arquivo).
    // U+200C/U+200D ficam de fora: eles juntam emojis compostos (família, profissões, bandeiras…).
    const hex = (n) => n.toString(16).padStart(4, '0');
    const faixa = (de, ate) => `\\u${hex(de)}-\\u${hex(ate)}`;
    const INVISIVEIS = new RegExp(
        `[${faixa(0x0, 0x1f)}${faixa(0x7f, 0x9f)}${faixa(0x200b, 0x200b)}${faixa(0x200e, 0x200f)}${faixa(0x202a, 0x202e)}${faixa(0x2066, 0x2069)}]`,
        'g',
    );

    const estadoChat = {
        ativo: false,
        aberto: false,
        nomeAdversario: '',
        naoLidas: 0,
        ultimoEnvio: 0,
        recebidas: [],
        timerPrevia: null,
        baloes: new Map(), // lado -> balão visível
    };

    const ui = {};

    // ---------- Utilidades ----------

    function limparTexto(texto) {
        return (typeof texto === 'string' ? texto : '')
            .replace(INVISIVEIS, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_CARACTERES);
    }

    function horaAgora() {
        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    // rola para o fim só se a pessoa já estava lá embaixo (não atrapalha quem está lendo o histórico)
    function pertoDoFim() {
        const lista = ui.mensagens;
        return lista.scrollHeight - lista.scrollTop - lista.clientHeight < 60;
    }

    // ---------- Mensagens na tela ----------

    function adicionar(tipo, texto) {
        const estavaNoFim = pertoDoFim();
        const item = document.createElement('li');
        item.className = `msg ${tipo}`;
        if (tipo === 'sistema') {
            item.textContent = texto;
        } else {
            const corpo = document.createElement('span');
            corpo.textContent = texto;
            const hora = document.createElement('time');
            hora.className = 'hora';
            hora.textContent = horaAgora();
            // leitor de tela: diz quem falou
            const quem = document.createElement('span');
            quem.className = 'sr-only';
            quem.textContent = tipo === 'eu' ? 'Você: ' : `${estadoChat.nomeAdversario}: `;
            item.append(quem, corpo, hora);
        }
        ui.mensagens.appendChild(item);
        while (ui.mensagens.children.length > MAX_HISTORICO) ui.mensagens.firstElementChild.remove();
        if (estavaNoFim || tipo === 'eu') ui.mensagens.scrollTop = ui.mensagens.scrollHeight;
    }

    function sistema(texto) {
        if (estadoChat.ativo) adicionar('sistema', texto);
    }

    // Balão de fala em cima da mão de quem escreveu (fica alguns segundos e some)
    function mostrarBalao(lado, texto) {
        const palco = lado === 'eu' ? el.palcoJogador : el.palcoCpu;
        if (!palco || ui.semPartidaOnline()) return;
        const r = palco.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return; // arena fora da tela
        const anterior = estadoChat.baloes.get(lado);
        if (anterior) anterior.remove();
        const balao = document.createElement('div');
        balao.className = `balao-chat ${lado}`;
        balao.setAttribute('aria-hidden', 'true');
        balao.textContent = texto.length > 80 ? `${texto.slice(0, 78)}…` : texto;
        // preso à página (não à tela), para acompanhar a mão se a pessoa rolar
        balao.style.left = `${r.left + window.scrollX + r.width / 2}px`;
        balao.style.top = `${r.top + window.scrollY - 16}px`; // acima do selo "pensando/pronto"
        document.body.appendChild(balao);
        estadoChat.baloes.set(lado, balao);
        const remover = () => {
            balao.remove();
            if (estadoChat.baloes.get(lado) === balao) estadoChat.baloes.delete(lado);
        };
        balao.addEventListener('animationend', remover);
        setTimeout(remover, 5000);
    }

    function removerBaloes() {
        estadoChat.baloes.forEach((balao) => balao.remove());
        estadoChat.baloes.clear();
    }

    function atualizarBadge() {
        const n = estadoChat.naoLidas;
        ui.badge.hidden = n === 0;
        ui.badge.textContent = n > 9 ? '9+' : String(n);
        ui.botao.setAttribute('aria-label', n ? `Abrir o chat da sala (${n} nova${n > 1 ? 's' : ''})` : 'Abrir o chat da sala');
    }

    function mostrarPrevia(texto) {
        clearTimeout(estadoChat.timerPrevia);
        const nome = document.createElement('b');
        nome.textContent = `${estadoChat.nomeAdversario}: `;
        ui.previa.replaceChildren(nome, document.createTextNode(texto));
        ui.previa.hidden = false;
        ui.previa.style.animation = 'none';
        void ui.previa.offsetWidth;
        ui.previa.style.animation = '';
        estadoChat.timerPrevia = setTimeout(() => {
            ui.previa.hidden = true;
        }, PREVIA_MS);
    }

    function esconderPrevia() {
        clearTimeout(estadoChat.timerPrevia);
        ui.previa.hidden = true;
    }

    // ---------- Abrir e fechar ----------

    function abrir() {
        if (!estadoChat.ativo || estadoChat.aberto) return;
        estadoChat.aberto = true;
        estadoChat.naoLidas = 0;
        atualizarBadge();
        esconderPrevia();
        ui.painel.hidden = false;
        document.body.classList.add('chat-aberto');
        ui.botao.setAttribute('aria-expanded', 'true');
        ui.mensagens.scrollTop = ui.mensagens.scrollHeight;
        // no celular, focar o campo abriria o teclado e esconderia o topo do chat
        if (window.matchMedia('(hover: none)').matches) ui.painel.focus({ preventScroll: true });
        else ui.input.focus({ preventScroll: true });
    }

    function fechar({ devolverFoco = true } = {}) {
        if (!estadoChat.aberto) return;
        const focoDentro = ui.painel.contains(document.activeElement);
        estadoChat.aberto = false;
        ui.painel.hidden = true;
        document.body.classList.remove('chat-aberto');
        ui.botao.setAttribute('aria-expanded', 'false');
        if (devolverFoco && focoDentro && !ui.botao.hidden) ui.botao.focus({ preventScroll: true });
    }

    function alternar() {
        if (estadoChat.aberto) fechar();
        else abrir();
    }

    // ---------- Enviar e receber ----------

    function enviar(textoBruto) {
        if (!estadoChat.ativo) return false;
        const texto = limparTexto(textoBruto);
        if (!texto) return false;
        const agora = Date.now();
        if (agora - estadoChat.ultimoEnvio < INTERVALO_ENVIO_MS) {
            reiniciarAnimacao(ui.form, 'negada');
            return false;
        }
        if (typeof online === 'undefined' || !online.enviarChat(texto)) {
            sistema('Não deu para enviar: a conexão com a sala caiu.');
            return false;
        }
        estadoChat.ultimoEnvio = agora;
        adicionar('eu', texto);
        mostrarBalao('eu', texto);
        som.clique();
        return true;
    }

    // Chamado pelo online.js quando chega uma mensagem do adversário
    function receber(textoBruto) {
        if (!estadoChat.ativo) return;
        const texto = limparTexto(textoBruto);
        if (!texto) return;
        const agora = Date.now();
        estadoChat.recebidas = estadoChat.recebidas.filter((t) => agora - t < JANELA_RECEBIDAS_MS);
        if (estadoChat.recebidas.length >= LIMITE_RECEBIDAS) return; // spam: ignora
        estadoChat.recebidas.push(agora);

        adicionar('ele', texto);
        mostrarBalao('ele', texto);
        som.reacao();
        if (!estadoChat.aberto) {
            estadoChat.naoLidas += 1;
            atualizarBadge();
            mostrarPrevia(texto);
            reiniciarAnimacao(ui.botao, 'pulo');
            // com o chat fechado, a lista não é lida: avisa o leitor de tela por aqui
            ui.anuncio.textContent = `${estadoChat.nomeAdversario} disse: ${texto}`;
        }
    }

    // ---------- Começo e fim da conversa (chamados pelo online.js) ----------

    function comecar(nomeAdversario) {
        estadoChat.ativo = true;
        estadoChat.nomeAdversario = nomeAdversario;
        estadoChat.naoLidas = 0;
        estadoChat.recebidas = [];
        estadoChat.ultimoEnvio = 0;
        ui.mensagens.replaceChildren();
        ui.com.textContent = `com ${nomeAdversario}`;
        ui.input.value = '';
        atualizarBadge();
        ui.botao.hidden = false;
        sistema(`Você e ${nomeAdversario} estão na sala. Diga oi! 👋`);
    }

    // Devolve true se o foco do teclado estava no chat (quem chamou decide para onde ele vai)
    function encerrar() {
        if (!estadoChat.ativo) return false;
        const ativo = document.activeElement;
        const tinhaFoco = ui.painel.contains(ativo) || ativo === ui.botao;
        fechar({ devolverFoco: false });
        estadoChat.ativo = false;
        estadoChat.naoLidas = 0;
        atualizarBadge();
        esconderPrevia();
        removerBaloes();
        ui.botao.hidden = true;
        ui.mensagens.replaceChildren();
        ui.anuncio.textContent = '';
        return tinhaFoco;
    }

    // ---------- Início ----------

    function iniciar() {
        const $c = (seletor) => document.querySelector(seletor);
        Object.assign(ui, {
            botao: $c('#btn-chat'),
            badge: $c('#chat-badge'),
            previa: $c('#chat-previa'),
            painel: $c('#chat'),
            com: $c('#chat-com'),
            fecharBotao: $c('#btn-fechar-chat'),
            mensagens: $c('#chat-mensagens'),
            form: $c('#chat-form'),
            input: $c('#chat-input'),
            rapidas: [...document.querySelectorAll('.chat-rapida')],
            anuncio: $c('#chat-anuncio'),
            // balões só fazem sentido com a arena da partida online na tela
            semPartidaOnline: () => !document.body.classList.contains('modo-online'),
        });
        ui.input.maxLength = MAX_CARACTERES;

        ui.botao.addEventListener('click', alternar);
        ui.fecharBotao.addEventListener('click', () => fechar());
        ui.form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (enviar(ui.input.value)) ui.input.value = '';
            ui.input.focus({ preventScroll: true });
        });
        ui.rapidas.forEach((botao) => botao.addEventListener('click', (e) => {
            enviar(botao.textContent);
            // no computador, volta para o campo de texto (no celular isso abriria o teclado)
            if (e.detail > 0 && window.matchMedia('(hover: hover)').matches) ui.input.focus({ preventScroll: true });
        }));
        ui.painel.addEventListener('keydown', (e) => {
            e.stopPropagation(); // nada digitado dentro do chat vira atalho do jogo (R, M, 1/2/3)
            if (e.key === 'Escape') fechar(); // Esc fecha só o chat
        });
        ui.form.addEventListener('animationend', (e) => {
            if (e.animationName === 'negar') ui.form.classList.remove('negada');
        });
        // girar o celular ou abrir o teclado muda o layout: balões antigos ficariam fora do lugar
        window.addEventListener('resize', removerBaloes);
    }

    return { iniciar, comecar, encerrar, receber, sistema, abrir, fechar };
})();
