# Meu Financeiro — HTML + Supabase

MVP de gestão financeira pessoal pronto para hospedar no GitHub Pages.

## O que já funciona

- Cadastro e login via Supabase Auth
- Dashboard mensal
- Lançamento rápido de despesa/receita
- PIX, débito, crédito, dinheiro, boleto e outros meios
- Marcar conta como paga/recebida
- Contas bancárias/carteiras com saldo
- Cartões com limite total, usado e disponível
- Parcelamento no cartão (gera as parcelas futuras)
- Categorias de despesas personalizadas
- Fontes de renda personalizadas
- Planejamento mensal
- Próximos vencimentos
- RLS no Supabase: cada usuário vê apenas os próprios dados
- Layout responsivo para celular e desktop

## 1. Criar o projeto no Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Cole e execute o conteúdo de `supabase/schema.sql`.
4. Em **Authentication > Providers > Email**, deixe Email habilitado.
5. Para facilitar testes, você pode desativar temporariamente a confirmação de e-mail. Em produção, é melhor manter a confirmação.

## 2. Configurar o front-end

Abra `js/supabase-config.js` e troque:

```js
window.SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
window.SUPABASE_ANON_KEY = 'SUA_CHAVE_ANON_PUBLICA';
```

Use somente a **anon/publishable key**. Nunca use a chave `service_role` no HTML/JavaScript público.

## 3. Testar localmente

Evite abrir os arquivos diretamente com `file://`. Use um servidor local.

Com VS Code, use a extensão Live Server, ou rode:

```bash
python -m http.server 5500
```

Depois abra `http://localhost:5500`.

## 4. Publicar no GitHub Pages

1. Crie um repositório no GitHub.
2. Envie todos os arquivos deste projeto.
3. No repositório, abra **Settings > Pages**.
4. Em **Build and deployment**, escolha **Deploy from a branch**.
5. Selecione `main` e `/ (root)`.
6. Salve.

Depois que o GitHub gerar a URL, adicione essa URL no Supabase em:

**Authentication > URL Configuration**

- `Site URL`: sua URL do GitHub Pages
- `Redirect URLs`: adicione também a URL do site

## Observação importante sobre saldo

Nesta primeira versão, o saldo da conta é atualizado quando um lançamento de PIX/débito/dinheiro é marcado como pago ou quando uma receita é recebida. Compras no cartão não retiram dinheiro da conta no momento da compra; elas comprometem o limite do cartão.

O limite usado do cartão é calculado pela soma das parcelas de crédito ainda pendentes. Assim uma compra de R$ 1.200 em 6x de R$ 200 compromete R$ 1.200 inicialmente e libera R$ 200 à medida que cada parcela é marcada como paga.
