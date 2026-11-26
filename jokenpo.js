'use strict';

/* =========================================================
   JoKenPô: pedra, papel e tesoura contra o computador
   ========================================================= */

// ---------- Configuração ----------

const OPCOES = {
    pedra: { emoji: '✊', nome: 'Pedra', vence: 'tesoura', verbo: 'amassa' },
    papel: { emoji: '✋', nome: 'Papel', vence: 'pedra', verbo: 'embrulha' },
    tesoura: { emoji: '✌️', nome: 'Tesoura', vence: 'papel', verbo: 'corta' },
};
const CHAVES = Object.keys(OPCOES);
const TECLAS = { 1: 'pedra', 2: 'papel', 3: 'tesoura' };

// alvo = vitórias necessárias para levar a partida (0 = sem fim)
const MODOS = {
    livre: { alvo: 0, titulo: 'Modo livre', texto: 'Jogue quantas rodadas quiser!' },
    md3: { alvo: 2, titulo: 'Melhor de 3', texto: 'Quem vencer 2 rodadas primeiro leva a partida.' },
    md5: { alvo: 3, titulo: 'Melhor de 5', texto: 'Quem vencer 3 rodadas primeiro leva a partida.' },
};

const MOVIMENTO_REDUZIDO = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const BATIDA = MOVIMENTO_REDUZIDO ? 180 : 360; // ms de cada "Jo", "Ken", "Pô"
const PALAVRAS = ['JO', 'KEN', 'PÔ!'];
const MAX_HISTORICO = 12;
const CHAVE_RECORDE = 'jokenpo:recorde';
const CHAVE_SOM = 'jokenpo:som';

// ---------- Armazenamento (pode não existir em janela anônima) ----------

const armazenamento = {
    ler(chave, padrao) {
        try {
            const valor = localStorage.getItem(chave);
            return valor === null ? padrao : JSON.parse(valor);
        } catch {
            return padrao;
        }
    },
    gravar(chave, valor) {
        try {
            localStorage.setItem(chave, JSON.stringify(valor));
        } catch {
            /* sem armazenamento: segue o jogo */
        }
    },
};

// ---------- Estado ----------

const estado = {
    jogador: 0,
    computador: 0,
    empates: 0,
    sequencia: 0,
    recorde: Number(armazenamento.ler(CHAVE_RECORDE, 0)) || 0,
    som: armazenamento.ler(CHAVE_SOM, true) !== false,
    modo: 'livre',
    ocupado: false, // rodada em andamento
    encerrada: false, // partida (melhor de 3/5) terminou
};

// Quem está do outro lado: o computador ou um jogador online
const COMPUTADOR = { nome: 'Computador', emoji: '🤖', online: false };
let adversario = { ...COMPUTADOR };

// online.js é carregado depois deste arquivo; até lá (ou se falhar) o jogo segue offline
const modoOnline = () => typeof online !== 'undefined' && online.ativo();

// ---------- Elementos ----------

const $ = (seletor) => document.querySelector(seletor);
const $$ = (seletor) => [...document.querySelectorAll(seletor)];

const el = {
    app: $('#app'),
    flash: $('#flash'),
    arena: $('#arena'),
    versus: $('#versus'),
    contagem: $('#contagem'),

    placarJogador: $('#placar-jogador'),
    placarCpu: $('#placar-cpu'),
    rotuloCpu: $('#rotulo-cpu'),
    nomeCpu: $('#nome-cpu'),
    seloJogador: $('#selo-jogador'),
    seloCpu: $('#selo-cpu'),
    pontosJogador: $('#pontos-jogador'),
    pontosCpu: $('#pontos-cpu'),
    pipsJogador: $('#pips-jogador'),
    pipsCpu: $('#pips-cpu'),
    rodadas: $('#rodadas'),
    empates: $('#empates'),

    lutadorJogador: $('#lutador-jogador'),
    lutadorCpu: $('#lutador-cpu'),
    palcoJogador: $('#palco-jogador'),
    palcoCpu: $('#palco-cpu'),
    maoJogador: $('#mao-jogador'),
    maoCpu: $('#mao-cpu'),

    resultado: $('#resultado'),
    resultadoTitulo: $('#resultado-titulo'),
    resultadoSub: $('#resultado-sub'),

    escolhas: $$('.escolha'),
    modosBox: $('#modos'),
    modos: $$('.modo'),

    statSequencia: $('#stat-sequencia'),
    statRecorde: $('#stat-recorde'),
    sequencia: $('#sequencia'),
    recorde: $('#recorde'),
    aproveitamento: $('#aproveitamento'),
    barra: $('#barra'),
    barraV: $('#barra-v'),
    barraE: $('#barra-e'),
    barraD: $('#barra-d'),
    legV: $('#leg-v'),
    legE: $('#leg-e'),
    legD: $('#leg-d'),

    historico: $('#historico'),
    historicoVazio: $('#historico-vazio'),

    btnSom: $('#btn-som'),
    btnReiniciar: $('#btn-reiniciar'),
    toasts: $('#toasts'),

    modal: $('#modal'),
    modalIcone: $('#modal-icone'),
    modalTitulo: $('#modal-titulo'),
    modalPlacar: $('#modal-placar'),
    modalTexto: $('#modal-texto'),
    modalRevanche: $('#modal-revanche'),
    btnNovamente: $('#btn-novamente'),
    btnSairPartida: $('#btn-sair-partida'),
};
el.wrapJogador = el.maoJogador.parentElement;
el.wrapCpu = el.maoCpu.parentElement;

// ---------- Utilidades ----------

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const aleatorio = (min, max) => min + Math.random() * (max - min);
const sortear = () => CHAVES[Math.floor(Math.random() * CHAVES.length)];
const totalRodadas = () => estado.jogador + estado.computador + estado.empates;

function decidir(jogador, computador) {
    if (jogador === computador) return 'empate';
    return OPCOES[jogador].vence === computador ? 'vitoria' : 'derrota';
}

// Remove e recoloca a classe para a animação CSS rodar de novo
function reiniciarAnimacao(elemento, classe) {
    elemento.classList.remove(classe);
    void elemento.offsetWidth;
    elemento.classList.add(classe);
}

function centro(elemento) {
    const r = elemento.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function animarNumero(elemento, para, sufixo = '') {
    const de = Number(elemento.dataset.valor || 0);
    elemento.dataset.valor = para;
    if (MOVIMENTO_REDUZIDO || de === para) {
        elemento.textContent = `${para}${sufixo}`;
        return;
    }
    const inicio = performance.now();
    const duracao = 650;
    const passo = (agora) => {
        const p = Math.min(1, (agora - inicio) / duracao);
        const suavizado = 1 - Math.pow(1 - p, 3);
        elemento.textContent = `${Math.round(de + (para - de) * suavizado)}${sufixo}`;
        if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
}

// ---------- Sons (gerados na hora com Web Audio, sem arquivos) ----------

const som = (() => {
    let ctx = null;

    function contexto(criar) {
        if (!ctx && criar) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) ctx = new AudioCtx();
        }
        if (ctx && criar && ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function tom(freq, duracao, { tipo = 'sine', volume = 0.12, atraso = 0, ate = null, criar = true } = {}) {
        if (!estado.som) return;
        const c = contexto(criar);
        if (!c || (!criar && c.state !== 'running')) return;

        const t0 = c.currentTime + atraso;
        const osc = c.createOscillator();
        const ganho = c.createGain();
        osc.type = tipo;
        osc.frequency.setValueAtTime(freq, t0);
        if (ate) osc.frequency.exponentialRampToValueAtTime(ate, t0 + duracao);
        ganho.gain.setValueAtTime(0.0001, t0);
        ganho.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
        ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + duracao);
        osc.connect(ganho);
        ganho.connect(c.destination);
        osc.start(t0);
        osc.stop(t0 + duracao + 0.05);
    }

    return {
        // o hover só toca depois que o áudio já foi liberado por um clique
        passar: () => tom(1250, 0.035, { volume: 0.018, criar: false }),
        clique: () => tom(620, 0.07, { tipo: 'triangle', volume: 0.08 }),
        batida: (i) => tom([330, 392, 523][i] || 440, 0.11, { tipo: 'square', volume: 0.05 }),
        impacto: () => {
            tom(190, 0.3, { volume: 0.32, ate: 45 });
            tom(95, 0.22, { tipo: 'triangle', volume: 0.18 });
        },
        vitoria: () => [523.25, 659.25, 783.99, 1046.5]
            .forEach((f, i) => tom(f, 0.22, { tipo: 'triangle', volume: 0.1, atraso: 0.08 + i * 0.08 })),
        derrota: () => [392, 311.13, 233.08]
            .forEach((f, i) => tom(f, 0.32, { tipo: 'sawtooth', volume: 0.045, atraso: 0.08 + i * 0.14 })),
        empate: () => [440, 440]
            .forEach((f, i) => tom(f, 0.14, { tipo: 'triangle', volume: 0.08, atraso: 0.08 + i * 0.16 })),
        fanfarra: () => {
            [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
                .forEach((f, i) => tom(f, 0.2, { tipo: 'square', volume: 0.045, atraso: i * 0.11 }));
            [523.25, 659.25, 783.99, 1046.5]
                .forEach((f) => tom(f, 1.1, { tipo: 'triangle', volume: 0.06, atraso: 0.68 }));
        },
        lamento: () => [392, 370, 349.23, 293.66]
            .forEach((f, i) => tom(f, i === 3 ? 0.7 : 0.28, { tipo: 'triangle', volume: 0.08, atraso: i * 0.26 })),
        // sons do modo online (criar: false porque podem chegar antes de qualquer clique)
        entrou: () => [587.33, 880, 1174.66]
            .forEach((f, i) => tom(f, 0.18, { tipo: 'triangle', volume: 0.09, atraso: i * 0.1, criar: false })),
        saiu: () => [523.25, 392]
            .forEach((f, i) => tom(f, 0.22, { tipo: 'triangle', volume: 0.08, atraso: i * 0.15, criar: false })),
        pronto: () => tom(988, 0.09, { tipo: 'sine', volume: 0.07, criar: false }),
        reacao: () => tom(740, 0.12, { tipo: 'sine', volume: 0.07, ate: 1320, criar: false }),
    };
})();

// ---------- Efeitos de partículas (confete e faíscas) ----------

const fx = (() => {
    const canvas = $('#fx');
    const ctx = canvas.getContext('2d');
    const CORES = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80', '#fb923c'];
    let particulas = [];
    let rodando = false;
    let largura = 0;
    let altura = 0;

    function ajustar() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        largura = window.innerWidth;
        altura = window.innerHeight;
        canvas.width = Math.round(largura * dpr);
        canvas.height = Math.round(altura * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ajustar();
    window.addEventListener('resize', ajustar);

    function quadro() {
        ctx.clearRect(0, 0, largura, altura);
        for (const p of particulas) {
            p.vx *= p.atrito;
            p.vy = p.vy * p.atrito + p.gravidade;
            p.x += p.vx;
            p.y += p.vy;
            p.giro += p.vgiro;
            p.vida -= 1;

            ctx.globalAlpha = Math.max(0, Math.min(1, p.vida / 40));
            ctx.fillStyle = p.cor;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.giro);
            if (p.tipo === 'confete') {
                ctx.scale(1, Math.cos(p.giro * 3));
                ctx.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.tam, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        particulas = particulas.filter((p) => p.vida > 0 && p.y < altura + 60);

        if (particulas.length) {
            requestAnimationFrame(quadro);
        } else {
            rodando = false;
            ctx.clearRect(0, 0, largura, altura);
        }
    }

    function iniciar() {
        if (rodando) return;
        rodando = true;
        requestAnimationFrame(quadro);
    }

    // Dois "canhões" de confete, um em cada canto de baixo da tela
    function confete(quantidade = 120) {
        if (MOVIMENTO_REDUZIDO) return;
        const escala = Math.max(0.55, Math.min(1, largura / 1100));
        for (let i = 0; i < quantidade; i++) {
            const daDireita = i % 2 === 1;
            particulas.push({
                tipo: 'confete',
                x: daDireita ? largura + 10 : -10,
                y: altura * aleatorio(0.55, 0.9),
                vx: (daDireita ? -1 : 1) * aleatorio(6, 17) * escala,
                vy: aleatorio(-18, -8),
                gravidade: 0.32,
                atrito: 0.985,
                tam: aleatorio(7, 13),
                giro: aleatorio(0, Math.PI * 2),
                vgiro: aleatorio(-0.25, 0.25),
                cor: CORES[i % CORES.length],
                vida: aleatorio(150, 230),
            });
        }
        iniciar();
    }

    // Explosão radial de faíscas num ponto da tela
    function faiscas(x, y, cores = CORES, quantidade = 26) {
        if (MOVIMENTO_REDUZIDO) return;
        for (let i = 0; i < quantidade; i++) {
            const angulo = (Math.PI * 2 * i) / quantidade + aleatorio(-0.2, 0.2);
            const velocidade = aleatorio(3, 9.5);
            particulas.push({
                tipo: 'faisca',
                x,
                y,
                vx: Math.cos(angulo) * velocidade,
                vy: Math.sin(angulo) * velocidade,
                gravidade: 0.12,
                atrito: 0.93,
                tam: aleatorio(1.8, 3.8),
                giro: 0,
                vgiro: 0,
                cor: cores[i % cores.length],
                vida: aleatorio(30, 58),
            });
        }
        iniciar();
    }

    return { confete, faiscas };
})();

// ---------- Interface ----------

function mostrarMensagem(titulo, sub = '', tipo = '') {
    el.resultadoTitulo.textContent = titulo;
    el.resultadoSub.textContent = sub;
    el.resultado.classList.remove('vitoria', 'derrota', 'empate', 'aguardando');
    if (tipo) el.resultado.classList.add(tipo);
    reiniciarAnimacao(el.resultado, 'animar');
}

// Avisos rápidos no topo da tela
function toast(texto, tipo = '') {
    const aviso = document.createElement('div');
    aviso.className = `toast ${tipo}`.trim();
    aviso.setAttribute('role', 'status');
    aviso.textContent = texto;
    el.toasts.appendChild(aviso);
    while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
    setTimeout(() => {
        aviso.classList.add('saindo');
        aviso.addEventListener('animationend', () => aviso.remove(), { once: true });
        setTimeout(() => aviso.remove(), 600); // garante a remoção mesmo sem animação
    }, 2800);
}

// Troca quem aparece do lado direito (computador ou jogador online)
function definirAdversario({ nome, emoji, online: ehOnline }) {
    adversario = { nome, emoji, online: Boolean(ehOnline) };
    el.rotuloCpu.textContent = nome;
    el.nomeCpu.textContent = `${emoji} ${nome}`;
    document.body.classList.toggle('modo-online', adversario.online);
}

// Selos em cima das mãos (usados no modo online)
function definirSelo(selo, texto, tipo) {
    if (!texto) {
        selo.hidden = true;
        selo.className = 'selo';
        return;
    }
    const mudou = selo.hidden || selo.dataset.tipo !== tipo;
    selo.hidden = false;
    selo.dataset.tipo = tipo;
    selo.className = `selo ${tipo}`;
    selo.textContent = texto;
    if (tipo === 'pensando') {
        const pontos = document.createElement('span');
        pontos.className = 'pontinhos';
        pontos.setAttribute('aria-hidden', 'true');
        pontos.innerHTML = '<i>.</i><i>.</i><i>.</i>';
        selo.appendChild(pontos);
    }
    if (mudou) {
        selo.style.animation = 'none';
        void selo.offsetWidth;
        selo.style.animation = '';
    }
}

function bloquearEscolhas(selecionada = null) {
    el.escolhas.forEach((botao) => {
        botao.setAttribute('aria-disabled', 'true');
        botao.classList.toggle('selecionada', botao.dataset.escolha === selecionada);
    });
}

function liberarEscolhas() {
    el.escolhas.forEach((botao) => {
        botao.removeAttribute('aria-disabled');
        botao.classList.remove('selecionada');
    });
}

function limparLutadores() {
    [el.lutadorJogador, el.lutadorCpu].forEach((l) => l.classList.remove('venceu', 'perdeu', 'empatou'));
}

function renderizarPips() {
    const alvo = MODOS[estado.modo].alvo;
    const lados = [
        [el.pipsJogador, estado.jogador],
        [el.pipsCpu, estado.computador],
    ];
    for (const [caixa, pontos] of lados) {
        caixa.hidden = alvo === 0;
        if (caixa.children.length !== alvo) {
            const pips = Array.from({ length: alvo }, () => {
                const pip = document.createElement('span');
                pip.className = 'pip';
                return pip;
            });
            caixa.replaceChildren(...pips);
        }
        [...caixa.children].forEach((pip, i) => pip.classList.toggle('cheio', i < pontos));
    }
}

function renderizarPlacar() {
    el.pontosJogador.textContent = estado.jogador;
    el.pontosCpu.textContent = estado.computador;
    el.placarJogador.classList.toggle('lider', estado.jogador > estado.computador);
    el.placarCpu.classList.toggle('lider', estado.computador > estado.jogador);
    el.rodadas.textContent = totalRodadas();
    el.empates.textContent = estado.empates;
    renderizarPips();
}

function marcarPonto(pontos, card) {
    reiniciarAnimacao(pontos, 'pop');
    const bolha = document.createElement('span');
    bolha.className = 'mais-um';
    bolha.textContent = '+1';
    bolha.setAttribute('aria-hidden', 'true');
    card.appendChild(bolha);
    bolha.addEventListener('animationend', () => bolha.remove());
}

function renderizarEstatisticas({ novoRecorde = false, animarSequencia = false } = {}) {
    const total = totalRodadas();
    const pct = (n) => (total ? (n / total) * 100 : 0);

    el.sequencia.textContent = estado.sequencia;
    el.recorde.textContent = estado.recorde;
    animarNumero(el.aproveitamento, Math.round(pct(estado.jogador)), '%');

    el.barraV.style.width = `${pct(estado.jogador)}%`;
    el.barraE.style.width = `${pct(estado.empates)}%`;
    el.barraD.style.width = `${pct(estado.computador)}%`;
    el.legV.textContent = estado.jogador;
    el.legE.textContent = estado.empates;
    el.legD.textContent = estado.computador;
    el.barra.setAttribute('aria-label', total
        ? `${estado.jogador} vitórias, ${estado.empates} empates e ${estado.computador} derrotas`
        : 'Nenhuma rodada jogada');

    el.statSequencia.classList.toggle('quente', estado.sequencia >= 3);
    if (animarSequencia) reiniciarAnimacao(el.sequencia, 'pop');
    if (novoRecorde) {
        reiniciarAnimacao(el.statRecorde, 'festa');
        reiniciarAnimacao(el.recorde, 'pop');
    }
}

function adicionarAoHistorico(escolha, cpu, resultado) {
    const rotulos = { vitoria: 'Vitória', derrota: 'Derrota', empate: 'Empate' };
    const rodada = totalRodadas();
    const item = document.createElement('li');
    item.className = `chip ${resultado}`;
    item.title = `Rodada ${rodada}: ${rotulos[resultado]} (você: ${OPCOES[escolha].nome}, ${adversario.nome}: ${OPCOES[cpu].nome})`;
    // só emojis fixos entram no HTML; o nome do adversário (que pode vir da rede) vai como texto
    item.innerHTML = `
        <span class="chip-n">#${rodada}</span>
        <span aria-hidden="true">${OPCOES[escolha].emoji}<small>×</small>${OPCOES[cpu].emoji}</span>
        <span class="sr-only"></span>`;
    item.querySelector('.sr-only').textContent = item.title;
    el.historico.prepend(item);
    while (el.historico.children.length > MAX_HISTORICO) el.historico.lastElementChild.remove();
    el.historicoVazio.hidden = true;
}

function anunciar(escolha, cpu, resultado, novoRecorde) {
    const j = OPCOES[escolha];
    const c = OPCOES[cpu];
    let titulo;
    let sub;
    if (resultado === 'vitoria') {
        titulo = 'Você venceu! 🎉';
        sub = `${j.nome} ${j.verbo} ${c.nome.toLowerCase()}`;
    } else if (resultado === 'derrota') {
        titulo = adversario.online ? `${adversario.nome} venceu! 😤` : 'O computador venceu! 🤖';
        sub = `${c.nome} ${c.verbo} ${j.nome.toLowerCase()}`;
    } else {
        titulo = 'Empate! 🤝';
        sub = `Os dois escolheram ${j.nome.toLowerCase()}`;
    }
    if (estado.sequencia >= 2) sub += ` · 🔥 ${estado.sequencia} seguidas`;
    if (novoRecorde && estado.sequencia >= 2) sub += ' · 🏅 novo recorde!';
    mostrarMensagem(titulo, sub, resultado);
}

// ---------- Rodada ----------

function prepararArena() {
    el.arena.classList.add('jogando');
    limparLutadores();
    el.maoJogador.textContent = OPCOES.pedra.emoji;
    el.maoCpu.textContent = OPCOES.pedra.emoji;
    [el.wrapJogador, el.wrapCpu].forEach((wrap) => {
        wrap.classList.remove('ocioso', 'revelar');
        if (!MOVIMENTO_REDUZIDO) reiniciarAnimacao(wrap, 'chacoalhar');
    });
}

function revelar(escolha, cpu, resultado) {
    const classes = {
        vitoria: ['venceu', 'perdeu'],
        derrota: ['perdeu', 'venceu'],
        empate: ['empatou', 'empatou'],
    }[resultado];
    el.lutadorJogador.classList.add(classes[0]);
    el.lutadorCpu.classList.add(classes[1]);

    el.maoJogador.textContent = OPCOES[escolha].emoji;
    el.maoCpu.textContent = OPCOES[cpu].emoji;
    [el.wrapJogador, el.wrapCpu].forEach((wrap) => {
        wrap.classList.remove('chacoalhar');
        reiniciarAnimacao(wrap, 'revelar');
    });
    [el.palcoJogador, el.palcoCpu].forEach((palco) => reiniciarAnimacao(palco, 'impacto'));

    el.contagem.textContent = '💥';
    reiniciarAnimacao(el.contagem, 'batida');
    const meio = centro(el.versus);
    fx.faiscas(meio.x, meio.y, ['#ffffff', '#22d3ee', '#f472b6', '#facc15'], 22);
    som.impacto();
}

function registrar(resultado) {
    let novoRecorde = false;
    if (resultado === 'vitoria') {
        estado.jogador += 1;
        estado.sequencia += 1;
        if (estado.sequencia > estado.recorde) {
            estado.recorde = estado.sequencia;
            armazenamento.gravar(CHAVE_RECORDE, estado.recorde);
            novoRecorde = true;
        }
    } else if (resultado === 'derrota') {
        estado.computador += 1;
        estado.sequencia = 0;
    } else {
        estado.empates += 1;
        estado.sequencia = 0;
    }
    return novoRecorde;
}

function efeitos(resultado) {
    el.flash.className = 'flash';
    reiniciarAnimacao(el.flash, resultado);

    if (resultado === 'vitoria') {
        som.vitoria();
        const c = centro(el.palcoJogador);
        fx.faiscas(c.x, c.y, ['#4ade80', '#22d3ee', '#facc15', '#ffffff'], 40);
        fx.confete(estado.sequencia >= 3 ? 110 : 50);
        marcarPonto(el.pontosJogador, el.placarJogador);
    } else if (resultado === 'derrota') {
        som.derrota();
        const c = centro(el.palcoCpu);
        fx.faiscas(c.x, c.y, ['#f472b6', '#f87171', '#ffffff'], 32);
        if (!MOVIMENTO_REDUZIDO) reiniciarAnimacao(el.app, 'tremer');
        marcarPonto(el.pontosCpu, el.placarCpu);
    } else {
        som.empate();
        reiniciarAnimacao(el.empates, 'pop');
    }
}

function vencedorDaPartida() {
    const alvo = MODOS[estado.modo].alvo;
    if (!alvo) return null;
    if (estado.jogador >= alvo) return 'jogador';
    if (estado.computador >= alvo) return 'computador';
    return null;
}

// Anima uma rodada completa (Jo… Ken… Pô!, revelação, placar e efeitos).
// Quem chama já deve ter marcado estado.ocupado e bloqueado as escolhas.
async function disputarRodada(minha, dele) {
    prepararArena();
    mostrarMensagem('Valendo!', `Você escolheu ${OPCOES[minha].nome.toLowerCase()}…`, 'aguardando');

    // Jo… Ken… Pô!
    for (let i = 0; i < PALAVRAS.length; i++) {
        el.contagem.textContent = PALAVRAS[i];
        reiniciarAnimacao(el.contagem, 'batida');
        som.batida(i);
        await esperar(BATIDA);
    }

    const resultado = decidir(minha, dele);
    revelar(minha, dele, resultado);
    const novoRecorde = registrar(resultado);
    renderizarPlacar();
    renderizarEstatisticas({ novoRecorde, animarSequencia: resultado === 'vitoria' });
    adicionarAoHistorico(minha, dele, resultado);
    anunciar(minha, dele, resultado, novoRecorde);
    efeitos(resultado);

    await esperar(MOVIMENTO_REDUZIDO ? 150 : 400);
    el.arena.classList.remove('jogando');
    return vencedorDaPartida();
}

// Depois da animação: abre o fim de partida ou libera a próxima rodada
async function finalizarRodada(vencedor) {
    if (vencedor) {
        estado.encerrada = true;
        await esperar(MOVIMENTO_REDUZIDO ? 300 : 900);
        estado.ocupado = false;
        abrirModal(vencedor);
    } else {
        estado.ocupado = false;
        liberarEscolhas();
        setTimeout(() => {
            if (!estado.ocupado && el.contagem.textContent === '💥') {
                el.contagem.textContent = 'VS';
                reiniciarAnimacao(el.contagem, 'batida');
            }
        }, 700);
    }
    if (typeof online !== 'undefined') online.depoisDaRodada();
}

// Rodada contra o computador
async function jogar(escolha) {
    if (estado.ocupado || estado.encerrada || !OPCOES[escolha]) return;
    estado.ocupado = true;
    bloquearEscolhas(escolha);
    const vencedor = await disputarRodada(escolha, sortear());
    await finalizarRodada(vencedor);
}

// ---------- Partida, modos e modal ----------

function reiniciarPartida(titulo, sub) {
    Object.assign(estado, { jogador: 0, computador: 0, empates: 0, sequencia: 0, encerrada: false });

    limparLutadores();
    el.arena.classList.remove('jogando');
    el.maoJogador.textContent = OPCOES.pedra.emoji;
    el.maoCpu.textContent = OPCOES.pedra.emoji;
    [el.wrapJogador, el.wrapCpu].forEach((wrap) => {
        wrap.classList.remove('chacoalhar', 'revelar');
        reiniciarAnimacao(wrap, 'ocioso');
    });
    el.contagem.textContent = 'VS';
    reiniciarAnimacao(el.contagem, 'batida');

    el.historico.replaceChildren();
    el.historicoVazio.hidden = false;

    renderizarPlacar();
    renderizarEstatisticas();
    liberarEscolhas();
    mostrarMensagem(titulo, sub);
}

function reiniciar() {
    if (estado.ocupado || !el.modal.hidden) return;
    if (modoOnline()) {
        online.reiniciar();
        return;
    }
    reiniciarAnimacao(el.btnReiniciar, 'girando');
    som.clique();
    reiniciarPartida('Placar zerado!', 'Bora de novo? Escolha sua jogada 💪');
}

// Só a parte visual e o estado do seletor de modo (sem zerar nada)
function aplicarModo(modo) {
    estado.modo = modo;
    el.modos.forEach((botao, i) => {
        const ativo = botao.dataset.modo === modo;
        botao.classList.toggle('ativo', ativo);
        botao.setAttribute('aria-pressed', String(ativo));
        if (ativo) el.modosBox.style.setProperty('--idx', i);
    });
    renderizarPips();
}

function mudarModo(modo) {
    if (estado.ocupado || !MODOS[modo] || modo === estado.modo || !el.modal.hidden) return;
    if (modoOnline()) {
        online.mudarModo(modo);
        return;
    }
    aplicarModo(modo);
    som.clique();
    reiniciarPartida(MODOS[modo].titulo, MODOS[modo].texto);
}

let timerModal = null;

function abrirModal(vencedor) {
    const venceu = vencedor === 'jogador';
    const contraAmigo = adversario.online;
    el.modalIcone.textContent = venceu ? '🏆' : contraAmigo ? '😵' : '🤖';
    if (venceu) el.modalTitulo.textContent = 'Você venceu a partida!';
    else el.modalTitulo.textContent = contraAmigo ? `${adversario.nome} venceu a partida!` : 'O computador levou essa!';
    el.modalPlacar.innerHTML = `<span class="mj">${estado.jogador}</span> × <span class="mc">${estado.computador}</span>`;
    el.modalTexto.textContent = venceu
        ? 'Mandou muito bem! Que tal mais uma?'
        : 'Não foi dessa vez… bora pra revanche?';
    if (contraAmigo) el.btnNovamente.textContent = 'Pedir revanche';
    else el.btnNovamente.textContent = venceu ? 'Jogar de novo' : 'Quero revanche';
    el.btnNovamente.disabled = false;
    el.btnSairPartida.hidden = !contraAmigo;
    el.modalRevanche.textContent = '';
    el.modal.classList.toggle('derrota', !venceu);

    clearTimeout(timerModal);
    el.app.inert = true;
    el.modal.hidden = false;
    void el.modal.offsetWidth;
    el.modal.classList.add('aberto');
    // quem está escrevendo no chat continua lá (senão o próximo Espaço/Enter pediria revanche)
    const painelChat = document.getElementById('chat');
    const escrevendoNoChat = painelChat && !painelChat.hidden && painelChat.contains(document.activeElement);
    if (!escrevendoNoChat) el.btnNovamente.focus();

    if (venceu) {
        som.fanfarra();
        fx.confete(160);
        setTimeout(() => fx.confete(120), 450);
    } else {
        som.lamento();
    }
}

// Fecha o fim de partida sem mexer no placar
function esconderModal() {
    if (el.modal.hidden) return;
    el.modal.classList.remove('aberto');
    el.app.inert = false;
    clearTimeout(timerModal);
    timerModal = setTimeout(() => {
        el.modal.hidden = true;
    }, 300);
}

// Contra o computador: fechar o fim de partida já começa outra
function fecharModal() {
    if (el.modal.hidden || !el.modal.classList.contains('aberto') || adversario.online) return;
    esconderModal();
    som.clique();
    reiniciarPartida('Nova partida!', MODOS[estado.modo].texto);
}

function alternarSom() {
    estado.som = !estado.som;
    armazenamento.gravar(CHAVE_SOM, estado.som);
    atualizarBotaoSom();
    if (estado.som) {
        som.clique();
        reiniciarAnimacao(el.btnSom, 'tocar');
    }
}

function atualizarBotaoSom() {
    el.btnSom.setAttribute('aria-pressed', String(estado.som));
    el.btnSom.title = estado.som ? 'Desligar som (M)' : 'Ligar som (M)';
}

// ---------- Efeitos das cartas (inclinação 3D e ondinha) ----------

function inclinar(botao, evento) {
    const r = botao.getBoundingClientRect();
    const px = (evento.clientX - r.left) / r.width;
    const py = (evento.clientY - r.top) / r.height;
    botao.style.setProperty('--mx', `${px * 100}%`);
    botao.style.setProperty('--my', `${py * 100}%`);
    if (botao.getAttribute('aria-disabled') === 'true') return;
    botao.style.setProperty('--rx', `${(0.5 - py) * 16}deg`);
    botao.style.setProperty('--ry', `${(px - 0.5) * 16}deg`);
}

function endireitar(botao) {
    botao.style.removeProperty('--rx');
    botao.style.removeProperty('--ry');
}

function criarOndinha(botao, evento) {
    const r = botao.getBoundingClientRect();
    const tamanho = Math.max(r.width, r.height) * 2.2;
    // clique pelo teclado não tem posição: a ondinha sai do centro
    const doMouse = evento && evento.detail > 0;
    const x = doMouse ? evento.clientX - r.left : r.width / 2;
    const y = doMouse ? evento.clientY - r.top : r.height / 2;
    const onda = document.createElement('span');
    onda.className = 'ondinha';
    onda.style.cssText = `width:${tamanho}px;height:${tamanho}px;left:${x - tamanho / 2}px;top:${y - tamanho / 2}px`;
    botao.appendChild(onda);
    onda.addEventListener('animationend', () => onda.remove());
}

function escolher(botao, evento) {
    const bloqueado = estado.ocupado || estado.encerrada || (modoOnline() && !online.podeJogar());
    if (bloqueado) {
        if (!botao.classList.contains('selecionada')) reiniciarAnimacao(botao, 'negada');
        if (modoOnline()) online.explicarBloqueio();
        return;
    }
    criarOndinha(botao, evento);
    if (modoOnline()) online.jogar(botao.dataset.escolha);
    else jogar(botao.dataset.escolha);
}

// ---------- Fundo com mãozinhas flutuando ----------

function criarFundo() {
    const caixa = $('#maos-flutuantes');
    if (!caixa || MOVIMENTO_REDUZIDO) return;
    const emojis = Object.values(OPCOES).map((o) => o.emoji);
    const quantidade = window.innerWidth < 600 ? 8 : 14;
    for (let i = 0; i < quantidade; i++) {
        const mao = document.createElement('span');
        const duracao = aleatorio(22, 44);
        mao.textContent = emojis[i % emojis.length];
        mao.style.setProperty('--x', `${aleatorio(0, 96)}%`);
        mao.style.setProperty('--t', `${aleatorio(1.4, 4)}rem`);
        mao.style.setProperty('--o', aleatorio(0.05, 0.14).toFixed(2));
        mao.style.setProperty('--dur', `${duracao}s`);
        mao.style.setProperty('--atraso', `${-aleatorio(0, duracao)}s`);
        mao.style.setProperty('--giro', `${(Math.random() < 0.5 ? -1 : 1) * aleatorio(180, 540)}deg`);
        caixa.appendChild(mao);
    }
}

// ---------- Eventos ----------

function ligarEventos() {
    el.escolhas.forEach((botao) => {
        botao.addEventListener('click', (e) => escolher(botao, e));
        botao.addEventListener('pointerenter', (e) => {
            if (e.pointerType === 'mouse' && botao.getAttribute('aria-disabled') !== 'true') som.passar();
        });
        botao.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'mouse') inclinar(botao, e);
        });
        botao.addEventListener('pointerleave', () => endireitar(botao));
        botao.addEventListener('animationend', (e) => {
            if (e.animationName === 'negar') botao.classList.remove('negada');
        });
    });

    el.modos.forEach((botao) => botao.addEventListener('click', () => mudarModo(botao.dataset.modo)));
    el.btnSom.addEventListener('click', alternarSom);
    el.btnReiniciar.addEventListener('click', reiniciar);
    el.btnNovamente.addEventListener('click', () => {
        if (adversario.online) online.pedirRevanche();
        else fecharModal();
    });
    el.btnSairPartida.addEventListener('click', () => online.sair());
    el.modal.addEventListener('click', (e) => {
        if (e.target === el.modal) fecharModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;

        // janelas abertas vêm primeiro: o Esc fecha mesmo com o cursor num campo de texto
        if (!el.modal.hidden) {
            if (e.key === 'Escape') fecharModal();
            return;
        }
        if (typeof online !== 'undefined' && online.painelAberto()) {
            if (e.key === 'Escape') online.fecharPainel();
            return;
        }
        if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) return;

        const escolha = TECLAS[e.key];
        if (escolha) {
            const botao = el.escolhas.find((b) => b.dataset.escolha === escolha);
            botao.classList.add('apertada');
            setTimeout(() => botao.classList.remove('apertada'), 160);
            escolher(botao, null);
            return;
        }

        const tecla = e.key.toLowerCase();
        if (tecla === 'r') reiniciar();
        else if (tecla === 'm') alternarSom();
    });
}

// ---------- Início ----------

function iniciar() {
    document.documentElement.style.setProperty('--batida', `${BATIDA}ms`);
    if (window.matchMedia('(hover: none)').matches) {
        el.resultadoSub.textContent = 'Toque em uma opção para jogar';
    }
    criarFundo();
    atualizarBotaoSom();
    renderizarPlacar();
    renderizarEstatisticas();
    ligarEventos();
    if (typeof chat !== 'undefined') chat.iniciar();
    if (typeof online !== 'undefined') online.iniciar();
}

// Espera o online.js (carregado logo depois deste arquivo) antes de iniciar
document.addEventListener('DOMContentLoaded', iniciar);
