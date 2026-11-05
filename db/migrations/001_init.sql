-- Tabretta: výchozí schéma (zadání sekce 4).
-- Spouští scripts/migrate.js v transakci; nevyžaduje superuživatele ani rozšíření.

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE CHECK (length(username) BETWEEN 1 AND 64),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  kind        text NOT NULL CHECK (kind IN ('prace', 'soukrome')),
  archived    boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects (user_id, sort_order, id);

CREATE TABLE tasks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   bigint NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
  status       text NOT NULL DEFAULT 'k_udelani'
               CHECK (status IN ('napad', 'k_udelani', 'rozdelane', 'hotovo')),
  due_date     date,
  sort_order   integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_project_idx ON tasks (project_id, sort_order, id);
CREATE INDEX tasks_status_idx ON tasks (status);

CREATE TABLE task_links (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  url     text NOT NULL CHECK (url ~* '^https?://' AND length(url) <= 2000),
  label   text CHECK (length(label) <= 200)
);
CREATE INDEX task_links_task_idx ON task_links (task_id);

CREATE TABLE task_attachments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id       bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),
  stored_name   text NOT NULL UNIQUE CHECK (stored_name ~ '^[0-9a-f]{48}$'),
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_attachments_task_idx ON task_attachments (task_id);

CREATE TABLE shopping_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  quantity   numeric(12, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(12, 2) CHECK (unit_price >= 0),
  bought     boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX shopping_items_task_idx ON shopping_items (task_id, sort_order, id);

-- Závislost je jen upozornění, nic neblokuje. Smí vést i mezi projekty,
-- vždy ale v rámci jednoho uživatele (hlídá aplikace).
CREATE TABLE task_dependencies (
  task_id            bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_task_id bigint NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX task_dependencies_depends_idx ON task_dependencies (depends_on_task_id);

-- Tabulka pro connect-pg-simple (shodná s jeho table.sql). Vytváří ji migrace,
-- aby aplikace za běhu nepotřebovala DDL.
CREATE TABLE "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
