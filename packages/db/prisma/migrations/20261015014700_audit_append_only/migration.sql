-- Enforce an append-only audit trail at the database layer.
-- These triggers fire for every account (including administrators connecting through the application),
-- so historical audit events cannot be edited or deleted through ordinary DML.
CREATE TRIGGER `audit_events_block_update` BEFORE UPDATE ON `audit_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: UPDATE is not permitted';

CREATE TRIGGER `audit_events_block_delete` BEFORE DELETE ON `audit_events`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: DELETE is not permitted';
