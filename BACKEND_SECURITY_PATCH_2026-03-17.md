# Patch de Correção de Segurança do Backend

Data: 2026-03-17

## Escopo aplicado

- Remoção de segredo JWT hardcoded com fallback inseguro.
- Restrição de senha de link público por query string.
- Sanitização de HTML de templates de contratos antes de persistir e antes de gerar PDF.

## Alterações implementadas

### 1) Segredo JWT

- Criado provedor central de segredo JWT em memória quando `JWT_SECRET` não está definido.
- O fallback agora é aleatório por execução, não previsível e não hardcoded.
- `JWTService` e `SecurityService` passaram a consumir a mesma fonte de segredo.

Arquivos:
- `internal/service/jwt_secret_provider.go`
- `internal/service/jwt_service.go`
- `internal/service/security_service.go`

### 2) Link público com senha

- A leitura da senha via query string (`?p=`) foi desabilitada por padrão.
- Compatibilidade legada controlada por variável de ambiente:
  - `ALLOW_PUBLIC_SHARE_QUERY_PASSWORD=true` habilita fallback legado.
- Fluxo preferencial mantido por header `X-Share-Password`.

Arquivo:
- `internal/api/handlers/document_handler.go`

### 3) Templates de contrato (HTML -> PDF)

- Sanitização de HTML aplicada em três pontos:
  - criação de template;
  - atualização de template;
  - renderização/geração de PDF.
- Remoção de padrões perigosos:
  - tags de script/iframe/object/embed/base/link e meta refresh;
  - atributos de evento inline (`on*`);
  - URLs perigosas em `href/src/xlink:href` (`javascript:`, `data:text/html`, `file:`).

Arquivo:
- `internal/api/handlers/contract_handler.go`

## Compatibilidade e risco de quebra

- JWT sem `JWT_SECRET` continua funcionando, mas com segredo efêmero em memória por execução.
- Links públicos existentes continuam funcionando com header `X-Share-Password`.
- Se houver cliente legado usando `?p=`, habilitar `ALLOW_PUBLIC_SHARE_QUERY_PASSWORD=true` temporariamente.
- Templates com conteúdo malicioso passam a ser limpos automaticamente.

## Recomendações operacionais

- Definir `JWT_SECRET` forte e estável em todos os ambientes.
- Migrar clientes legados para `X-Share-Password` e depois manter `ALLOW_PUBLIC_SHARE_QUERY_PASSWORD` desativado.
- Revisar templates antigos e remover dependências de recursos externos não essenciais.
