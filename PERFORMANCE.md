# Carregamento do site principal

A página inicial é entregue sem consultar Supabase. O navegador carrega o catálogo e as configurações em paralelo. Respostas de catálogo e configurações ficam em cache no processo por 30 segundos, com uma única consulta compartilhada entre visitantes simultâneos. A ordem dos vídeos é embaralhada no navegador a cada abertura ou refresh, mesmo quando os dados vêm do cache; a busca preserva essa ordem durante a visita. A seção de mais vídeos também usa ordem aleatória. Alterações pelo administrador invalidam o cache do servidor; navegadores podem manter o catálogo público por até 60 segundos.

HTML, CSS, JavaScript e JSON usam compressão HTTP. CSS e JavaScript recebem uma versão calculada pelo conteúdo para permitir cache longo sem prender clientes em arquivos antigos.

## Miniaturas

As imagens JPEG em `public/posters` são extraídas uma única vez antes da publicação, com 480 × 270 px e o mesmo recorte central usado pelos cards. Foram geradas 32 capas, totalizando 310.545 bytes, em média 9,5 KB cada. Inclua essa pasta no deploy. Os nomes dependem do vídeo e do segundo selecionado; substituir um vídeo ou mudar o segundo exige gerar a nova imagem. Os vídeos continuam a ser reproduzidos a partir da fonte original.

Após adicionar ou substituir vídeos, execute com as credenciais do ambiente e FFmpeg instalado:

```powershell
$env:DOTENV_CONFIG_PATH = '.env.txt'
$env:FFMPEG_PATH = 'C:/caminho/ffmpeg.exe'
npm run posters:generate
```

O comando só lê Supabase e Wasabi e grava as imagens localmente. Não altera vídeos nem banco. Imagens existentes são reutilizadas. Depois publique as imagens e reinicie o serviço. Para vídeos sem imagem pronta, há um fallback limitado a um vídeo visível de cada vez, desativado em conexões 2G ou com economia de dados.

## Validação

```powershell
npm run test:performance
npm run test:checkout
```

Resultados locais em 22/10/2026, usando o banco remoto:

| Verificação | Antes | Depois |
| --- | ---: | ---: |
| Resposta do HTML inicial | 1.172 ms | 33 ms |
| HTML transferido | 63.533 bytes | 15.092 bytes com gzip |
| Catálogo em chamada repetida | 735 ms sem cache no servidor | 3 ms com cache |
| Vídeos baixados para mostrar capas na abertura | Até 5 simultâneos | 0 para os 32 vídeos atuais |

São medições do servidor local, não tempos garantidos na hospedagem pública. O teste de navegador em `artifacts/performance-browser.json` validou desktop e celular com 150 ms de latência, aproximadamente 1,5 Mbps e CPU 4 vezes mais lenta. Os 32 cards apareceram sem depender da resposta de configurações, sem downloads de vídeos e sem erros de JavaScript. Busca, links de suporte, janela de pagamento e ativação do player passaram. Nenhuma cobrança foi criada.

A implementação segue as orientações sobre [pré-carregamento de vídeos](https://web.dev/articles/fast-playback-with-preload) e [compressão no Express](https://expressjs.com/en/resources/middleware/compression/).

A velocidade pública também depende da hospedagem, da região do servidor e da rede dos clientes. Compare uma abertura após período de inatividade com uma segunda abertura para identificar eventual demora ao iniciar a instância. Nenhum plano de hospedagem é alterado por estas melhorias.
