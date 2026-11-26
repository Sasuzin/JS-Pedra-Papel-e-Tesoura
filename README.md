<div align="center">

# ✊ ✋ ✌️ JoKenPô

### Pedra, papel e tesoura com visual neon, muita animação e partidas online contra um amigo

[![Jogar agora](https://img.shields.io/badge/%E2%96%B6%20Jogar%20agora-22d3ee?style=for-the-badge)](https://sasuzin.github.io/JS-Pedra-Papel-e-Tesoura/)
[![Modo online](https://img.shields.io/badge/%F0%9F%8C%90%20Desafiar%20um%20amigo-4ade80?style=for-the-badge)](https://sasuzin.github.io/JS-Pedra-Papel-e-Tesoura/)

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=flat-square&logo=webrtc&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?style=flat-square&logo=githubpages&logoColor=white)
![Sem build](https://img.shields.io/badge/build-nenhum-a78bfa?style=flat-square)

<br>

<img src="docs/screenshots/jogo.jpg" alt="Tela do JoKenPô com placar, a arena com as duas mãos, o resultado da rodada, confetes e as estatísticas" width="820">

</div>

---

## ✨ Destaques

| | |
|---|---|
| 🎬 **Jo… Ken… Pô!** | As mãos sobem e descem no ritmo da contagem e se revelam com onda de choque e faíscas |
| 🌐 **Online com um amigo** | Crie uma sala, mande o link e joguem um contra o outro em tempo real |
| 🏆 **Melhor de 3 e de 5** | Bolinhas de progresso, coroa para quem lidera e tela de fim de partida com revanche |
| 🎉 **Efeitos** | Confete na vitória, tela tremendo na derrota, clarões coloridos e sons gerados na hora |
| 📊 **Estatísticas** | Sequência de vitórias, recorde salvo no navegador, % de vitórias e histórico das rodadas |
| 📱 **Responsivo** | Funciona no computador e no celular, com atalhos de teclado e suporte a leitores de tela |

## 🌐 Jogando online

1. Abra o jogo e clique em **Online**, no canto superior direito.
2. Digite seu nome e clique em **Criar sala**. Aparece um código de 5 letras e um link.
3. Mande o link para um amigo (ou passe o código). Ele abre, digita o nome e clica em **Entrar**.
4. Pronto! Cada um escolhe sua jogada e as mãos se revelam ao mesmo tempo. Ainda dá para mandar reações 👏 😂 😱 🔥 😎

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/sala.jpg" alt="Sala criada, com o código de 5 letras e o link para compartilhar" width="400"><br><sub><b>Sala criada:</b> é só mandar o link</sub></td>
    <td align="center"><img src="docs/screenshots/online.jpg" alt="Partida online entre Ana e Beto, com placar, resultado e uma reação na tela" width="400"><br><sub><b>Partida valendo</b> contra um amigo</sub></td>
  </tr>
</table>

> [!NOTE]
> 🔒 **Sem trapaça:** sua jogada sai do navegador *lacrada* (um hash SHA-256 com um segredo aleatório). O adversário só descobre o que você escolheu depois que os dois já jogaram, e o jogo confere se a jogada revelada bate com o lacre.

<details>
<summary><b>⚙️ Como o modo online funciona por dentro</b></summary>
<br>

- Os dois navegadores conversam **direto entre si** por **WebRTC**, usando a biblioteca [PeerJS](https://peerjs.com/).
- O servidor público do PeerJS só faz a apresentação inicial entre os jogadores. Por isso o jogo não precisa de backend e roda 100% no **GitHub Pages**.
- Quem cria a sala comanda o modo de jogo e o placar; o convidado acompanha.
- Se alguém fecha a aba ou a conexão cai, o outro é avisado na hora. Quem criou a sala continua esperando um novo adversário.
- Em redes muito restritas (algumas redes de empresa ou de faculdade), a conexão direta pode ser bloqueada.

</details>

## 🎮 Regras e controles

| Jogada | Vence | Por quê |
|:---:|:---:|---|
| ✊ Pedra | ✌️ Tesoura | a pedra amassa a tesoura |
| ✋ Papel | ✊ Pedra | o papel embrulha a pedra |
| ✌️ Tesoura | ✋ Papel | a tesoura corta o papel |

| Tecla | Ação |
|:---:|---|
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Jogar pedra, papel ou tesoura |
| <kbd>R</kbd> | Zerar o placar |
| <kbd>M</kbd> | Ligar ou desligar o som |
| <kbd>Esc</kbd> | Fechar janelas |

## 📱 No celular

<div align="center">
<img src="docs/screenshots/celular.jpg" alt="JoKenPô na tela de um celular" width="300">
</div>

## 🛠️ Tecnologias

- **HTML5, CSS3 e JavaScript puro**: sem framework e sem etapa de build
- **CSS moderno**: animações com `@keyframes`, efeito de vidro com `backdrop-filter`, `color-mix()`, Grid e Flexbox
- **Canvas 2D**: confetes e faíscas
- **Web Audio API**: todos os sons são sintetizados na hora, sem nenhum arquivo de áudio
- **WebRTC + PeerJS**: modo online sem servidor próprio
- **Web Crypto (SHA-256)**: o lacre das jogadas online
- **localStorage**: recorde, nome e preferência de som

## 🚀 Rodando no seu computador

```bash
git clone https://github.com/Sasuzin/JS-Pedra-Papel-e-Tesoura.git
cd JS-Pedra-Papel-e-Tesoura
python -m http.server 8000
```

Depois abra <http://localhost:8000>. Para jogar só contra o computador, também dá para abrir o `index.html` direto no navegador.

## 📁 Estrutura

```text
📦 JS-Pedra-Papel-e-Tesoura
 ┣ 📜 index.html   → estrutura da página
 ┣ 🎨 index.css    → visual, animações e responsividade
 ┣ 🎮 jokenpo.js   → regras, animações, placar, sons e efeitos
 ┣ 🌐 online.js    → salas online (PeerJS + lacre das jogadas)
 ┗ 🖼️ docs/        → imagens deste README
```

## 📜 Sobre o projeto

Começou como trabalho do segundo semestre de TSI e depois ganhou um visual novo, animações e o modo online.

---

<div align="center">

Desenvolvido por **Luís Galvão**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Lu%C3%ADs%20Galv%C3%A3o-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/luis-galv%C3%A3o/)
[![GitHub](https://img.shields.io/badge/GitHub-Sasuzin-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Sasuzin)

⭐ Curtiu? Deixa uma estrela no repositório!

</div>
