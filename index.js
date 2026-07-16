const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

const TELEGRAM_ALLOWED_CHAT_ID = process.env.TELEGRAM_ALLOWED_CHAT_ID;
const WHATSAPP_GROUP_ID = process.env.WHATSAPP_GROUP_ID; // formato: numero-numero@g.us

let sock;
let qrCodeAtual = null;
let conectado = false;

const DOMINIOS_ML = ['mercadolivre.com.br', 'mercadolivre.com', 'mercadolibre.com', 'meli.la'];

// --------- Conexão com o WhatsApp (Baileys) ---------

async function conectarAoWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

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
            console.log('Novo QR code gerado. Acesse /qr no navegador para escanear.');
        }

        if (connection === 'open') {
            conectado = true;
            qrCodeAtual = null;
            console.log('🎉 WhatsApp conectado com sucesso!');
        }

        if (connection === 'close') {
            conectado = false;
            const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReconectar) {
                setTimeout(() => conectarAoWhatsApp(), 5000);
            }
        }
    });
}

conectarAoWhatsApp();

app.get('/qr', async (req, res) => {
    if (conectado) {
        return res.send('<h2>WhatsApp já está conectado! Não precisa escanear nada.</h2>');
    }
    if (!qrCodeAtual) {
        return res.send('<h2>Aguardando QR code ser gerado... atualize a página em alguns segundos.</h2>');
    }
    const imagemQR = await qrcode.toDataURL(qrCodeAtual);
    res.send(`<div style="text-align:center;padding:40px"><h2>Escaneie com o WhatsApp:</h2><img src="${imagemQR}" /></div>`);
});

// --------- Extração do link e busca de dados do produto ---------

function extrairLinkML(texto) {
    const urls = texto.match(/https?:\/\/[^\s]+/g) || [];
    return urls.find(url => DOMINIOS_ML.some(dominio => url.includes(dominio))) || null;
}

async function buscarDadosProduto(linkAfiliado) {
    const dados = {
        titulo: null,
        imagem: null,
        preco: null,
        cupom: null
    };

    try {
        // Segue o redirecionamento só para ENXERGAR a página do produto — o link enviado
        // na mensagem continua sendo o seu link de afiliado original, intacto.
        const resposta = await axios.get(linkAfiliado, {
            maxRedirects: 5,
            timeout: 10000,
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(resposta.data);

        dados.titulo = $('meta[property="og:title"]').attr('content')
            || $('title').text()
            || null;
        if (dados.titulo) {
            dados.titulo = dados.titulo.replace(/\s*\|\s*Mercado Livre.*/i, '').trim();
        }

        dados.imagem = $('meta[property="og:image"]').attr('content') || null;

        // Preço: tenta os formatos mais comuns nas páginas do Mercado Livre
        const precoMeta = $('meta[itemprop="price"]').attr('content')
            || $('meta[property="product:price:amount"]').attr('content');
        if (precoMeta) {
            dados.preco = `R$ ${Number(precoMeta).toFixed(2).replace('.', ',')}`;
        } else {
            const precoFracao = $('.andes-money-amount__fraction').first().text();
            if (precoFracao) {
                dados.preco = `R$ ${precoFracao}`;
            }
        }

        // Cupom: nem sempre vem no HTML estático (às vezes só carrega via JS na página real)
        const textoPagina = $('body').text();
        const matchCupom = textoPagina.match(/cupom[:\s]+([A-Z0-9]{4,15})/i);
        if (matchCupom) {
            dados.cupom = matchCupom[1];
        }
    } catch (e) {
        console.log('Não foi possível buscar dados do produto:', e.message);
    }

    return dados;
}

function montarMensagem(linkAfiliado, dados, legendaManual) {
    const titulo = dados.titulo || legendaManual || 'Oferta imperdível no Mercado Livre!';

    let corpo = `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n`;
    corpo += `🛍️ *${titulo}*\n\n`;
    if (dados.preco) {
        corpo += `💰 Preço: *${dados.preco}*\n\n`;
    }
    if (dados.cupom) {
        corpo += `🎟️ Cupom: *${dados.cupom}*\n\n`;
    }
    corpo += `🔗 Comprar agora:\n${linkAfiliado}\n\n`;
    corpo += `⚠️ *Atenção:* estoques promocionais costumam acabar rápido!`;

    return corpo;
}

async function enviarWhatsApp(mensagem, imagemUrl) {
    if (!conectado) {
        console.log('WhatsApp ainda não conectado, não foi possível enviar.');
        return;
    }
    try {
        if (imagemUrl) {
            await sock.sendMessage(WHATSAPP_GROUP_ID, { image: { url: imagemUrl }, caption: mensagem });
        } else {
            await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagem });
        }
        console.log('Mensagem enviada ao grupo com sucesso!');
    } catch (e) {
        console.log('Erro ao enviar mensagem:', e);
    }
}

// --------- Webhook do Telegram ---------

app.post('/telegram-webhook', async (req, res) => {
    const dados = req.body || {};
    const mensagemObjeto = dados.message || dados.channel_post;

    if (!mensagemObjeto) {
        return res.json({ status: 'ignorado' });
    }

    const chatId = String(mensagemObjeto.chat?.id ?? '');
    if (TELEGRAM_ALLOWED_CHAT_ID && chatId !== String(TELEGRAM_ALLOWED_CHAT_ID)) {
        console.log('Mensagem ignorada, veio de chat não autorizado:', chatId);
        return res.json({ status: 'nao_autorizado' });
    }

    const texto = mensagemObjeto.text || '';
    const link = extrairLinkML(texto);

    if (link) {
        const legendaManual = texto.replace(link, '').trim() || null;
        const dadosProduto = await buscarDadosProduto(link);
        const mensagemFinal = montarMensagem(link, dadosProduto, legendaManual);
        await enviarWhatsApp(mensagemFinal, dadosProduto.imagem);
    } else {
        console.log('Nenhum link do Mercado Livre encontrado na mensagem.');
    }

    res.json({ status: 'sucesso' });
});

app.get('/', (req, res) => {
    res.send('Bot do QG das Ofertas (Mercado Livre) está ativo! Acesse /qr para conectar o WhatsApp.');
});

const porta = process.env.PORT || 5000;
app.listen(porta, () => console.log(`Servidor rodando na porta ${porta}`));
