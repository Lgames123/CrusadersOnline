# Prompt de implementação — inventário modernizado inspirado em MU Online

Use este prompt para implementar o menu de inventário. O resultado deve substituir a UI atual em lista, sem quebrar o inventário persistente, o combate ou os modelos originais já carregados pelo projeto.

```text
Você está trabalhando no repositório CrusadersOnline. Implemente um sistema de inventário visual, moderno e responsivo, inspirado na ergonomia do MU Online, mas com identidade própria de Crusaders of Might and Magic. Não copie arte, molduras, tipografia, ícones ou layout proprietário de MU Online; use a direção visual já existente no jogo (metal escuro, pedra, pergaminho discreto e alto contraste).

Antes de alterar código, leia:
- AGENTS.md e docs/context/INDEX.md;
- docs/gameplay-systems.md, especialmente a seção de inventário;
- shared/src/game/items.ts;
- client/src/ui/inventory.ts;
- client/src/assets/item_models.ts;
- converter/src/formats/items_ctx.ts;
- docs/reverse-engineering/asset-format-discovery.md, para itens no chão.

## Fatos confirmados que devem orientar a implementação

- `script/items.ctx`, já convertido por `converter/src/formats/items_ctx.ts`, contém `Width`, `Height`, `Model`, `Type`, `Stackable` e herança entre itens. Resolva a herança antes de usar os dados.
- As dimensões não devem ser inventadas. Exemplos já confirmados em `items.ctx`: Axe e Long Sword herdado = 1×3 (3 células); Wooden/Metal Shield = 2×2 (4 células); Scale/Banded/Light/Heavy Plate Armor = 2×3 (6 células); Healing Potion, Magic Ring e livros = 1×1.
- O catálogo atual em `shared/src/game/items.ts` ainda não expõe `width`, `height`, `model` nem todos os tipos de equipamento. Amplie-o de modo compatível, mantendo os slugs e a persistência existentes. Quando os assets convertidos não estiverem presentes, use dimensões de fallback seguras para o catálogo embutido e nunca permita `undefined`, 0 ou dimensão negativa.
- O sistema atual persiste `slot`, `itemId`, `equipped` e `quantity`; é servidor-autoritativo. Não permita que um cliente valide sozinho espaço, pickup, troca, drop ou equipamento. Migrações e mensagens de protocolo devem ser versionadas e validadas.
- `client/src/assets/item_models.ts` já mapeia modelos de armas, escudos e armaduras. Reaproveite esse caminho e os GLB gerados localmente; não adicione assets proprietários ao Git. Caso um modelo não exista, apresente um placeholder 2D elegante com nome e silhueta genérica.
- O jogo já instancia itens no chão a partir das colocações originais. O formato de colocação confirma quantidade e nome de item em objetos de chão. Não trate essa informação como UI fictícia.

## Objetivo de interface

Crie três painéis independentes, que podem ficar abertos simultaneamente:

1. **Inventário / mochila** — ancorado à esquerda; atalho `Shift+I`.
2. **Personagem / equipamento** — no centro; atalho `Shift+C`.
3. **Itens no chão** — à direita; atalho `Shift+G`.

Cada atalho alterna somente o respectivo painel. Preserve os demais painéis abertos. Inclua botão de fechar acessível, rótulo visível do atalho e foco de teclado correto. Não capture os atalhos enquanto o usuário estiver digitando em um campo de texto. Em telas estreitas, os painéis devem virar gavetas/abas sem sobrepor controles indispensáveis; a ordem de navegação deve ser Inventário, Personagem, Chão.

### Painel de inventário (esquerda)

- Exiba um grid retangular de células, não uma lista. Escolha uma dimensão inicial adequada ao inventário atual de 32 posições e documente a escolha (por exemplo, 8×4); a lógica deve aceitar configuração futura por largura/altura.
- Cada item ocupa exatamente o retângulo `width × height` de `items.ctx`, começando na célula de origem. Mostre a arte/modelo do item abrangendo todas as células ocupadas, com contador de pilha no canto inferior direito.
- Ao arrastar, destaque: origem, área válida em verde/azul, colisão ou extrapolação em vermelho e a área que será deslocada, se houver. Soltar em área inválida não altera estado. O item só pode ser rotacionado se o modelo de dados permitir explicitamente essa opção; por padrão, preserve `width × height` original e não implemente rotação silenciosa.
- Clique/teclado devem oferecer uma alternativa acessível ao arrastar: selecionar item, selecionar destino, confirmar/cancelar. Tooltips mostram nome, tipo, dimensões, quantidade e atributos já existentes (dano, velocidade, proteção e cura).
- Itens empilháveis devem manter o limite existente (`MAX_STACK = 99`) e exibir quantidade; combine/divida pilhas somente por requisição validada pelo servidor.

### Painel de personagem (centro)

- Apresente uma silhueta 3D ou uma representação 2D limpa do personagem no centro. Ao redor dela, slots explícitos para arma (mão principal), escudo/mão secundária, armadura de torso e anéis. Estruture os slots para cabeça, botas e outros tipos futuros, mesmo que alguns ainda não estejam disponíveis no catálogo.
- Aceite apenas tipos compatíveis em cada slot. Equipar uma peça deve remover a peça anterior de maneira atômica e tentar colocá-la em área livre da mochila; se não houver espaço, a ação deve falhar sem perda ou duplicação.
- O estado equipado deve continuar refletindo no avatar do mundo por meio de `lookFromInventory`/`outfitFor` e no cálculo de combate do servidor.
- A UI deve explicar visualmente por que uma ação falhou (tipo incompatível, sem espaço, item bloqueado durante golpe, inventário desatualizado).

### Painel de itens no chão (direita)

- Mostre somente itens próximos ao personagem, com distância, quantidade, nome e preview. Atualize quando o jogador se move, um item é coletado, desaparece ou surge.
- Permita selecionar, usar a ação de coletar e arrastar para a mochila como intenção de pickup. A coleta final deve ser autorizada pelo servidor, que valida distância, existência, propriedade de loot se aplicável e espaço completo no grid.
- Quando a mochila não tiver área suficiente, mantenha o item no chão e informe qual espaço é necessário; não faça pickup parcial de equipamento não empilhável.
- Mantenha a interação original por tecla `E`/interação onde ela já existe; o painel é uma segunda superfície para a mesma ação, não uma fonte de estado paralela.

## Modelo 3D enquanto o item está sendo segurado

Durante um drag, renderize perto do cursor um preview do modelo 3D do item, em pequena viewport/canvas transparente, com rotação lenta e contínua (por exemplo, ~20–30 graus por segundo). Ele deve:

- girar sem alterar a orientação ou o estado do modelo no mundo;
- usar clone/instância segura e liberar recursos ao soltar, cancelar, trocar de zona ou desmontar a UI;
- degradar para ícone/placeholder se o modelo não estiver disponível ou se WebGL falhar;
- respeitar `prefers-reduced-motion`, pausa do jogo e navegação por teclado;
- nunca bloquear a leitura do realce de células nem interceptar o evento de soltar.

Evite criar um renderer WebGL por item. Use uma viewport reutilizável, carregamento sob demanda, cache de modelos e um único loop de animação pausável.

## Arquitetura, dados e rede

- Separe estado de apresentação (painéis abertos, item selecionado, hover, drag otimista) do estado autoritativo de inventário/itens no chão.
- Evolua o inventário de “índice de slot único” para posicionamento no grid de forma migrável: cada entrada precisa de uma célula de origem e a ocupação deve ser derivada de `width × height`. Defina claramente como os registros atuais de 0–31 são convertidos para coordenadas sem colisão. Não apague itens existentes nem reorganize inventário de um jogador sem uma regra determinística documentada.
- Crie funções puras e testadas para: limites, ocupação, colisão, busca de primeira área livre, mover, swap, empilhar, dividir, equipar, desequipar e conversão de inventário legado. As funções devem receber dimensões e não depender do DOM.
- Crie comandos/mensagens explícitos para mover no grid, equipar/desequipar e coletar do chão. Valide esquema, permissões, dimensões, origem, destino, quantidade e versão/revisão do inventário no servidor. Uma atualização autoritativa deve reconciliar qualquer preview otimista.
- Conserve as proteções anti-duplicação: transações de banco com locks de linha para mutações persistentes; uma operação falha integralmente se qualquer pré-condição falhar.
- Não declare anéis, botas, capacetes ou novos tipos como funcionais no combate antes de o servidor e o catálogo os suportarem. Mostre slots futuros vazios/desabilitados com um estado honesto quando necessário.

## Qualidade, testes e critérios de aceite

Implemente testes unitários para o grid (incluindo os tamanhos 1×3, 2×2, 2×3), bordas, colisões, conversão das 32 posições legadas, pilhas e operações atômicas. Adicione testes de integração para requests inválidas, corrida de duas mutações e pickup sem espaço. Teste manualmente mouse, toque e teclado.

Considere concluído apenas quando:

1. `Shift+I`, `Shift+C` e `Shift+G` abrem/fecham independentemente os painéis esquerdo, central e direito.
2. Espada 1×3, escudo 2×2 e armadura 2×3 ocupam respectivamente 3, 4 e 6 células reais no grid.
3. Nenhum item pode sobrepor outro, sair dos limites, desaparecer ou duplicar após mover, equipar, desequipar, empilhar ou coletar.
4. Equipamento atualizado aparece no avatar e continua afetando as regras de combate existentes.
5. O item segurado possui preview 3D rotativo com fallback e sem vazamento perceptível de recursos.
6. Itens no chão exibidos são derivados do estado do mundo e a coleta continua servidor-autoritativa.
7. O layout funciona em desktop e tela estreita, e todas as ações essenciais têm alternativa por teclado.
8. Lint, testes relevantes e build passam; documente decisões, limitações e qualquer dado original ainda não decodificado.

Faça mudanças incrementais e mantenha compatibilidade durante a migração. Ao final, informe os arquivos alterados, migrações executadas, testes realizados e qualquer follow-up que dependa de investigação adicional do executável ou dos dados originais.
```

## Referências verificadas no repositório

- `Crusaders of Might and Magic/script/items.ctx`: fonte local dos campos `Width`, `Height`, `Model` e das regras de herança.
- `shared/src/game/items.ts`: catálogo e persistência lógica atuais (32 posições, pilhas até 99).
- `client/src/ui/inventory.ts`: painel atual, ainda baseado em listas.
- `client/src/assets/item_models.ts`: associação atual de itens aos modelos convertidos.
- `docs/reverse-engineering/asset-format-discovery.md`: evidências dos objetos e quantidades de itens no chão.
