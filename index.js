// 🛠️ ALTERADO: Formato limpo para forçar o WhatsApp a gerar o Card de Preview do Link
            const mensagemFinal = 
                `⚡ *ALERTA NO QG DAS OFERTAS!* ⚡\n\n` +
                `🛍️ *${tituloProduto}*\n\n` +
                `👉 ${linkAfiliado}\n\n` +
                `⚠️ *Atenção:* Estoques promocionais do Mercado Livre costumam acabar em minutos!`;

            if (sock && sock.user) {
                try {
                    // Envia apenas como texto. O WhatsApp vai ler o link do Mercado Livre e gerar o card com foto automaticamente!
                    await sock.sendMessage(WHATSAPP_GROUP_ID, { text: mensagemFinal });
                    console.log("Mensagem com preview automático enviada com sucesso!");
                } catch (erroEnvio) {
                    console.log("Erro ao enviar mensagem pelo Baileys:", erroEnvio);
                }
            } else {
                console.log("Erro: O bot do WhatsApp não está conectado no momento.");
            }
