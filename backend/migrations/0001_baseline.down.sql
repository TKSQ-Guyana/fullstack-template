-- Reverts 0001_baseline.sql. Drops the whole app schema — only sensible on a
-- database that holds nothing else.
DROP SCHEMA IF EXISTS app CASCADE;
