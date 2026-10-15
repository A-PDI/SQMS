-- Recreate the append-only audit triggers with BEGIN ... END bodies. A single-statement body created through a
-- multi-statement script can be stored with its trailing semicolon, which makes mysqldump output unrestorable.
-- Behaviour is unchanged: UPDATE and DELETE on audit_events are rejected for every account.
DROP TRIGGER IF EXISTS `audit_events_block_update`;
DROP TRIGGER IF EXISTS `audit_events_block_delete`;

CREATE TRIGGER `audit_events_block_update` BEFORE UPDATE ON `audit_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: UPDATE is not permitted';
END;

CREATE TRIGGER `audit_events_block_delete` BEFORE DELETE ON `audit_events`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only: DELETE is not permitted';
END;
