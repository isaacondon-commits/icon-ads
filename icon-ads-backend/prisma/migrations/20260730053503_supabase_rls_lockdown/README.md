# Supabase RLS lockdown — cómo aplicar, testear y qué credenciales rotar

## Qué hace esta migración

Estado previo (confirmado por vos): `anon` y `authenticated` tenían
SELECT/INSERT/UPDATE/DELETE/TRUNCATE sobre las 30 tablas de `public`, con
RLS activo pero sin políticas en solo 7. Verificado además en el código: la
app **nunca** usa la API de datos de Supabase (PostgREST) ni Supabase Auth
(`auth.users` vacío) — todo el acceso a Postgres pasa por Prisma
(`DATABASE_URL`/`DIRECT_URL`, rol dueño de las tablas). El único uso de la
`anon key` en todo el repo es Supabase **Storage** (subida directa de
archivos), un subsistema aparte. Eso confirma que `anon`/`authenticated` no
tienen ningún motivo legítimo para tocar ninguna tabla.

La migración (`migration.sql`):
1. Mueve `users` y `api_keys` de `public` a un schema nuevo `private`
   (`ALTER TABLE ... SET SCHEMA`, sin pérdida de datos ni de índices/FKs).
2. Habilita RLS sin políticas (deny-by-default) en las 30 tablas.
3. Revoca todos los privilegios de `anon`/`authenticated` sobre tablas,
   secuencias y funciones de `public` — incluye explícitamente
   DELETE/TRUNCATE.
4. Fija `ALTER DEFAULT PRIVILEGES` para que las tablas que se creen en el
   futuro (nuevas migraciones) no hereden acceso para esos roles.

`surveys`, `survey_answers` y `tablet_locations` no están modeladas en
`schema.prisma` (las crea `src/lib/startup-migrate.js` con SQL crudo en
cada arranque) — su RLS se activa ahí mismo, justo después de crearlas, para
que quede cubierto incluso en una base nueva donde esta migración corre
antes de que esas tablas existan.

**No se usó `FORCE ROW LEVEL SECURITY`** — el rol dueño de las tablas
(Prisma) sigue bypasseando RLS como siempre. Nada de esto cambia cómo el
backend consulta la base.

## Validado localmente antes de tocar producción

Levanté Postgres 16 local, repliqué los roles `anon`/`authenticated` y el
estado actual (grants abiertos + RLS solo en las 7 tablas que mencionaste),
y confirmé que HOY `anon` puede efectivamente leer y borrar filas de tablas
sin RLS (ej. `zones`). Después apliqué esta migración desde cero y corrí:
- La app real (`node server.js`) contra la base migrada: seed, login,
  `/api/auth/me`, crear/listar clientes, crear/listar API keys — todo
  funcionando igual que antes (login y `api_keys` ahora leen de `private.*`
  sin que el código de rutas haya cambiado, gracias a `@@schema` de Prisma).
- Simulé el ataque: con la migración aplicada, `anon` recibe
  `permission denied` en `clients`, `private.users`, `private.api_keys` y
  `audit_logs` — lectura, DELETE y TRUNCATE bloqueados.
- Encontré y corregí dos bugs reales que esta migración hubiera introducido
  en `startup-migrate.js`: dos `ALTER TABLE users ...` y un
  `CREATE TABLE IF NOT EXISTS api_keys` sin calificar de schema, que tras el
  move hubieran fallado (los `ALTER`) o — peor — recreado una tabla
  `api_keys` vacía y sin proteger en `public` (el `CREATE TABLE IF NOT
  EXISTS` sin schema no encuentra la tabla movida). Ya están arreglados
  (`private.users`, `private.api_keys`).

No pude correr esto contra la base de Supabase real desde este entorno (sin
credenciales de producción ni acceso de red a Supabase) — todo lo anterior
fue contra una base Postgres local con la misma estructura.

## Cómo aplicarlo en el proyecto real

El build script del backend ya corre `prisma generate && prisma migrate
deploy`, así que en principio alcanza con mergear y deployar esta rama. Un
solo riesgo real, documentado en el propio código
(`src/lib/startup-migrate.js`, comentario del encabezado): si `DIRECT_URL`
no está seteada en Render (el pooler PgBouncer en modo transacción no
soporta migraciones completas), `prisma migrate deploy` puede fallar en el
build.

**Recomendado — confirmar primero:**
1. En Render, revisar que la env var `DIRECT_URL` esté seteada (puerto 5432
   directo de Supabase, no el pooler 6543). Ver `TECHNICAL.md`.
2. Si está seteada: mergear y deployar esta rama normalmente. Listo.

**Fallback si el deploy falla en el paso de migración:**
1. Abrir el SQL Editor de Supabase (conexión directa, sin pooler) y pegar
   el contenido completo de `migration.sql` de esta carpeta. Ejecutar.
2. Marcar la migración como aplicada para que `prisma migrate deploy` no
   intente correrla de nuevo en el próximo deploy:
   ```
   npx prisma migrate resolve --applied 20260730053503_supabase_rls_lockdown
   ```
   (requiere `DATABASE_URL` apuntando a producción desde tu máquina).
3. Redeployar. El build va a correr `prisma generate` (necesario porque el
   cliente de Prisma cambió — ahora sabe que `User`/`ApiKey` viven en
   `private`) y `prisma migrate deploy` va a ver la migración ya aplicada y
   seguir sin error.

## Cómo testear en el proyecto real (post-deploy)

1. **Login y flujo normal del panel**: entrar, ver clientes/campañas/ads,
   crear un cliente de prueba, ver que las tablets sigan sincronizando.
   Si todo eso funciona, Prisma sigue teniendo acceso completo (esperado,
   es el dueño de las tablas).
2. **Confirmar el bloqueo de `anon`**, desde el SQL Editor de Supabase
   (rol admin, tiene permiso para `SET ROLE`):
   ```sql
   SET ROLE anon;
   SELECT count(*) FROM public.clients;      -- debe dar "permission denied"
   SELECT count(*) FROM private.users;       -- debe dar "permission denied for schema private"
   DELETE FROM public.zones;                 -- debe dar "permission denied"
   RESET ROLE;
   ```
3. **Confirmar que RLS quedó activo en todo**:
   ```sql
   SELECT schemaname, tablename, rowsecurity
   FROM pg_tables WHERE schemaname IN ('public','private')
   ORDER BY 1,2;
   ```
   Las 30 filas deben tener `rowsecurity = t`.
4. **Confirmar que `private` no está expuesto por la API de datos**:
   Supabase Dashboard → Project Settings → API → "Exposed schemas" — debe
   decir solo `public` (nunca agregar `private` ahí).
5. **Probar la subida de anuncios** (usa la `anon key` para Storage, el
   único uso legítimo que le queda): subir un video/imagen desde el panel
   y confirmar que se sube bien — esta migración no toca Storage para nada,
   pero es la única superficie que sigue usando esa key, vale la pena
   confirmarlo.

## Qué credenciales rotar

La falla real no era la `anon key` en sí (es pública por diseño) sino que
esa key tenía permiso de leer/escribir/borrar todo. Rotarla no arregla nada
por sí sola — lo que corrige el problema es esta migración. Dicho eso, dado
que la base estuvo abierta, hay que asumir que cualquier dato en las 23
tablas sin RLS pudo haber sido leído por cualquiera que tuviera la `anon
key` (que además está commiteada en `icon-ads-web/.env.production`, así que
"pública" para cualquiera con acceso al repo). Recomiendo, en este orden:

| Credencial | Por qué | Cómo |
|---|---|---|
| **Tokens de tablets** (`tablets.token`) | Tabla `public.tablets` no tenía RLS — cualquiera con la anon key pudo leer los tokens de auth de TODOS los dispositivos. | Ya existe el endpoint `POST /api/tablets/:id/regenerate-token` (admin). Regenerar el de cada tablet y forzar reenrolamiento/actualización si hace falta. |
| **API keys emitidas** (`api_keys.key`) | Misma tabla, sin RLS hasta ahora, y encima con la key completa en texto plano en la fila. | Regenerar cada key desde `/api/admin/api-keys` y avisar a quien las use externamente. |
| **JWT_SECRET** | Si alguien pudo leer `users` (password hashes) o insertar filas directo, invalidar todas las sesiones activas es la forma más simple de cortar cualquier acceso ya obtenido. | Cambiar la env var en Render y redeployar — invalida todos los JWT emitidos hasta ahora. |
| **Contraseñas de usuarios admin** | `users.password` (hash bcrypt) estaba en una tabla con RLS pero sin políticas — ya estaba protegida contra `anon`, así que esta es la de menor urgencia real, pero como higiene tras un período de exposición amplia del resto de la base, conviene forzar cambio de contraseña a todos los admins. | `POST /api/auth/change-password` o el flujo de "olvidé mi contraseña" si existe. |
| Anon key / Storage | No es la causa ni quedó comprometida por este bug — es pública por diseño. Rotarla solo por higiene general (ya está en git), pero no es urgente ni resuelve nada de esto. | Opcional. Si se rota, actualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `icon-ads-web/.env.production` y redeployar el frontend. |

No hace falta rotar `DATABASE_URL`/`DIRECT_URL` — esa conexión nunca pasó
por `anon`/`authenticated`, no estuvo expuesta por este problema.
