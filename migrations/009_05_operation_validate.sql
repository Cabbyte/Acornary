SET LOCAL lock_timeout = '2s';
ALTER TABLE events VALIDATE CONSTRAINT events_operation_fk;
ALTER TABLE operations VALIDATE CONSTRAINT operations_operation_id_consistent;
