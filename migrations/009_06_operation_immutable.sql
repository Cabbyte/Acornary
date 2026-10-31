SET LOCAL lock_timeout = '2s';
ALTER TABLE operations ALTER COLUMN operation_id SET NOT NULL;
CREATE TRIGGER immutable_operations BEFORE UPDATE OR DELETE ON operations
 FOR EACH ROW EXECUTE FUNCTION reject_mutation();
