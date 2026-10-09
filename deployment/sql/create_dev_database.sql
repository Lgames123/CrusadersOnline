-- Creates the development role and database on a native PostgreSQL install.
-- Run as the superuser (psql asks for its password in your own terminal):
--   & 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -p 5433 -U postgres -f deployment/sql/create_dev_database.sql
-- Then in .env: DATABASE_URL=postgresql://crusaders:crusaders_dev@127.0.0.1:5433/crusaders_online
-- CREATEDB lets the test suite create and drop throwaway databases (TEST_POSTGRES_URL).

CREATE ROLE crusaders LOGIN PASSWORD 'crusaders_dev' CREATEDB;
CREATE DATABASE crusaders_online OWNER crusaders;
