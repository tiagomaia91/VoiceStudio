# Maia Voice: ambiente de teste (GitHub Codespaces)

Este ambiente sobe o Maia Voice completo, em modo CPU, para testes internos
antes do deploy em voice.maiasolucoes.pt.

## Como usar

1. Aguarde a instalação terminar no terminal (a primeira vez leva de 10 a 20 minutos).
2. Ao final aparece a **chave de acesso**. Copie.
3. Abra a aba **PORTS**, clique no globo da porta **3900 (Maia Voice)**.
4. Na tela de login, cole a chave de acesso.
5. No primeiro uso, instale o pacote de modelos **Rápido** ou **Equilibrado**
   (download de alguns GB, feito uma única vez por Codespace).

## Dicas

- A porta fica **privada** por padrão: só quem está logado na sua conta GitHub abre o link.
- Sem GPU, cada geração de voz demora mais. Para teste de laboratório é suficiente.
- Para ver a chave de novo: `cat /workspaces/maia-voice-data/.maia-api-key`
- Para reiniciar o servidor: `bash .devcontainer/start.sh`
- Logs: `tail -f /workspaces/maia-voice-data/maia-voice.log`
- **Pare o Codespace quando terminar** (menu Codespaces > Stop) para não consumir horas da cota.
