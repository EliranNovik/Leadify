-- Create the RPC function for executing aggregate queries
-- This function will be called by the query_executor tool

CREATE OR REPLACE FUNCTION execute_aggregate_query(
  p_table TEXT,
  p_operation TEXT,
  p_column TEXT,
  p_filters JSONB DEFAULT '[]'::jsonb,
  p_group_by TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sql_query TEXT;
  filter_conditions TEXT := '';
  group_clause TEXT := '';
  result_value NUMERIC;
  result_json JSONB;
BEGIN
  -- Security: Only allow specific tables
  IF p_table NOT IN ('leads', 'meetings', 'interactions') THEN
    RAISE EXCEPTION 'Table % is not allowed', p_table;
  END IF;

  -- Security: Only allow specific operations
  IF p_operation NOT IN ('avg', 'sum', 'min', 'max', 'distinct') THEN
    RAISE EXCEPTION 'Operation % is not allowed', p_operation;
  END IF;

  -- Build filter conditions
  IF p_filters IS NOT NULL AND jsonb_array_length(p_filters) > 0 THEN
    FOR i IN 0..jsonb_array_length(p_filters)-1 LOOP
      DECLARE
        filter_obj JSONB := p_filters->i;
        filter_col TEXT := filter_obj->>'column';
        filter_op TEXT := filter_obj->>'operator';
        filter_val TEXT := filter_obj->>'value';
      BEGIN
        -- Security: Validate column names
        IF p_table = 'leads' AND filter_col NOT IN ('id', 'lead_number', 'name', 'email', 'phone', 'topic', 'category', 'stage', 'created_at', 'expert', 'closer', 'proposal_total', 'proposal_currency', 'balance', 'balance_currency', 'date_signed', 'next_followup', 'created_by') THEN
          RAISE EXCEPTION 'Column % is not allowed for table leads', filter_col;
        ELSIF p_table = 'meetings' AND filter_col NOT IN ('id', 'client_id', 'meeting_date', 'meeting_time', 'meeting_brief', 'meeting_amount', 'meeting_currency', 'created_at') THEN
          RAISE EXCEPTION 'Column % is not allowed for table meetings', filter_col;
        ELSIF p_table = 'interactions' AND filter_col NOT IN ('id', 'client_id', 'interaction_type', 'interaction_date', 'interaction_notes', 'created_at') THEN
          RAISE EXCEPTION 'Column % is not allowed for table interactions', filter_col;
        END IF;

        -- Security: Validate operators
        IF filter_op NOT IN ('=', '!=', '<', '<=', '>', '>=', 'like') THEN
          RAISE EXCEPTION 'Operator % is not allowed', filter_op;
        END IF;

        -- Build the filter condition
        IF filter_conditions != '' THEN
          filter_conditions := filter_conditions || ' AND ';
        END IF;

        IF filter_op = 'like' THEN
          filter_conditions := filter_conditions || format('%I ILIKE %L', filter_col, '%' || filter_val || '%');
        ELSE
          filter_conditions := filter_conditions || format('%I %s %L', filter_col, filter_op, filter_val);
        END IF;
      END;
    END LOOP;
  END IF;

  -- Build group by clause
  IF p_group_by IS NOT NULL THEN
    group_clause := ' GROUP BY ' || quote_ident(p_group_by);
  END IF;

  -- Build the SQL query
  IF p_operation = 'distinct' THEN
    sql_query := format('SELECT COUNT(DISTINCT %I) as result FROM %I', p_column, p_table);
  ELSE
    sql_query := format('SELECT %s(%I) as result FROM %I', p_operation, p_column, p_table);
  END IF;

  -- Add WHERE clause if filters exist
  IF filter_conditions != '' THEN
    sql_query := sql_query || ' WHERE ' || filter_conditions;
  END IF;

  -- Add GROUP BY clause if specified
  sql_query := sql_query || group_clause;

  -- Execute the query
  EXECUTE sql_query INTO result_value;

  -- Return the result
  result_json := jsonb_build_object('result', result_value, 'query', sql_query);
  RETURN result_json;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('error', SQLERRM, 'query', sql_query);
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION execute_aggregate_query(TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- Example usage:
-- SELECT execute_aggregate_query('leads', 'count', 'id', '[{"column": "stage", "operator": "=", "value": "client signed agreement"}]');
-- SELECT execute_aggregate_query('leads', 'avg', 'proposal_total', '[{"column": "created_at", "operator": ">=", "value": "2024-01-01"}]'); 