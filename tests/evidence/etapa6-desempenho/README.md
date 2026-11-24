# Etapa 6 — comparação visual sintética

As capturas usam dados sintéticos e não contêm informação de clientes.

- `antes-mobile.png`: reconstrução visual do layout anterior a partir do código da versão ativa `eeadc03`. O gráfico foi representado por um espaço reservado; não é uma captura da produção.
- `depois-mobile-320.png`, `depois-mobile.png` e `depois-desktop.png`: componente `ProfessionalPerformance` real em repouso, renderizado num preview local com resposta simulada. Os detalhes diários e a linha-guia ficam ocultos em repouso.
- `tooltip-mobile.png`: o mesmo componente durante um toque no gráfico. A caixa junto à linha mostra data, ganhos e serviços desse dia; ao soltar, ambos desaparecem. O browser verificou o arrastar entre datas e a ausência de overflow horizontal em 320 e 390 px.

A igualdade dos indicadores e serviços entre as duas instâncias do componente e a seleção das datas personalizadas foram verificadas nas versões anteriores deste candidato.

O preview não executou consultas nem escritas remotas.
