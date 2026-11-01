-- acornary:no-transaction
CREATE UNIQUE INDEX CONCURRENTLY operations_household_operation_unique ON public.operations (household_id, operation_id);
