CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE search_requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  frozen_at TEXT,
  limits_snapshot TEXT NOT NULL CHECK (length(limits_snapshot) <= 4096 AND json_valid(limits_snapshot) AND json_type(limits_snapshot) = 'object')
) STRICT;

CREATE TABLE title_inputs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL REFERENCES search_requests(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 19),
  original_title TEXT NOT NULL,
  search_title TEXT NOT NULL CHECK (length(trim(search_title)) BETWEEN 1 AND 300),
  year INTEGER CHECK (year BETWEEN 1800 AND 2200),
  work_type TEXT CHECK (work_type IN ('film', 'television_series')),
  resolution_state TEXT NOT NULL DEFAULT 'pending' CHECK (resolution_state IN ('pending', 'running', 'needs_selection', 'unresolved', 'failed', 'interrupted', 'resolved')),
  unresolved_reason TEXT CHECK (unresolved_reason IN ('declined', 'no_match', 'conflicting_details', 'unsupported_type')),
  selected_candidate_id TEXT,
  selected_at TEXT,
  UNIQUE (request_id, position),
  UNIQUE (id, request_id),
  FOREIGN KEY (selected_candidate_id, id) REFERENCES resolution_candidates(id, input_id),
  CHECK ((resolution_state = 'resolved' AND selected_candidate_id IS NOT NULL AND selected_at IS NOT NULL) OR
         (resolution_state <> 'resolved' AND selected_candidate_id IS NULL AND selected_at IS NULL))
) STRICT;

CREATE TABLE resolution_candidates (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  input_id TEXT NOT NULL REFERENCES title_inputs(id),
  attempt_id TEXT NOT NULL REFERENCES operation_attempts(id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  provider TEXT NOT NULL CHECK (provider = 'tmdb'),
  provider_media_type TEXT NOT NULL CHECK (provider_media_type IN ('movie', 'tv')),
  provider_id INTEGER NOT NULL CHECK (provider_id > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  original_title TEXT CHECK (length(original_title) <= 500),
  work_type TEXT NOT NULL,
  release_date TEXT,
  original_language TEXT CHECK (length(original_language) <= 16),
  origin_countries TEXT CHECK (length(origin_countries) <= 128 AND json_valid(origin_countries) AND json_type(origin_countries) = 'array' AND json_array_length(origin_countries) <= 20),
  retrieved_at TEXT NOT NULL,
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  ineligible_reason TEXT CHECK (length(ineligible_reason) <= 128),
  warning_codes TEXT NOT NULL DEFAULT '[]' CHECK (length(warning_codes) <= 4096 AND json_valid(warning_codes) AND json_type(warning_codes) = 'array'),
  UNIQUE (id, input_id),
  UNIQUE (attempt_id, ordinal),
  UNIQUE (attempt_id, provider, provider_media_type, provider_id),
  CHECK ((provider_media_type = 'movie' AND work_type = 'film') OR (provider_media_type = 'tv' AND work_type = 'television_series')),
  CHECK ((eligible = 1 AND ineligible_reason IS NULL) OR (eligible = 0 AND ineligible_reason IS NOT NULL))
) STRICT;

CREATE TABLE works (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider = 'tmdb'),
  provider_media_type TEXT NOT NULL CHECK (provider_media_type IN ('movie', 'tv')),
  provider_id INTEGER NOT NULL CHECK (provider_id > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  original_title TEXT CHECK (length(original_title) <= 500),
  work_type TEXT NOT NULL,
  release_date TEXT,
  original_language TEXT CHECK (length(original_language) <= 16),
  origin_countries TEXT CHECK (length(origin_countries) <= 128 AND json_valid(origin_countries) AND json_type(origin_countries) = 'array' AND json_array_length(origin_countries) <= 20),
  identity_url TEXT NOT NULL CHECK (length(identity_url) <= 4096),
  retrieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_media_type, provider_id),
  CHECK ((provider_media_type = 'movie' AND work_type = 'film') OR (provider_media_type = 'tv' AND work_type = 'television_series'))
) STRICT;

CREATE TABLE request_works (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES search_requests(id),
  work_id TEXT NOT NULL REFERENCES works(id),
  selected_candidate_id TEXT NOT NULL REFERENCES resolution_candidates(id),
  UNIQUE (request_id, work_id)
) STRICT;

CREATE TABLE sources (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  normalized_url TEXT NOT NULL UNIQUE CHECK (length(normalized_url) <= 4096),
  source_host TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  processing_permission TEXT NOT NULL DEFAULT 'unknown' CHECK (processing_permission = 'unknown'),
  display_permission TEXT NOT NULL DEFAULT 'unknown' CHECK (display_permission = 'unknown')
) STRICT;

CREATE TABLE search_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  first_found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (request_id, work_id) REFERENCES request_works(request_id, work_id),
  UNIQUE (request_id, work_id, source_id)
) STRICT;

CREATE TABLE source_observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  search_record_id TEXT NOT NULL REFERENCES search_records(id),
  attempt_id TEXT NOT NULL REFERENCES operation_attempts(id),
  provider_result_id TEXT CHECK (length(provider_result_id) <= 4096),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  original_url TEXT NOT NULL CHECK (length(original_url) <= 4096),
  title TEXT CHECK (length(title) <= 500),
  author TEXT CHECK (length(author) <= 300),
  publisher TEXT CHECK (length(publisher) <= 300),
  publication_date TEXT,
  observed_at TEXT NOT NULL,
  metadata_policy_revision TEXT NOT NULL CHECK (length(metadata_policy_revision) BETWEEN 1 AND 128),
  warning_codes TEXT NOT NULL DEFAULT '[]' CHECK (length(warning_codes) <= 4096 AND json_valid(warning_codes) AND json_type(warning_codes) = 'array'),
  UNIQUE (attempt_id, ordinal)
) STRICT;

CREATE TABLE operations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL REFERENCES search_requests(id),
  kind TEXT NOT NULL CHECK (kind IN ('resolution', 'search')),
  input_id TEXT UNIQUE,
  work_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'interrupted')),
  current_attempt_id TEXT,
  FOREIGN KEY (input_id, request_id) REFERENCES title_inputs(id, request_id),
  FOREIGN KEY (request_id, work_id) REFERENCES request_works(request_id, work_id),
  FOREIGN KEY (current_attempt_id, id) REFERENCES operation_attempts(id, operation_id),
  UNIQUE (request_id, work_id),
  CHECK ((kind = 'resolution' AND input_id IS NOT NULL AND work_id IS NULL) OR
         (kind = 'search' AND input_id IS NULL AND work_id IS NOT NULL)),
  CHECK (state <> 'running' OR current_attempt_id IS NOT NULL)
) STRICT;

CREATE TABLE operation_attempts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL REFERENCES operations(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'succeeded', 'failed', 'interrupted')),
  started_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  finished_at TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('tmdb', 'exa')),
  query TEXT NOT NULL CHECK (length(query) <= 2000),
  query_context TEXT NOT NULL DEFAULT '{}' CHECK (length(query_context) <= 8192 AND json_valid(query_context) AND json_type(query_context) = 'object'),
  template_version TEXT NOT NULL CHECK (length(template_version) BETWEEN 1 AND 128),
  provider_request_id TEXT CHECK (length(provider_request_id) <= 128),
  error_code TEXT CHECK (length(error_code) <= 128),
  retry_at TEXT,
  returned_count INTEGER NOT NULL DEFAULT 0 CHECK (returned_count >= 0),
  retained_count INTEGER NOT NULL DEFAULT 0 CHECK (retained_count BETWEEN 0 AND 20),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  limit_flags TEXT NOT NULL DEFAULT '[]' CHECK (length(limit_flags) <= 4096 AND json_valid(limit_flags) AND json_type(limit_flags) = 'array'),
  notice_codes TEXT NOT NULL DEFAULT '[]' CHECK (length(notice_codes) <= 4096 AND json_valid(notice_codes) AND json_type(notice_codes) = 'array'),
  UNIQUE (id, operation_id),
  UNIQUE (operation_id, attempt_number),
  CHECK ((state = 'running' AND finished_at IS NULL) OR (state <> 'running' AND finished_at IS NOT NULL))
) STRICT;

CREATE TABLE rejected_results (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL REFERENCES operation_attempts(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 128),
  UNIQUE (attempt_id, ordinal)
) STRICT;

CREATE INDEX candidates_input_sequence ON resolution_candidates(input_id, seq);
CREATE INDEX memberships_work_sequence ON request_works(work_id, seq);
CREATE INDEX records_request_sequence ON search_records(request_id, seq);
CREATE INDEX records_request_work_sequence ON search_records(request_id, work_id, seq);
CREATE INDEX records_source_sequence ON search_records(source_id, seq);
CREATE INDEX observations_record_sequence ON source_observations(search_record_id, seq);
CREATE INDEX operations_state_sequence ON operations(state, seq);
CREATE INDEX operations_request_sequence ON operations(request_id, seq);
CREATE INDEX attempts_state_deadline ON operation_attempts(state, deadline_at);
CREATE INDEX attempts_operation_sequence ON operation_attempts(operation_id, seq);
CREATE INDEX rejections_attempt_sequence ON rejected_results(attempt_id, seq);

CREATE TRIGGER candidate_attempt_ownership BEFORE INSERT ON resolution_candidates
WHEN NOT EXISTS (
  SELECT 1 FROM operation_attempts a JOIN operations o ON o.id = a.operation_id
  WHERE a.id = NEW.attempt_id AND o.kind = 'resolution' AND o.input_id = NEW.input_id
)
BEGIN SELECT RAISE(ABORT, 'candidate_attempt_mismatch'); END;

CREATE TRIGGER selection_eligibility BEFORE UPDATE OF selected_candidate_id ON title_inputs
WHEN NEW.selected_candidate_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM resolution_candidates c WHERE c.id = NEW.selected_candidate_id AND c.input_id = NEW.id AND c.eligible = 1
)
BEGIN SELECT RAISE(ABORT, 'candidate_ineligible'); END;

CREATE TRIGGER membership_candidate_ownership BEFORE INSERT ON request_works
WHEN NOT EXISTS (
  SELECT 1 FROM resolution_candidates c JOIN title_inputs i ON i.id = c.input_id JOIN works w
    ON w.provider = c.provider AND w.provider_media_type = c.provider_media_type AND w.provider_id = c.provider_id
  WHERE c.id = NEW.selected_candidate_id AND i.request_id = NEW.request_id AND i.selected_candidate_id = c.id AND c.eligible = 1 AND w.id = NEW.work_id
)
BEGIN SELECT RAISE(ABORT, 'membership_candidate_mismatch'); END;

CREATE TRIGGER membership_candidate_update_ownership BEFORE UPDATE ON request_works
WHEN NOT EXISTS (
  SELECT 1 FROM resolution_candidates c JOIN title_inputs i ON i.id = c.input_id JOIN works w
    ON w.provider = c.provider AND w.provider_media_type = c.provider_media_type AND w.provider_id = c.provider_id
  WHERE c.id = NEW.selected_candidate_id AND i.request_id = NEW.request_id AND i.selected_candidate_id = c.id AND c.eligible = 1 AND w.id = NEW.work_id
)
BEGIN SELECT RAISE(ABORT, 'membership_candidate_mismatch'); END;

CREATE TRIGGER candidates_no_update BEFORE UPDATE ON resolution_candidates
BEGIN SELECT RAISE(ABORT, 'candidate_immutable'); END;

CREATE TRIGGER candidates_no_delete BEFORE DELETE ON resolution_candidates
BEGIN SELECT RAISE(ABORT, 'candidate_immutable'); END;

CREATE TRIGGER attempt_provider_ownership BEFORE INSERT ON operation_attempts
WHEN NOT EXISTS (
  SELECT 1 FROM operations o WHERE o.id = NEW.operation_id AND
    ((o.kind = 'resolution' AND NEW.provider = 'tmdb') OR (o.kind = 'search' AND NEW.provider = 'exa'))
)
BEGIN SELECT RAISE(ABORT, 'attempt_provider_mismatch'); END;

CREATE TRIGGER observation_attempt_ownership BEFORE INSERT ON source_observations
WHEN NOT EXISTS (
  SELECT 1 FROM operation_attempts a JOIN operations o ON o.id = a.operation_id JOIN search_records r
    ON r.request_id = o.request_id AND r.work_id = o.work_id
  WHERE a.id = NEW.attempt_id AND o.kind = 'search' AND r.id = NEW.search_record_id
)
BEGIN SELECT RAISE(ABORT, 'observation_attempt_mismatch'); END;

CREATE TRIGGER observations_no_update BEFORE UPDATE ON source_observations
BEGIN SELECT RAISE(ABORT, 'observation_immutable'); END;

CREATE TRIGGER observations_no_delete BEFORE DELETE ON source_observations
BEGIN SELECT RAISE(ABORT, 'observation_immutable'); END;
