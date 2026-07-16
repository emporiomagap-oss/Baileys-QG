const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { URL } = require('url'); // 🛠️ ADICIONADO: Necessário para limpar a URL de forma segura
const app = express();

app.use(express.json());

// Variáveis de ambiente configuradas no Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID; // ID do grupo (ex: 120363xxxxxxxxx@g.us)
const MERCADO_LIVRE_AFF_ID = process.env.MERCADO_LIVRE_AFF_ID; // 🛠️ ALTERADO: Agora usa seu ID do Mercado Livre

let sock; // Variável global para armazenar a conexão do WhatsApp
let qrCodeAtual = null; // 🔍 Guarda o último QR Code gerado para exibir na web

// Função para iniciar e manter a conexão do WhatsApp
async function conectarAoWhatsApp() {
    // Salva a sessão na pasta 'auth_info' para não perder a conexão ao reiniciar rápido
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // Busca de forma dinâmica a versão mais recente do WhatsApp Web aceita pelo servidor
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando a versão do WhatsApp Web: ${version.join('.')}, última versão disponível: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // Vamos nós mesmos tratar e printar o QR no log de forma limpa
        browser: ['Ubuntu', 'Chrome', '20.0.04'] // Identificação essencial para evitar o erro 405
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("==================================================");
            console.log(" ESCANEIE O QR CODE NA PÁGINA DA WEB DO SEU BOT!  ");
            console.log("==================================================");
            qrCodeAtual = qr; // Salva o QR Code na variável
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const deveriaReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada devido a:', lastDisconnect?.error, '. Reconectando:', deveriaReconectar);
            if (deveriaReconectar) {
                // Pequeno atraso para evitar spam de reconexão rápida em caso de erro continuado
                setTimeout(() => conectarAoWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 WHATSAPP CONECTADO COM SUCESSO!');
            qrCodeAtual = null; // Limpa o QR Code gerado já que está conectado
        }
    });
}

// Inicializa o WhatsApp
conectarAoWhatsApp();

// Função para extrair a URL da mensagem
function extrairLink(texto) {
    const urls = texto.match(/(https?:\/\/[^\s]+)/g);
    return urls ? urls[0] : null;
}

// 🛠️ ALTERADO: Função de desembrulhar agora possui plano B (GET) para links "meli.la"
async function desembrulharLink(urlCurta) {
    try {
        // Tenta primeiro com o método HEAD por ser mais rápido
        const resposta = await axios.head(urlCurta, { maxRedirects: 5, timeout: 10000 });
        return resposta.request.res.responseUrl || urlCurta;
    } catch (e) {
        try {
            // Se falhar (comum no meli.la), tenta um GET tradicional para abrir o link
            const respostaGet = await axios.get(urlCurta, { maxRedirects: 5, timeout: 10000 });
            return respostaGet.request.res.responseUrl || urlCurta;
        } catch (erroGet) {
            console.log(`Erro ao desembrulhar link ${urlCurta}:`, erroGet.message);
            return urlCurta;
        }
    }
}

// 🛠️ ADICIONADO: Função para limpar rastreamentos antigos da URL do Mercado Livre
function limparUrlML(urlOriginal) {
    try {
        const urlObj = new URL(urlOriginal);
        // Retorna apenas protocolo, host e o caminho (path), removendo UTMs e IDs de outros afiliados
        return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (e) {
        return urlOriginal;
    }
}

// Endpoint do Webhook do Telegram
app.post('/telegram-webhook', async (req, res) => {
    const dados = req.body;
    const mensagemObjeto = dados.channel_post || dados.message;

    if (!mensagemObjeto) {
        return res.status(200).json({ status: 'ignorado' });
    }

    const texto = mensagemObjeto.text || "";

    // 🛠️ ALTERADO: Filtro agora monitora links do Mercado Livre, incluindo o meli.la
    if (texto.includes("mercadolivre.com") || texto.includes("mlb.io") || texto.includes("mercadolivre.com.br") || texto.includes("meli.la")) {
        const linkCurto = extrairLink(texto);
        if (linkCurto) {
            console.log(`Link encontrado: ${linkCurto}. Processando...`);
            
            const linkReal = await desembrulharLink(linkCurto);
            const linkLimpo = limparUrlML(linkReal); // 🛠️ ADICIONADO: Limpa a URL antes de gerar seu link de afiliado
            const linkCodificado = encodeURIComponent(linkLimpo);
            
            // 🛠️ ALTERADO: Formato de redirecionamento oficial do Mercado Livre
            const linkAfiliado = `https://www.mercadolivre.com.br/social/afiliados/c/share?s=${linkCodificado}&custom_id=${MERCADO_LIVRE_AFF_ID}`;

            // 🛠️ ALTERADO: Copy adaptada para o Mercado Livre (com emoji de caixa 📦)
            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `📦 Oferta imperdível no Mercado Livre! Aproveite o frete rápido clicando abaixo:\n\n` +
                `👉 ${linkAfiliado}\n\n` +
                `⚠️ *Atenção:* Estoques promocionais do Mercado Livre costumam acabar em minutos!`;

            if (sock && sock.user) {
                try {
                    // Envia diretamente pelo robô, sem Z-API!
                    await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagemFinal });
                    console.log("Mensagem enviada com sucesso para o WhatsApp!");
                } catch (erroEnvio) {
                    console.log("Erro ao enviar mensagem pelo Baileys:", erroEnvio);
                }
            } else {
                console.log("Erro: O bot do WhatsApp não está conectado no momento.");
            }
        }
    }

    return res.status(200).json({ status: 'sucesso' });
});

// Rota de teste, ping e exibição visual do QR Code
app.get('/', (req, res) => {
    if (sock && sock.user) {
        res.send("<h1>🎉 Bot Baileys QG das Ofertas está ativo e conectado!</h1>");
    } else if (qrCodeAtual) {
        // Gera uma página simples com o QR Code para ser escaneado facilmente
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
                <h2>Escaneie o QR Code abaixo com seu WhatsApp:</h2>
                <div id="qrcode" style="border: 10px solid white; padding: 10px; background: white;"></div>
                <p style="margin-top: 20px; color: #555;">Atualize a página se o código expirar.</p>
                
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <script>
                    new QRCode(document.getElementById("qrcode"), "${qrCodeAtual}");
                </script>
            </div>
        `);
    } else {
        res.send("<h1>Carregando o bot... Por favor, aguarde e atualize a página em instantes.</h1>");
    }
});

const porta = process.env.PORT || 3000;
app.listen(porta, () => {
    console.log(`Servidor rodando na porta ${porta}`);
});
