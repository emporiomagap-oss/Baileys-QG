const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const app = express();

app.use(express.json());

// Variáveis de ambiente configuradas no Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID; // ID do grupo (ex: 120363xxxxxxxxx@g.us)
const SHOPEE_SUB_ID = process.env.SHOPEE_SUB_ID; // ID de afiliada Shopee

let sock; // Variável global para armazenar a conexão do WhatsApp

// Função para iniciar e manter a conexão do WhatsApp
async function conectarAoWhatsApp() {
    // Salva a sessão na pasta 'auth_info' para não perder a conexão ao reiniciar rápido
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // Vamos nós mesmos tratar e printar o QR no log de forma limpa
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("==================================================");
            console.log(" ESCANEIE O QR CODE ABAIXO COM O SEU WHATSAPP: ");
            console.log("==================================================");
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const deveriaReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada devido a:', lastDisconnect?.error, '. Reconectando:', deveriaReconectar);
            if (deveriaReconectar) {
                conectarAoWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('🎉 WHATSAPP CONECTADO COM SUCESSO!');
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

// Função para descobrir a URL real por trás do link curto
async function desembrulharLink(urlCurta) {
    try {
        const resposta = await axios.head(urlCurta, { maxRedirects: 5, timeout: 10000 });
        return resposta.request.res.responseUrl || urlCurta;
    } catch (e) {
        console.log(`Erro ao desembrulhar link ${urlCurta}:`, e.message);
        return urlCurta;
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

    // Filtro: monitora apenas links da Shopee
    if (texto.includes("shope.ee") || texto.includes("shopee.com.br")) {
        const linkCurto = extrairLink(texto);
        if (linkCurto) {
            console.log(`Link encontrado: ${linkCurto}. Processando...`);
            
            const linkReal = await desembrulharLink(linkCurto);
            const linkCodificado = encodeURIComponent(linkReal);
            const linkAfiliado = `https://shopee.com.br/universal-link/${linkCodificado}?utm_campaign=-&utm_content=${SHOPEE_SUB_ID}`;

            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `🛍️ Encontramos um super desconto! Garanta o seu clicando no link abaixo:\n\n` +
                `👉 ${linkAfiliado}\n\n` +
                `⚠️ *Atenção:* Os estoques promocionais costumam esgotar rápido!`;

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

// Rota de teste e ping para manter o bot acordado
app.get('/', (req, res) => {
    res.send("Bot Baileys QG das Ofertas está ativo!");
});

const porta = process.env.PORT || 3000;
app.listen(porta, () => {
    console.log(`Servidor rodando na porta ${porta}`);
});
