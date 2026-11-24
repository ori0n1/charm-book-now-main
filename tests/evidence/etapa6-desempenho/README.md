# Etapa 6 — comparação visual sintética

As capturas usam dados sintéticos e não contêm informação de clientes.

- `antes-mobile.png`: reconstrução visual do layout anterior a partir do código da versão ativa `eeadc03`. O gráfico foi representado por um espaço reservado; não é uma captura da produção.
- `depois-mobile-320.png`, `depois-mobile.png` e `depois-desktop.png`: componente `ProfessionalPerformance` real, renderizado num preview local com a resposta da consulta simulada. O browser verificou os três indicadores compactos lado a lado, gráfico e serviços empilhados, gesto de toque no gráfico (data, ganhos e todos os serviços do dia), nomes completos, percentagens e barras do período, ausência de overflow horizontal e igualdade dos indicadores e serviços entre as duas instâncias do componente. A seleção das datas personalizadas foi verificada na primeira versão deste candidato.

O preview não executou consultas nem escritas remotas.
