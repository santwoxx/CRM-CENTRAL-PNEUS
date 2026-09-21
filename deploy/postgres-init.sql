-- Banco proprio da Evolution API (canal WhatsApp via QR Code).
--
-- Roda uma unica vez, quando o volume do Postgres e criado. Separado do banco
-- do CRM para que uma migracao da Evolution nunca toque nas tabelas de
-- clientes, e para que o backup do CRM nao dependa dela.
CREATE DATABASE evolution;
