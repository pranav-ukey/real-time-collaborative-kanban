# Entity Relationship Diagram

```mermaid
erDiagram
  ORGANIZATIONS ||--o{ TENANTS : contains
  ORGANIZATIONS ||--o{ MEMBERSHIPS : has
  USERS ||--o{ MEMBERSHIPS : holds
  TENANTS ||--o{ MEMBERSHIPS : scopes
  ORGANIZATIONS ||--o{ BOARDS : owns
  TENANTS ||--o{ BOARDS : scopes
  USERS ||--o{ BOARDS : creates
  BOARDS ||--o{ COLUMNS : contains
  TENANTS ||--o{ COLUMNS : scopes
  BOARDS ||--o{ TASKS : contains
  COLUMNS ||--o{ TASKS : groups
  TENANTS ||--o{ TASKS : scopes
  USERS ||--o{ TASKS : assigned
  TENANTS ||--o{ ACTIVITY_LOGS : records
  USERS ||--o{ ACTIVITY_LOGS : performs

  ORGANIZATIONS {
    uuid id PK
    varchar name
    timestamp created_at
    timestamp updated_at
  }
  TENANTS {
    uuid id PK
    uuid organization_id FK
    varchar name
    timestamp created_at
    timestamp updated_at
  }
  USERS {
    uuid id PK
    varchar name
    varchar email UK
    varchar password_hash
    timestamp created_at
    timestamp updated_at
  }
  MEMBERSHIPS {
    uuid id PK
    uuid user_id FK
    uuid organization_id FK
    uuid tenant_id FK "nullable for org-level membership"
    varchar role
    timestamp created_at
  }
  BOARDS {
    uuid id PK
    uuid organization_id FK
    uuid tenant_id FK
    varchar name
    text description
    uuid created_by FK
    timestamp created_at
    timestamp updated_at
  }
  COLUMNS {
    uuid id PK
    uuid board_id FK
    uuid tenant_id FK
    varchar name
    int position
    timestamp created_at
  }
  TASKS {
    uuid id PK
    uuid board_id FK
    uuid column_id FK
    uuid tenant_id FK
    varchar title
    text description
    uuid assigned_to FK
    varchar priority
    timestamp due_date
    int position
    int version
    timestamp created_at
    timestamp updated_at
  }
  ACTIVITY_LOGS {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    varchar entity_type
    uuid entity_id
    varchar action
    jsonb details
    timestamp created_at
  }
```

The eight tables above are the eight tables specified in the assignment. Every tenant-owned business table includes `tenant_id`.


Rendered diagram: [`database-erd.png`](database-erd.png). Editable Graphviz source: [`database-erd.dot`](database-erd.dot).
