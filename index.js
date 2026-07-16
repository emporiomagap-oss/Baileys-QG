const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { URL } = require('url'); 
const { getLinkPreview } = require('link-preview-js'); 
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

async function desembrulharLink(urlCurta) {
    try {
        const resposta = await axios.head(urlCurta, { maxRedirects: 5, timeout: 10000 });
        return resposta.request.res.responseUrl || urlCurta;
    } catch (e) {
        try {
            const respostaGet = await axios.get(urlCurta, { maxRedirects: 5, timeout: 10000 });
            return respostaGet.request.res.responseUrl || urlCurta;
        } catch (erroGet) {
            return urlCurta;
        }
    }
}

function limparUrlML(urlOriginal) {
    try {
        const urlObj = new URL(urlOriginal);
        return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
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
            
            const linkReal = await desembrulharLink(linkCurto);
            const linkLimpo = limparUrlML(linkReal);
            const linkCodificado = encodeURIComponent(linkLimpo);
            
            const linkAfiliado = `https://www.mercadolivre.com.br/social/afiliados/c/share?s=${linkCodificado}&custom_id=${MERCADO_LIVRE_AFF_ID}`;

            let imagemProduto = null;
            let tituloProduto = "Oferta imperdível no Mercado Livre!";
            
            try {
                const preview = await getLinkPreview(linkLimpo, {
                    headers: {
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                    timeout: 5000
                });
                
                if (preview && preview.images && preview.images.length > 0) {
                    imagemProduto = preview.images[0];
                }
                if (preview && preview.title) {
                    tituloProduto = preview.title.replace(" | Mercado Livre", "").trim();
                }
            } catch (erroPreview) {
                console.log("Erro ao buscar dados do produto:", erroPreview.message);
            }

            // Mensagem formatada perfeitamente como legenda da foto
            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `🛍️ *${tituloProduto}*\n\n` +
                `👉 ${linkAfiliado}\n\n` +
                `⚠️ *Atenção:* Estoques promocionais do Mercado Livre costumam acabar em minutos!`;

            if (sock && sock.user) {
                try {
                    if (imagemProduto) {
                        // Envia a imagem grande do produto com a legenda embaixo
                        await sock.sendMessage(WHATSAPP_GROUP_ID, { 
                            image: { url: imagemProduto }, 
                            caption: mensagemFinal 
                        });
                        console.log("Mensagem com imagem enviada com sucesso!");
                    } else {
                        await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagemFinal });
                        console.log("Mensagem de texto enviada (sem imagem encontrada).");
                    }
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
