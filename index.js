const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { URL } = require('url'); 
const app = express();

app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID; 
const MERCADO_LIVRE_AFF_ID = process.env.MERCADO_LIVRE_AFF_ID; 

let sock; 
let qrCodeAtual = null; 

async function conectarAoWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeAtual = qr;
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const deveriaReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveriaReconectar) {
                setTimeout(() => conectarAoWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 WHATSAPP CONECTADO COM SUCESSO!');
            qrCodeAtual = null;
        }
    });
}

conectarAoWhatsApp();

function extrairLink(texto) {
    const urls = texto.match(/(https?:\/\/[^\s]+)/g);
    return urls ? urls[0] : null;
}

// Função para garantir que o link meli.la tenha o seu rastreio de afiliado embutido corretamente
function adicionarAfiliadoMeliLa(urlOriginal, affId) {
    try {
        const urlObj = new URL(urlOriginal);
        // Adiciona o custom_id do afiliado para garantir a sua comissão sem esticar o link visualmente
        urlObj.searchParams.set('custom_id', affId);
        return urlObj.toString();
    } catch (e) {
        return urlOriginal;
    }
}

app.post('/telegram-webhook', async (req, res) => {
    const dados = req.body;
    const mensagemObjeto = dados.channel_post || dados.message;

    if (!mensagemObjeto) {
        return res.status(200).json({ status: 'ignorado' });
    }

    const texto = mensagemObjeto.text || "";

    if (texto.includes("mercadolivre.com") || texto.includes("mlb.io") || texto.includes("mercadolivre.com.br") || texto.includes("meli.la")) {
        const linkCurto = extrairLink(texto);
        if (linkCurto) {
            console.log(`Link encontrado: ${linkCurto}. Processando...`);
            
            // Adiciona o ID de afiliado de forma limpa na URL curta
            const linkFinalAfiliado = adicionarAfiliadoMeliLa(linkCurto, MERCADO_LIVRE_AFF_ID);

            // Mensagem estruturada exatamente como o modelo da foto que você deseja
            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `🛍️ *Oferta imperdível no Mercado Livre!*\n\n` +
                `👉 ${linkFinalAfiliado}\n\n` +
                `⚠️ *Atenção:* Estoques promocionais do Mercado Livre costumam acabar em minutos!`;

            if (sock && sock.user) {
                try {
                    // Enviamos apenas como texto. Como o link é "meli.la", o WhatsApp vai gerar o card rico sozinho!
                    await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagemFinal });
                    console.log("Mensagem com link meli.la enviada com sucesso!");
                } catch (erroEnvio) {
                    console.log("Erro ao enviar mensagem pelo Baileys:", erroEnvio);
                }
            }
        }
    }

    return res.status(200).json({ status: 'sucesso' });
});

app.get('/', (req, res) => {
    if (sock && sock.user) {
        res.send("<h1>🎉 Bot Baileys QG das Ofertas está ativo e conectado!</h1>");
    } else if (qrCodeAtual) {
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
                <h2>Escaneie o QR Code abaixo com seu WhatsApp:</h2>
                <div id="qrcode" style="border: 10px solid white; padding: 10px; background: white;"></div>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <script>
                    new QRCode(document.getElementById("qrcode"), "${qrCodeAtual}");
                </script>
            </div>
        `);
    } else {
        res.send("<h1>Carregando o bot... Aguarde um instante.</h1>");
    }
});

const porta = process.env.PORT || 3000;
app.listen(porta, () => {
    console.log(`Servidor rodando na porta ${porta}`);
});
