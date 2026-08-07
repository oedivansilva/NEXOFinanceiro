# NEXO Financeiro

MVP de gestão financeira pessoal em **HTML/CSS/JavaScript + Supabase**, pronto para GitHub Pages.

## Estrutura

```text
NEXOFinanceiro/
├── index.html
├── app.html
├── README.md
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   ├── auth.js
│   └── supabase-config.js
└── supabase/
    └── schema.sql
```

## 1. Criar a estrutura no Supabase

No projeto do NEXO Financeiro:

1. Abra **SQL Editor**.
2. Clique em **New query**.
3. Copie todo o conteúdo de `supabase/schema.sql`.
4. Clique em **Run**.

Isso cria perfis, contas, cartões, categorias, fontes de renda, lançamentos e as políticas RLS para cada usuário ver somente os próprios dados.

## 2. Conexão com o Supabase

O arquivo `js/supabase-config.js` já está configurado com a **Project URL** e a **Publishable Key** informadas para este projeto.

Não coloque no GitHub:
- Database Password
- Secret Key
- service_role

## 3. Configurar Authentication

No Supabase, abra **Authentication > URL Configuration**.

Para o repositório atual, configure:

- Site URL: `https://oedivansilva.github.io/NEXOFinanceiro/`
- Redirect URL: `https://oedivansilva.github.io/NEXOFinanceiro/**`

## 4. GitHub Pages

No GitHub:

1. Suba **o conteúdo desta pasta** para a raiz do repositório.
2. Abra **Settings > Pages**.
3. Em Source, escolha **Deploy from a branch**.
4. Branch: `main`.
5. Pasta: `/ (root)`.
6. Salve.

O `index.html` precisa ficar na raiz do repositório.

## Visual

A interface foi ajustada para seguir a mesma família visual do NEXO Administração/Pessoas: sidebar laranja, fundo claro, cards brancos, tipografia limpa e componentes compactos.
