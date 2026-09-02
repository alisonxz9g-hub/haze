# Observed Haze 4.0 Web

Site de uma página que executa no navegador a transformação de contêiner encontrada
em uma saída do Haze Engine 4.0. O MP4 é lido e processado localmente; nenhum vídeo
é enviado ao servidor.

## Compatibilidade

A versão web exata exige:

- `.mp4` ou `.m4v` de até 1 GiB;
- exatamente um `ftyp`, um `moov` e um `mdat`;
- exatamente uma track de vídeo e uma de áudio com sample entry `mp4a`/AAC;
- tabelas `stco`, `stsc`, `stsz` variável e `stts` consistentes;
- metadata `ilst` existente;
- offsets de 32 bits (`co64` é recusado);
- estrutura não fragmentada.

Entradas incompatíveis são recusadas antes da geração. O navegador não converte
Opus para AAC nesta versão, pois isso exigiria um encoder AAC confiável no cliente
ou um backend com FFmpeg.

## Transformação

1. valida bounds, tamanhos e hierarquia dos boxes;
2. move `moov` antes de `mdat` e recalcula todos os `stco`;
3. remove `edts` das tracks;
4. clona a track AAC e atribui um novo `track_ID`;
5. acrescenta 9× a contagem original de amostras artificiais de 8 bytes/1 tick;
6. grava o padrão `00 00 00 04 00 00 00 00` depois de `mdat`;
7. adiciona `Haze Engine 4.0` em `©too`;
8. gera um download local e um relatório da transformação.

O resultado é deliberadamente não conforme ao ISO BMFF, porque o trailer fica fora
de qualquer box. O efeito em plataformas permanece hipótese; o site não promete
mais qualidade nem menos compressão.

## Download em celulares

O botão **Baixar MP4** usa o seletor de arquivos do Chrome no Android e grava o
`Blob` final diretamente no destino escolhido. Não são usadas URLs `blob:` no
gerenciador de downloads nem um Service Worker intermediário. O MP4 não é enviado
a servidor algum. O salvamento direto requer Chrome 132 ou mais recente no Android.
No computador, o navegador continua usando o download direto normal.

## Desenvolvimento

Requer Node.js 22.13 ou superior.

```powershell
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Verificação

```powershell
npm run test:haze
npm run lint
npm run build
```

O autoteste cria um MP4 sintético com vídeo e AAC, aplica a transformação e verifica
a nova track, contagem de amostras, trailer, layout e hash do `mdat`.

## Hospedagem

### GitHub Pages

O build estático usa a base `/haze/` e copia a saída publicável para a raiz do
repositório:

```powershell
npm run build:pages
git add .
git commit -m "build: update GitHub Pages"
git push
```

No GitHub, configure **Settings → Pages → Deploy from a branch**, selecione a branch
`main` e a pasta `/(root)`. A página ficará em
`https://alisonxz9g-hub.github.io/haze/`.

Os arquivos `index.html`, `assets/`, `og.png`, `favicon.svg` e `.nojekyll` da raiz
são a publicação estática. Eles devem ser versionados.

### Cloudflare Worker

O projeto também usa Vinext e gera saída ESM compatível com Cloudflare Worker:

```powershell
$env:NEXT_PUBLIC_SITE_URL="https://seu-dominio.com"
npm run build
```

Não são necessários banco de dados, bucket, credenciais ou armazenamento de uploads.
O arquivo selecionado permanece no dispositivo do visitante. Sirva o site por HTTPS
para garantir disponibilidade consistente de Web Workers e Web Crypto.

Antes da publicação, rode `npm audit` e atualize o scaffold quando houver uma versão
compatível. Na data desta entrega, o audit ainda relata advisories transitórios do
Vinext/Vite/React Server Components sem correção disponível nas versões fixadas pelo
scaffold; o site não usa Server Functions nem recebe o MP4 no servidor.

## Limites de segurança

- entrada nunca é alterada;
- nenhuma saída é criada quando uma precondição falha;
- boxes desconhecidos dentro das regiões reconstruídas são preservados;
- qualquer `stco` fora do `mdat` é recusado;
- overflows de 32 bits e trailers acima de 512 MiB são recusados;
- o processamento pesado ocorre em Web Worker para não congelar a interface.
