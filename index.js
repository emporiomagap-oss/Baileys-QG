const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const { URL } = require('url'); 
const { getLinkPreview } = require('link-preview-js'); 
const app = express();

app.use(express.json());

// Variáveis de ambiente configuradas no Render
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID; // ID do grupo (ex: 120363xxxxxxxxx@g.us)
const MERCADO_LIVRE_AFF_ID = process.env.MERCADO_LIVRE_AFF_ID; 

let sock; // Variável global para armazenar a conexão do WhatsApp
let qrCodeAtual = null; // Guarda o último QR Code gerado para exibir na web

// Função para iniciar e manter a conexão do WhatsApp
async function conectarAoWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando a versão do WhatsApp Web: ${version.join('.')}, última versão disponível: ${isLatest}`);

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
            console.log("==================================================");
            console.log(" ESCANEIE O QR CODE NA PÁGINA DA WEB DO SEU BOT!  ");
            console.log("==================================================");
            qrCodeAtual = qr;
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const deveriaReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada devido a:', lastDisconnect?.error, '. Reconectando:', deveriaReconectar);
            if (deveriaReconectar) {
                setTimeout(() => conectarAoWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('🎉 WHATSAPP CONECTADO COM SUCESSO!');
            qrCodeAtual = null;
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

// Função de desembrulhar link com plano B (GET) para links "meli.la"
async function desembrulharLink(urlCurta) {
    try {
        const resposta = await axios.head(urlCurta, { maxRedirects: 5, timeout: 10000 });
        return resposta.request.res.responseUrl || urlCurta;
    } catch (e) {
        try {
            const respostaGet = await axios.get(urlCurta, { maxRedirects: 5, timeout: 10000 });
            return respostaGet.request.res.responseUrl || urlCurta;
        } catch (erroGet) {
            console.log(`Erro ao desembrulhar link ${urlCurta}:`, erroGet.message);
            return urlCurta;
        }
    }
}

// Função para limpar rastreamentos antigos da URL do Mercado Livre
function limparUrlML(urlOriginal) {
    try {
        const urlObj = new URL(urlOriginal);
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

    if (texto.includes("mercadolivre.com") || texto.includes("mlb.io") || texto.includes("mercadolivre.com.br") || texto.includes("meli.la")) {
        const linkCurto = extrairLink(texto);
        if (linkCurto) {
            console.log(`Link encontrado: ${linkCurto}. Processando...`);
            
            const linkReal = await desembrulharLink(linkCurto);
            const linkLimpo = limparUrlML(linkReal);
            const linkCodificado = encodeURIComponent(linkLimpo);
            
            const linkAfiliado = `https://www.mercadolivre.com.br/social/afiliados/c/share?s=${linkCodificado}&custom_id=${MERCADO_LIVRE_AFF_ID}`;

            // Tenta buscar o título do produto para enfeitar o texto
            let tituloProduto = "Oferta imperdível no Mercado Livre!";
            
            try {
                const preview = await getLinkPreview(linkLimpo, {
                    headers: {
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                    timeout: 5000
                });
                
                if (preview && preview.title) {
                    tituloProduto = preview.title.replace(" | Mercado Livre", "").trim();
                }
            } catch (erroPreview) {
                console.log("Não foi possível buscar o título do produto:", erroPreview.message);
            }

            // Formato limpo para forçar o WhatsApp a gerar o Card de Preview do Link automaticamente
            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `🛍️ *${tituloProduto}*\n\n` +
                `👉 ${linkAfiliado}\n\n` +
                `⚠️ *Atenção:* Estoques promocionais do Mercado Livre costumam acabar em minutos!`;

            if (sock && sock.user) {
                try {
                    await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagemFinal });
                    console.log("Mensagem com preview automático enviada com sucesso!");
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
