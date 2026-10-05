-- The migration history is postgres-only. portfolio-infra's bootstrap.sql grants dash_app
-- read-write on every table postgres creates in `dash`, and Drizzle creates its history there;
-- dash_app is the internet-facing role, so it must not read or rewrite which migrations ran.
revoke all on dash.__drizzle_migrations from dash_app;
revoke all on sequence dash.__drizzle_migrations_id_seq from dash_app;
